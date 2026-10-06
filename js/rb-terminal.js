/* AYCHO module: rb-terminal | owner: B | contract: v1 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var WS_OVERRIDE_KEY = 'aycho.term.ws';
  var ROOT = '/workspace';
  /* xterm 资源解析顺序：优先随包本地文件（file:// 离线可用），再 CDN 兜底（原约定终端 xterm 例外） */
  var XTERM_URLS = [
    { js: 'assets/vendor/xterm.js', css: 'assets/vendor/xterm.css' },
    { js: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js', css: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css' },
    { js: 'https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js', css: 'https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css' }
  ];
  var CANDIDATE_WS = ['same-origin', 'ws://localhost:8787/pty', 'ws://127.0.0.1:8787/pty'];

  /* 终端等宽字体：不再依赖 --ax-font-mono（其尾部 "Courier New" 在手机端会命中 Courier
     宽字面回退，字符 advance 偏大 → 字间距被撑开）。写死紧凑栈：平台原生等宽优先。 */
  var TERM_FONT_FAM = 'ui-monospace, "SF Mono", SFMono-Regular, "Roboto Mono", "JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace';
  var TERM_FONT_SIZE = 12;
  var TERM_LINE_HEIGHT = 1.22;

  var built = false;
  var els = {};
  var mode = 'idle';            // 'real' | 'sim' | 'connecting'
  var ws = null, wsAlive = false, rawMode = false;   // rawMode: 真实后端 + 无 xterm，走纯文本输出
  var term = null, fitTimer = null, probeTimer = null;
  var xtermPromise = null;
  var apiProbeWait = false;        // 等待后端探测完成，避免无后端时盲发 ws
  var sim = { cwd: ROOT, history: [], hIndex: -1 };
  var simLines = [];            // 内置终端滚动缓冲（重挂载后回放）
  var listeners = [];
  var disposed = false;

  function U() { return A.util || null; }
  function el() { var u = U(); return u ? u.el.apply(u, arguments) : document.createElement(arguments[0]); }
  function ic(name, size) { return (A.icons && A.icons.node) ? A.icons.node(name, size || 15) : document.createTextNode(''); }
  function files() { return (A.store && A.store.get('projectFiles')) || []; }
  function saveFiles(arr) { if (A.store) A.store.set('projectFiles', arr); }
  function uid(p) { return (U() && U().uid) ? U().uid(p) : (p + '-' + Math.random().toString(36).slice(2, 8)); }
  function on(target, evt, fn, opt) { target.addEventListener(evt, fn, opt); listeners.push([target, evt, fn, opt]); }
  function offAll() { for (var i = 0; i < listeners.length; i++) { var l = listeners[i]; l[0].removeEventListener(l[1], l[2], l[3]); } listeners.length = 0; }
  function status(tone, text) { if (A.rightPanel && A.rightPanel.setStatus) A.rightPanel.setStatus(tone, text); }
  function escapeHtml(s) { var u = U(); return u && u.escapeHtml ? u.escapeHtml(s) : String(s == null ? '' : s); }

  /* ============================================================ DOM */
  function build(el0) {
    if (built) { if (el0 && els.pane && els.pane.parentNode !== el0) el0.appendChild(els.pane); return; }
    built = true;

    var badge = el('span', { class: 'rb-badge', text: '连接中…' });
    var toolbar = el('div', { class: 'rb-toolbar' },
      el('span', { class: 'rb-toolbar__title', text: '终端' }),
      badge,
      el('span', { class: 'rb-toolbar__spacer' }),
      el('button', { class: 'rb-btn', type: 'button', title: '清屏 (Ctrl+L)', onclick: doClear }, ic('trash', 14), el('span', { text: '清屏' })),
      el('button', { class: 'rb-btn', type: 'button', title: '复制全部输出', onclick: copyAll }, ic('clipboard', 14)),
      el('button', { class: 'rb-btn', type: 'button', title: '重新连接后端', onclick: reconnect }, ic('refresh', 14))
    );

    var xtermHost = el('div', { class: 'rb-term__xterm', hidden: 'hidden' });
    var fallback = el('pre', { class: 'rb-term__fallback ax-scroll', tabindex: '0' });
    var ta = el('textarea', {
      class: 'rb-term__input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
      rows: '1', enterkeyhint: 'send', 'aria-label': '终端输入', placeholder: '输入命令，回车发送'
    });
    var screen = el('div', { class: 'rb-term__screen' }, xtermHost, fallback, ta);
    var hint = el('div', { class: 'rb-term__hint' },
      el('span', { text: '↑↓ 历史 · Tab 补全 · Ctrl+C 中断 · Ctrl+L 清屏' })
    );

    els = {
      pane: el('div', { class: 'rb-term' }, toolbar, screen, hint),
      badge: badge, xtermHost: xtermHost, fallback: fallback, ta: ta, screen: screen, hint: hint
    };
    el0.appendChild(els.pane);
    bindInput();
  }

  function setBadge(kind, text) {
    if (!els.badge) return;
    els.badge.className = 'rb-badge' + (kind === 'warn' ? ' rb-badge--warn' : kind === 'ok' ? ' rb-badge--ok' : kind === 'live' ? ' rb-badge--live' : '');
    els.badge.textContent = text;
  }

  /* ============================================================ 后端连接 */
  function candidateUrls() {
    var out = [], override = null;
    try { override = localStorage.getItem(WS_OVERRIDE_KEY); } catch (_) {}
    if (override) out.push(override);
    // 若网关为跨域地址（静态托管手填后端），终端 ws 跟随网关主机
    // 注意：A.api.base() 只在健康探测成功后才有值；冷启动/探测失败时也要用部署期注入的网关地址，
    // 否则候选 URL 里只剩同源（静态托管上不可能有 /pty），会误判"无后端"而降级成演示 Shell。
    try {
      var apiBase = '';
      try { apiBase = String((typeof window !== 'undefined' && window.AYCHO_API_BASE) || ''); } catch (_) {}
      if (!apiBase) { try { apiBase = String(localStorage.getItem('aycho.apiBase') || ''); } catch (_) {} }
      if (!apiBase && A.api && typeof A.api.base === 'function') apiBase = String(A.api.base() || '');
      if (apiBase && /^https?:/i.test(apiBase)) {
        var u = new URL(apiBase);
        var p = u.protocol === 'https:' ? 'wss:' : 'ws:';
        out.push(p + '//' + u.host + '/pty');
      }
    } catch (_) {}
    for (var i = 0; i < CANDIDATE_WS.length; i++) {
      var c = CANDIDATE_WS[i];
      if (c === 'same-origin') {
        if (location.protocol === 'http:' || location.protocol === 'https:') {
          var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
          out.push(proto + '//' + location.host + '/pty');
          if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
            out.push(proto + '//' + location.hostname + ':8787/pty');
          }
        }
      } else if (out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  function tryConnect(url, timeout) {
    return new Promise(function (resolve, reject) {
      var sock;
      try { sock = new WebSocket(url); } catch (e) { reject(e); return; }
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; try { sock.close(); } catch (_) {} reject(new Error('timeout')); } }, timeout || 1600);
      sock.onopen = function () { if (done) { try { sock.close(); } catch (_) {} return; } done = true; clearTimeout(t); resolve(sock); };
      sock.onerror = function () { if (done) return; done = true; clearTimeout(t); try { sock.close(); } catch (_) {} reject(new Error('error')); };
      sock.onclose = function () { if (done) return; done = true; clearTimeout(t); reject(new Error('closed')); };
    });
  }

  function reconnect() {
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    if (mode === 'sim') { simPrint('—— 尝试重新连接后端 ——', 'dim'); }
    connect();
  }

  function connect() {
    if (disposed) return;
    // 不再依赖 /api/health 探测结果：直接尝试 ws 候选（含部署期注入的网关主机），
    // 免费实例冷启动期间持续重试，避免一上来就静默降级成演示 Shell。
    mode = 'connecting';
    setBadge('live', '连接中…');
    status('busy', '连接终端后端…');
    var urls = candidateUrls(), i = 0;
    var startedAt = Date.now(), WAKE_WINDOW = 60000, warmNotice = false;
    function next() {
      if (disposed) return;
      if (i >= urls.length) {
        // 冷启动窗口内持续重试（5s 一轮），窗口用尽仍连不上才降级，并明确标注为演示 Shell
        if (Date.now() - startedAt < WAKE_WINDOW) {
          if (!warmNotice) {
            warmNotice = true;
            setBadge('live', '唤醒后端…');
            status('busy', '正在唤醒终端后端（免费实例冷启动约 30~60 秒）…');
            simPrint('—— 正在连接真实终端后端；免费实例冷启动较慢，最长等待 60 秒 ——', 'warn');
          }
          setTimeout(function () { if (disposed) return; i = 0; urls = candidateUrls(); next(); }, 5000);
          return;
        }
        startSim('连接超时');
        return;
      }
      tryConnect(urls[i++], 3000).then(function (sock) {
        if (disposed) { try { sock.close(); } catch (_) {} return; }
        ws = sock; wsAlive = true; mode = 'real';
        ws.onmessage = onWsMessage;
        ws.onclose = function () { if (disposed) return; wsAlive = false; ws = null; if (mode === 'real') { status('warn', '连接已断开'); setBadge('warn', '连接已断开'); simPrint('—— 终端后端连接已断开，可点击「重新连接」 ——', 'warn'); } };
        ws.onerror = function () {};
        onReal();
      }, next);
    }
    next();
  }

  function onWsMessage(ev) {
    var msg = ev.data;
    try { msg = JSON.parse(ev.data); } catch (_) { msg = { type: 'data', data: ev.data }; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'data' || msg.type === 'out') {
      var chunk = msg.data == null ? '' : String(msg.data);
      if (term) term.write(chunk);
      else rawFeed(chunk);
    }
    else if (msg.type === 'ready') { if (msg.cwd) sim.cwd = msg.cwd; }
    else if (msg.type === 'exit') { simPrint('—— 进程退出，code=' + msg.code + ' ——', 'warn'); }
  }

  function startSim(why) {
    if (disposed) return;
    mode = 'sim';
    setBadge('warn', '演示 Shell · 未连接后端');
    status('warn', '未连接后端 · 当前为演示 Shell');
    if (els.xtermHost) els.xtermHost.setAttribute('hidden', 'hidden');
    if (els.fallback) els.fallback.removeAttribute('hidden');
    if (!simLines.length) {
      simPrint('AYCHO 演示 Shell —— 这不是真实终端', 'warn');
      simPrint('未连接到后端 /pty' + (why ? '（' + why + '）' : '') + '；以下命令仅在页面内模拟，不会在真实系统执行。', 'warn');
      simPrint('点击工具栏「重新连接」可重试真实终端；输入 help 查看演示命令。', 'dim');
      simPrint('');
    } else {
      simPrint('');
      simPrint('— 已重挂载，历史输出已保留 —', 'dim');
    }
    simPrompt();
    focusInput();
  }

  /* 后端可用但 xterm 不可用：切为纯文本直连输出（仍发往真实后端） */
  function rawFallback(reason) {
    if (disposed) return;
    rawMode = true;
    if (els.xtermHost) els.xtermHost.setAttribute('hidden', 'hidden');
    if (els.fallback) {
      els.fallback.removeAttribute('hidden');
      while (els.fallback.firstChild) els.fallback.removeChild(els.fallback.firstChild);
    }
    simLines.length = 0;
    setBadge('ok', '真实终端 · 纯文本');
    status('ok', '真实终端 · 已连接（纯文本输出）');
    simPrint((reason || 'xterm 不可用') + '，已切换为纯文本直连输出；命令仍发送到真实后端。', 'warn');
    simPrompt();
    focusInput();
  }

  function onReal() {
    mode = 'real';
    rawMode = false;
    setBadge('ok', '真实终端 · 已连接');
    status('ok', '真实终端 · bash 已连接');
    loadXterm().then(function (ok) {
      if (disposed) return;
      if (!ok) { rawFallback('xterm.js 未能加载'); return; }
      if (term) { try { term.dispose(); } catch (_) {} term = null; }
      if (els.fallback) els.fallback.setAttribute('hidden', 'hidden');
      if (els.xtermHost) els.xtermHost.removeAttribute('hidden');
      var Ctor = xtermCtor();
      if (!Ctor) { rawFallback('xterm 未就绪'); return; }
      var fontFam = TERM_FONT_FAM;
      term = new Ctor({
        allowTransparency: true,
        cursorBlink: true,
        scrollback: 4000,
        fontSize: TERM_FONT_SIZE,
        lineHeight: TERM_LINE_HEIGHT,
        letterSpacing: 0,
        fontFamily: fontFam,
        theme: {
          background: 'rgba(0,0,0,0)', foreground: '#c9d2e2', cursor: '#7c9cff', cursorAccent: '#06070b',
          selectionBackground: 'rgba(124,156,255,.30)',
          black: '#12141c', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
          blue: '#7c9cff', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e6ebf5',
          brightBlack: '#6d7688', brightRed: '#ff9a9a', brightGreen: '#6ee7b7', brightYellow: '#fcd34d',
          brightBlue: '#a5bcff', brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff'
        }
      });
      term.open(els.xtermHost);
      term.onData(function (d) { sendInput(d); });
      fit();
      term.write('\u001b[38;5;111mAYCHO\u001b[0m 已连接到真实终端后端。\r\n');
      send({ type: 'init', cols: term.cols, rows: term.rows, cwd: ROOT });
      focusInput();
    });
  }

  /* xterm 构造器解析：宿主可预置 AYCHO.xterm（本地自托管/测试注入） */
  function xtermCtor() {
    var m = A.xterm;
    if (m && typeof m.Terminal === 'function') return m.Terminal;
    if (typeof window.Terminal === 'function') return window.Terminal;
    if (window.xterm && typeof window.xterm.Terminal === 'function') return window.xterm.Terminal;
    return null;
  }

  function loadXterm() {
    if (xtermCtor()) return Promise.resolve(true);
    if (xtermPromise) return xtermPromise;
    xtermPromise = new Promise(function (resolve) {
      var i = 0;
      function next() {
        if (xtermCtor()) { resolve(true); return; }
        if (i >= XTERM_URLS.length) { resolve(false); return; }
        var set = XTERM_URLS[i++];
        if (set.css && !document.querySelector('link[data-aycho-xterm]')) {
          var link = document.createElement('link');
          link.rel = 'stylesheet'; link.href = set.css; link.setAttribute('data-aycho-xterm', '1');
          document.head.appendChild(link);
        }
        var s = document.createElement('script');
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; next(); } }, 6000);
        s.src = set.js; s.async = true;
        s.onload = function () { done = true; clearTimeout(t); resolve(!!xtermCtor()); };
        s.onerror = function () { done = true; clearTimeout(t); next(); };
        document.head.appendChild(s);
      }
      next();
    });
    return xtermPromise;
  }

  function send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (_) {} } }
  function sendInput(data) { if (mode === 'real' && wsAlive) send({ type: 'input', data: data }); }

  function measureChar() {
    var fam = TERM_FONT_FAM;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;letter-spacing:normal;font-family:' + fam + ';font-size:' + TERM_FONT_SIZE + 'px;line-height:' + TERM_LINE_HEIGHT;
    probe.textContent = 'MMMMMMMMMM';
    document.body.appendChild(probe);
    var r = probe.getBoundingClientRect();
    document.body.removeChild(probe);
    return { w: (r.width / 10) || 7.2, h: r.height || 16 };
  }

  function fit() {
    if (!term || !els.xtermHost || !els.xtermHost.clientWidth) return;
    var m = measureChar();
    var cols = Math.max(20, Math.floor((els.xtermHost.clientWidth - 14) / m.w));
    var rows = Math.max(6, Math.floor((els.xtermHost.clientHeight - 12) / m.h));
    if (cols !== term.cols || rows !== term.rows) {
      try { term.resize(cols, rows); } catch (_) {}
      if (mode === 'real') send({ type: 'resize', cols: cols, rows: rows });
    }
  }

  /* ============================================================ 内置文件系统（Shell 会话） */
  function normalize(p) {
    var s = String(p == null ? '' : p);
    if (!s) s = sim.cwd;
    if (s.charAt(0) !== '/') s = sim.cwd + '/' + s;
    var parts = s.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return '/' + out.join('/');
  }
  function dirName(p) { p = normalize(p); if (p === '/') return '/'; var s = p.split('/'); s.pop(); return s.join('/') || '/'; }
  function baseName(p) { var s = normalize(p).split('/'); return s[s.length - 1] || '/'; }
  function joinPath(a, b) { return normalize(String(a).replace(/\/+$/, '') + '/' + b); }

  function findFile(p) {
    var n = normalize(p), all = files();
    for (var i = 0; i < all.length; i++) if (all[i] && normalize(all[i].path) === n) return all[i];
    return null;
  }
  function childEntries(dir) {
    var d = normalize(dir), all = files(), out = [];
    for (var i = 0; i < all.length; i++) {
      var f = all[i];
      if (!f || !f.path) continue;
      var p = normalize(f.path);
      if (p === d || p === '/') continue;
      if (dirName(p) === d) out.push({ path: p, name: baseName(p), kind: f.kind || 'file' });
    }
    out.sort(function (a, b) {
      var ad = a.kind === 'dir' ? 0 : 1, bd = b.kind === 'dir' ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
    return out;
  }
  function isDir(p) { var n = normalize(p); var f = findFile(n); if (f) return f.kind === 'dir'; return n === '/' || n === ROOT || childEntries(n).length > 0; }

  function mkdirP(dir) {
    var n = normalize(dir);
    if (n === '/') return;
    var all = files().slice(), parts = n.split('/').filter(Boolean), cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      if (cur === ROOT) continue;                    // 项目根目录是隐含节点，不落库
      var hit = false;
      for (var j = 0; j < all.length; j++) if (all[j] && normalize(all[j].path) === cur) { hit = true; break; }
      if (!hit) all.push({ id: uid('pf'), path: cur, kind: 'dir', content: '', updatedAt: Date.now() });
    }
    saveFiles(all);
  }
  function writeFile(p, content) {
    var n = normalize(p), all = files().slice();
    for (var i = 0; i < all.length; i++) {
      if (all[i] && normalize(all[i].path) === n) {
        all[i].content = String(content == null ? '' : content);
        all[i].kind = 'file';
        all[i].updatedAt = Date.now();
        saveFiles(all);
        return true;
      }
    }
    mkdirP(dirName(n));
    all = files().slice();
    all.push({ id: uid('pf'), path: n, kind: 'file', content: String(content == null ? '' : content), updatedAt: Date.now() });
    saveFiles(all);
    return true;
  }
  function removeTree(p) {
    var n = normalize(p);
    var keep = [], removed = 0;
    var all = files();
    for (var i = 0; i < all.length; i++) {
      var f = all[i];
      if (!f || !f.path) continue;
      var fp = normalize(f.path);
      if (fp === n || fp.indexOf(n + '/') === 0) { removed++; continue; }
      keep.push(f);
    }
    if (removed) saveFiles(keep);
    return removed;
  }

  /* ============================================================ 输出 */
  function simPrint(text, cls) {
    simLines.push({ t: text == null ? '' : String(text), c: cls || '' });
    if (simLines.length > 600) simLines.splice(0, simLines.length - 600);
    if (!els.fallback || els.fallback.hasAttribute('hidden')) return;
    var span = document.createElement('span');
    span.className = 'rb-tl' + (cls ? ' rb-tl--' + cls : '');
    span.textContent = (text === '' || text == null) ? '\u00a0' : String(text);
    els.fallback.appendChild(span);
    while (els.fallback.childNodes.length > 600) els.fallback.removeChild(els.fallback.firstChild);
    els.fallback.scrollTop = els.fallback.scrollHeight;
  }
  function replaySim() {
    if (!els.fallback) return;
    while (els.fallback.firstChild) els.fallback.removeChild(els.fallback.firstChild);
    for (var i = 0; i < simLines.length; i++) {
      var span = document.createElement('span');
      span.className = 'rb-tl' + (simLines[i].c ? ' rb-tl--' + simLines[i].c : '');
      span.textContent = simLines[i].t === '' ? '\u00a0' : simLines[i].t;
      els.fallback.appendChild(span);
    }
    els.fallback.scrollTop = els.fallback.scrollHeight;
  }
  /* 纯文本直连输出（真实后端 + xterm 缺失时使用）：剥离 ANSI 后按行落入输出层 */
  var ANSI_RE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[ -/]*[@-~]/g;
  function rawFeed(data) {
    var s = String(data).replace(ANSI_RE, '').replace(/\r\n/g, '\n');
    var parts = s.split('\n');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    for (var i = 0; i < parts.length; i++) simPrint(parts[i].replace(/\r/g, ''), 'file');
  }

  function promptLabel() {
    var c = sim.cwd === ROOT ? '~' : (sim.cwd.indexOf(ROOT + '/') === 0 ? '~' + sim.cwd.slice(ROOT.length) : sim.cwd);
    return 'aycho:' + c + '$';
  }
  function simPrompt() { simPrint(promptLabel() + ' ', 'accent'); }
  function simEcho(text, cls) { if (term) term.writeln(text); else simPrint(text, cls); }
  function simError(text) { simEcho(text, 'err'); }

  /* ============================================================ 命令解析 */
  function tokenize(s) {
    var out = [], buf = '', q = null, has = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) { if (ch === q) { q = null; } else buf += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { if (buf || has) { out.push(buf); buf = ''; has = false; } continue; }
      buf += ch;
    }
    if (buf || has) out.push(buf);
    return out;
  }

  function cmdHelp() {
    var rows = [
      '内置命令（演示模式 · 不连接真实系统）：',
      '  help             显示本帮助',
      '  pwd / ls [-l] [路径]      列出目录（真实读取「项目文件」）',
      '  cd <目录> / tree [目录]   切换目录 / 树形展示',
      '  cat <文件>                查看文件内容',
      '  echo 文本 [> 文件|>> 文件]  输出或写入文件',
      '  mkdir <目录> / touch <文件> / rm [-r] <路径>',
      '  mv <源> <目标> / cp <源> <目标> / open <路径>',
      '  clear / date / whoami / exit-help',
      '快捷键：↑↓ 历史，Tab 补全，Ctrl+C 清行，Ctrl+L 清屏'
    ];
    for (var i = 0; i < rows.length; i++) simPrint(rows[i], i === 0 ? 'ok' : '');
  }

  function cmdLs(args) {
    var long = false, target = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-l' || args[i] === '-la' || args[i] === '-al') long = true;
      else if (args[i].charAt(0) !== '-') target = args[i];
    }
    var dir = target ? normalize(target) : sim.cwd;
    if (!isDir(dir)) { simError('ls: 不是目录: ' + dir); return; }
    var list = childEntries(dir);
    if (!list.length) { simPrint('（空目录）', 'dim'); return; }
    if (!long) {
      var chunk = [];
      for (var j = 0; j < list.length; j++) chunk.push(list[j].kind === 'dir' ? list[j].name + '/' : list[j].name);
      simPrint(chunk.join('   '), 'file');
      return;
    }
    for (var k = 0; k < list.length; k++) {
      var it = list[k];
      var f = findFile(it.path);
      var size = it.kind === 'dir' ? '-' : String((f && f.content ? f.content.length : 0));
      var when = f && f.updatedAt ? new Date(f.updatedAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
      simPrint((it.kind === 'dir' ? 'd' : '-') + '  ' + size.padStart(7, ' ') + '  ' + when + '  ' + (it.kind === 'dir' ? it.name + '/' : it.name), it.kind === 'dir' ? 'dir' : 'file');
    }
  }

  function cmdTree(args) {
    var start = args.length ? normalize(args[0]) : sim.cwd;
    if (!isDir(start)) { simError('tree: 不是目录: ' + start); return; }
    var count = 0;
    (function walk(dir, prefix, depth) {
      if (depth > 6) { simPrint(prefix + '└─ …', 'dim'); return; }
      var list = childEntries(dir);
      for (var i = 0; i < list.length; i++) {
        var last = i === list.length - 1;
        simPrint(prefix + (last ? '└─ ' : '├─ ') + list[i].name + (list[i].kind === 'dir' ? '/' : ''), list[i].kind === 'dir' ? 'dir' : 'file');
        count++;
        if (list[i].kind === 'dir') walk(list[i].path, prefix + (last ? '   ' : '│  '), depth + 1);
      }
    })(start, '', 0);
    simPrint('共 ' + count + ' 项', 'dim');
  }

  function cmdCat(args) {
    if (!args.length) { simError('cat: 缺少文件参数'); return; }
    for (var i = 0; i < args.length; i++) {
      var p = normalize(args[i]), f = findFile(p);
      if (!f) { simError('cat: 文件不存在: ' + args[i]); continue; }
      if (f.kind === 'dir') { simError('cat: 是目录: ' + args[i]); continue; }
      var text = String(f.content == null ? '' : f.content);
      var lines = text.split('\n');
      for (var j = 0; j < lines.length; j++) simPrint(lines[j], 'file');
    }
  }

  function cmdWrite(tokens) {
    var text = [], redir = null, target = null;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === '>' || t === '>>') { redir = t; target = tokens[i + 1] || null; break; }
      if (/^>>?$/.test(t)) { redir = t; continue; }
      text.push(t);
    }
    var body = text.join(' ');
    if (!redir) { simPrint(body, ''); return; }
    if (!target) { simError('echo: 重定向缺少目标文件'); return; }
    var p = normalize(target);
    if (redir === '>>') {
      var old = findFile(p);
      if (old && old.kind === 'dir') { simError('echo: 目标是目录: ' + target); return; }
      var prev = old && old.content ? String(old.content) : '';
      writeFile(p, prev ? prev + '\n' + body : body);
    } else {
      writeFile(p, body);
    }
    simPrint('已写入 ' + p + '（' + util_bytes(body) + '）', 'ok');
  }
  function util_bytes(s) { var u = U(); return u && u.fmtBytes ? u.fmtBytes(u.byteLength ? u.byteLength(s) : String(s).length) : (String(s).length + ' B'); }

  function cmdRm(args) {
    var recursive = false, targets = [];
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-r' || args[i] === '-rf' || args[i] === '-fr' || args[i] === '-R') recursive = true;
      else targets.push(args[i]);
    }
    if (!targets.length) { simError('rm: 缺少路径参数'); return; }
    for (var j = 0; j < targets.length; j++) {
      var n = normalize(targets[j]);
      if (n === '/' || n === ROOT) { simError('rm: 拒绝删除工作区根目录'); continue; }
      var dir = isDir(n) && (childEntries(n).length > 0 || (findFile(n) && findFile(n).kind === 'dir'));
      if (!findFile(n) && !childEntries(n).length) { simError('rm: 路径不存在: ' + targets[j]); continue; }
      if (dir && !recursive) { simError('rm: 是目录，请使用 rm -r ' + targets[j]); continue; }
      var removed = removeTree(n);
      if (!removed) writeFile(n, '');
      simPrint('已删除 ' + n + (removed > 1 ? '（' + removed + ' 项）' : ''), 'warn');
    }
  }

  function cmdMv(args) {
    if (args.length < 2) { simError('mv: 用法 mv <源> <目标>'); return; }
    var src = findFile(args[0]);
    if (!src) { simError('mv: 源不存在: ' + args[0]); return; }
    var from = normalize(args[0]), to = normalize(args[1]);
    if (isDir(to)) to = joinPath(to, baseName(from));
    if (to.indexOf(from + '/') === 0) { simError('mv: 不能移动到自身子目录'); return; }
    var all = files().slice(), hit = false;
    for (var i = 0; i < all.length; i++) {
      if (!all[i] || !all[i].path) continue;
      var fp = normalize(all[i].path);
      if (fp === from || fp.indexOf(from + '/') === 0) {
        all[i].path = to + fp.slice(from.length);
        all[i].updatedAt = Date.now();
        hit = true;
      }
    }
    if (!hit) { simError('mv: 操作失败'); return; }
    saveFiles(all);
    mkdirP(dirName(to));
    simPrint('已移动 ' + from + ' → ' + to, 'ok');
  }

  function cmdCp(args) {
    if (args.length < 2) { simError('cp: 用法 cp <源> <目标>'); return; }
    var src = findFile(args[0]);
    if (!src) { simError('cp: 源不存在: ' + args[0]); return; }
    if (src.kind === 'dir') { simError('cp: 暂不支持复制目录'); return; }
    var from = normalize(args[0]), to = normalize(args[1]);
    if (isDir(to)) to = joinPath(to, baseName(from));
    writeFile(to, src.content || '');
    simPrint('已复制 ' + from + ' → ' + to, 'ok');
  }

  function complete(input) {
    var tokens = input.split(/\s+/);
    var last = tokens[tokens.length - 1] || '';
    var slash = last.lastIndexOf('/');
    var dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
    var frag = slash >= 0 ? last.slice(slash + 1) : last;
    var dir = dirPart ? normalize(dirPart) : sim.cwd;
    var list = childEntries(dir), hits = [];
    for (var i = 0; i < list.length; i++) if (list[i].name.indexOf(frag) === 0) hits.push(list[i]);
    if (!hits.length) return null;
    if (hits.length > 1) {
      var names = [];
      for (var j = 0; j < hits.length; j++) names.push(hits[j].name + (hits[j].kind === 'dir' ? '/' : ''));
      simPrint(names.join('   '), 'dim');
      simPrint(promptLabel() + ' ' + input, 'accent');
      return { list: hits, prefix: frag };
    }
    var one = hits[0].name + (hits[0].kind === 'dir' ? '/' : '');
    return { value: input.slice(0, input.length - last.length) + dirPart + one };
  }

  function runSim(raw) {
    var line = String(raw == null ? '' : raw).trim();
    simPrint(promptLabel() + ' ' + line, 'accent');
    if (!line) return;
    sim.history.push(line);
    if (sim.history.length > 100) sim.history.shift();
    sim.hIndex = sim.history.length;

    var io = line;
    var outRedir = null;
    var m = io.match(/^(.*?)\s*(>>|>)\s*(\S+)\s*$/);
    if (m) { io = m[1]; outRedir = { op: m[2], target: m[3] }; }
    var tokens = tokenize(io);
    var cmd = tokens[0] || '';
    var args = tokens.slice(1);
    var captured = [];

    var realPrint = simPrint;
    if (outRedir) {
      simPrint = function (text, cls) { captured.push(text == null ? '' : String(text)); };
    }
    try {
      switch (cmd) {
        case 'help': case '?': case '--help': cmdHelp(); break;
        case 'pwd': simPrint(sim.cwd, 'file'); break;
        case 'ls': case 'dir': cmdLs(args); break;
        case 'cd': {
          var t = args.length ? normalize(args[0]) : ROOT;
          if (t === '~') t = ROOT;
          if (!isDir(t)) simError('cd: 目录不存在: ' + (args[0] || t));
          else { sim.cwd = t; if (A.bus) A.bus.emit('state:change', { path: 'term.cwd', value: t }); }
          break;
        }
        case 'cat': cmdCat(args); break;
        case 'echo': cmdWrite(args); break;
        case 'mkdir': {
          if (!args.length) { simError('mkdir: 缺少目录参数'); break; }
          for (var a = 0; a < args.length; a++) {
            if (args[a].charAt(0) === '-') continue;
            mkdirP(normalize(args[a]));
            simPrint('已创建目录 ' + normalize(args[a]), 'ok');
          }
          break;
        }
        case 'touch': {
          if (!args.length) { simError('touch: 缺少文件参数'); break; }
          for (var b = 0; b < args.length; b++) { writeFile(normalize(args[b]), ''); simPrint('已创建 ' + normalize(args[b]), 'ok'); }
          break;
        }
        case 'rm': case 'del': cmdRm(args); break;
        case 'mv': cmdMv(args); break;
        case 'cp': cmdCp(args); break;
        case 'tree': cmdTree(args); break;
        case 'clear': case 'cls': if (els.fallback) { while (els.fallback.firstChild) els.fallback.removeChild(els.fallback.firstChild); } simLines.length = 0; break;
        case 'date': simPrint(new Date().toLocaleString('zh-CN'), 'file'); break;
        case 'whoami': simPrint('aycho (marvis sandbox)', 'file'); break;
        case 'open': case 'edit': {
          if (!args.length) { simError('open: 缺少路径参数'); break; }
          var op = normalize(args[0]);
          if (!findFile(op)) { simError('open: 路径不存在: ' + args[0]); break; }
          if (A.bus) { A.bus.emit('file:open', { path: op }); A.bus.emit('panel:open', { tab: 'ide' }); }
          simPrint('已在 IDE 打开 ' + op, 'ok');
          break;
        }
        case 'exit': case 'quit': simPrint('输入 help 查看可用命令。', 'dim'); break;
        default:
          simError(cmd + ': 未找到命令，输入 help 查看可用命令。');
      }
    } finally {
      simPrint = realPrint;
    }
    if (outRedir) {
      var body = captured.join('\n');
      var tp = normalize(outRedir.target);
      if (outRedir.op === '>>') {
        var oldF = findFile(tp);
        var prev = oldF && oldF.content ? String(oldF.content) : '';
        writeFile(tp, prev ? prev + '\n' + body : body);
      } else {
        writeFile(tp, body);
      }
      simPrint('已写入 ' + tp + '（' + util_bytes(body) + '）', 'ok');
    }
  }

  function runCommand(line) {
    if (mode === 'real' && wsAlive) { send({ type: 'input', data: String(line) + '\n' }); return; }
    if (mode === 'connecting') { simPrint('—— 终端后端正在连接中，请稍候；连接成功后会切到真实终端 ——', 'warn'); simPrompt(); return; }
    if (mode !== 'sim') { startSim('后端不可达'); }
    runSim(line);
  }

  /* ============================================================ 输入与快捷键 */
  var bound = false, ro = null, busBound = false;

  var fitDeb = null;
  function isMobileTerm() { return window.innerWidth <= 900; }
  /* 移动端焦点一律交给底部可见输入条：
     交给 xterm 的隐藏 textarea 时，中文 IME 无回显、输入明显延迟，
     且软键盘弹起触发重排，看起来就是「一输入就黑屏」。 */
  function focusInput() {
    if (isMobileTerm() && els.ta) { try { els.ta.focus({ preventScroll: true }); return; } catch (_) {} }
    if (mode === 'real' && term) { try { term.focus(); return; } catch (_) {} }
    if (els.ta) { try { els.ta.focus({ preventScroll: true }); } catch (_) { try { els.ta.focus(); } catch (__) {} } }
  }
  /* 软键盘弹起 / 旋屏造成的尺寸抖动做去抖，避免 xterm 反复 resize 重排（黑屏闪烁） */
  function stableFit() { if (fitDeb) clearTimeout(fitDeb); fitDeb = setTimeout(function () { fitDeb = null; fit(); }, 240); }

  function historyPrev() {
    if (!sim.history.length) return;
    sim.hIndex = Math.max(0, sim.hIndex - 1);
    if (els.ta) { els.ta.value = sim.history[sim.hIndex] || ''; moveCaretEnd(); }
  }
  function historyNext() {
    if (!sim.history.length) return;
    sim.hIndex = Math.min(sim.history.length, sim.hIndex + 1);
    if (els.ta) { els.ta.value = sim.history[sim.hIndex] || ''; moveCaretEnd(); }
  }
  function moveCaretEnd() { try { var n = els.ta.value.length; els.ta.setSelectionRange(n, n); } catch (_) {} }

  function doClear() {
    if (mode === 'real' && term) { try { term.clear(); } catch (_) {} return; }
    simLines.length = 0;
    if (els.fallback) while (els.fallback.firstChild) els.fallback.removeChild(els.fallback.firstChild);
    if (mode === 'sim') simPrompt();
  }

  function copyAll() {
    var text = '';
    if (mode === 'real' && term && typeof term.selectAll === 'function') {
      try { term.selectAll(); text = term.getSelection() || ''; } catch (_) { text = ''; }
      try { term.clearSelection && term.clearSelection(); } catch (_) {}
    } else {
      var buf = [];
      for (var i = 0; i < simLines.length; i++) buf.push(simLines[i].t);
      text = buf.join('\n');
    }
    if (!text) { toast('没有可复制的内容', 'warn'); return; }
    var u = U();
    if (u && u.copy) u.copy(text).then(function () { toast('终端输出已复制', 'ok'); }, function () { toast('复制失败', 'err'); });
  }

  function toast(text, type) {
    if (A.toast) { A.toast(text, type); return; }
    if (A.bus) A.bus.emit('toast', { text: text, type: type });
  }

  function bindInput() {
    var ta = els.ta;
    if (!ta || bound) return;
    bound = true;
    on(ta, 'keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var line = ta.value;
        ta.value = '';
        if (mode === 'real' && wsAlive) {
          if (!term) simPrint(promptLabel() + ' ' + line, 'accent');   // 纯文本直连：本地回显
          sendInput(line + '\r');
        }
        else if (mode === 'connecting') { simPrint('—— 终端后端正在连接中，请稍候 ——', 'warn'); simPrompt(); }
        else { if (mode !== 'sim') startSim('后端不可达'); runSim(line); }
        return;
      }
      if (e.key === 'ArrowUp') { e.preventDefault(); historyPrev(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); historyNext(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (mode !== 'sim') return;
        var r = complete(ta.value);
        if (r && r.value != null) { ta.value = r.value; moveCaretEnd(); }
        return;
      }
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doClear(); return; }
      if (e.key === 'c' && e.ctrlKey && !ta.value) {
        e.preventDefault();
        if (mode === 'real' && wsAlive) { if (!term) simPrint(promptLabel() + ' ^C', 'dim'); sendInput('\u0003'); }
        else { simPrint(promptLabel() + ' ^C', 'dim'); simPrompt(); }
      }
    });
    on(ta, 'focus', function () { ta.classList.add('rb-term__input--on'); });
    on(ta, 'blur', function () { ta.classList.remove('rb-term__input--on'); });
    on(els.screen, 'click', function (e) {
      if (e.target === ta || ta.contains(e.target)) return;
      if (window.getSelection && String(window.getSelection()).length) return;
      focusInput();
    });
  }

  /* ============================================================ 生命周期 */
  function mount(host) {
    disposed = false;
    build(host);
    if (els.xtermHost && mode === 'real' && term) els.xtermHost.removeAttribute('hidden');
    if (els.fallback && mode === 'real' && term && !rawMode) els.fallback.setAttribute('hidden', 'hidden');
    if (els.fallback && mode === 'real' && rawMode) els.fallback.removeAttribute('hidden');
    if (mode === 'sim') { replaySim(); if (!simLines.length) simPrompt(); }
    else if (mode === 'real' && rawMode) { replaySim(); if (!simLines.length) simPrompt(); }
    bindInput();
    bindBus();
    if (fitTimer) clearInterval(fitTimer);
    fitTimer = setInterval(fit, 700);
    on(window, 'resize', stableFit);
    if (window.visualViewport) on(window.visualViewport, 'resize', stableFit);
    if (window.ResizeObserver && els.screen && !ro) {
      try { ro = new ResizeObserver(function () { stableFit(); }); ro.observe(els.screen); } catch (_) { ro = null; }
    }
    if (mode === 'idle') connect();
    else if (mode === 'sim') { setBadge('ok', 'AYCHO Shell'); status('ok', 'AYCHO Shell 已就绪'); }
    else if (mode === 'real') { setBadge('ok', '真实终端 · 已连接'); status('ok', '真实终端 · bash 已连接'); }
    setTimeout(function () { fit(); focusInput(); }, 60);
  }

  function unmount() {
    if (fitTimer) { clearInterval(fitTimer); fitTimer = null; }
    offAll();
    bound = false;
    if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; }
    if (ws) { try { ws.close(); } catch (_) {} ws = null; wsAlive = false; }
    if (term) { try { term.dispose(); } catch (_) {} term = null; }
    if (mode === 'real') { mode = 'idle'; rawMode = false; }
  }

  function bindBus() {
    if (busBound || !A.bus) return;
    busBound = true;
    A.bus.on('terminal:run', function (p) {
      var cmd = p && (p.cmd || p.command || p.text);
      if (!cmd) return;
      var byUser = !!(p && p.byUser);
      /* 危险指令闸门：AI / 外部入口发起的 rm、kill、格式化等需身份核验后才执行 */
      if (A.danger && A.danger.guard) {
        A.danger.guard(cmd, { byUser: byUser }).then(function (ok) {
          if (ok) runCommand(cmd);
          else simPrint('—— 已取消执行：危险指令未通过身份核验 ——', 'warn');
        }, function () { simPrint('—— 已取消执行：核验过程出错 ——', 'warn'); });
        return;
      }
      runCommand(cmd);
    });
    A.bus.on('terminal:out', function (p) {
      var data = p && (p.data != null ? p.data : p.text);
      if (data == null) return;
      if (mode === 'real' && term) { term.writeln(String(data)); return; }
      var lines = String(data).split('\n');
      for (var i = 0; i < lines.length; i++) simPrint(lines[i], '');
      if (mode === 'sim') simPrompt();
    });
    A.bus.on('file:save', function () { if (mode === 'real' && term && A.store) { /* 由 file 面板提示，这里仅保持终端聚焦 */ } });
  }

  A.ready(function () {
    // 后端在运行中被接通（设置页手填网关）后，自动切回真实终端
    if (A.bus && A.bus.on) {
      A.bus.on('api:ready', function (d) {
        if (d && d.online && mode === 'sim' && !disposed) reconnect();
      });
    }
    A.register('right-panel', 'terminal', {
      title: '终端', icon: 'terminal', order: 10,
      mount: mount, unmount: unmount
    });
    A.terminal = A.terminal || {};
    A.terminal.run = function (line, opts) {
      /* 编程式调用（AI 工具 / 外部脚本）默认走危险指令闸门；显式 byUser:true 才免审 */
      if (A.danger && A.danger.guard) {
        A.danger.guard(line, opts || {}).then(function (ok) { if (ok) runCommand(line); });
        return;
      }
      runCommand(line);
    };
    A.terminal.focus = focusInput;
    A.terminal.mode = function () { return mode; };
    A.terminal.reconnect = reconnect;
    A.terminal.useXterm = function (mod) { A.xterm = mod || null; xtermPromise = null; };
  });
})();
