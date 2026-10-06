/* AYCHO module: js/ide-real | owner: B | contract: v1 */
/* IDE 真实性层：把 IDE / 项目文件接到服务端真实工作区（/api/fs/*、/api/run）。
   · 打开 IDE 即拉取服务端目录（不再凭空列不存在的文件）
   · 保存 = 真写磁盘；运行 = 真执行（node / python3 / gcc / g++ / javac）
   · 后端不可达时明确显示「离线草稿」，不假装已落盘 */
(function () {
  'use strict';
  var A = window.AYCHO = window.AYCHO || {};
  var ROOT = '/workspace';
  var injected = false;
  var compilers = null;
  var writeChain = Promise.resolve();

  function S(p, d) { return A.store ? A.store.get(p, d) : d; }
  function set(p, v) { if (A.store) A.store.set(p, v); }
  function toast(t, ty) { if (A.toast) A.toast(t, ty || 'info'); else if (A.bus) A.bus.emit('toast', { text: t, type: ty || 'info' }); }
  function online() { try { return !!(A.api && A.api.base && A.api.base()); } catch (e) { return false; } }
  function req(method, path, body) { return A.api.request(method, path, body); }

  function toClient(it) {
    return {
      path: ROOT + (it.path === '/' ? '' : it.path), kind: it.kind,
      content: it.content == null ? '' : it.content,
      updatedAt: it.updatedAt || Date.now(), server: true
    };
  }
  function toServer(p) {
    var s = String(p || '');
    if (s.indexOf(ROOT) === 0) s = s.slice(ROOT.length);
    if (!s) s = '/';
    if (s.charAt(0) !== '/') s = '/' + s;
    return s;
  }

  /* ---------------- 拉取真实工作区 ---------------- */
  function refresh(silent) {
    if (!online()) { renderNet(); return Promise.resolve(false); }
    return req('GET', '/api/fs/tree?withContent=1').then(function (r) {
      var items = (r && r.items) || [];
      set('projectFiles', items.map(toClient));
      renderNet();
      if (!silent) toast('已同步工作区：' + items.length + ' 项（服务端真实磁盘）', 'ok');
      return true;
    }).catch(function (e) {
      renderNet();
      if (!silent) toast('同步工作区失败：' + (e && e.message || e), 'warn');
      return false;
    });
  }

  /* ---------------- 保存 = 真写盘 ---------------- */
  function pushFile(path, content) {
    if (!online()) { toast('后端未连接：改动只保存在本机草稿，未落盘', 'warn'); return Promise.resolve(false); }
    writeChain = writeChain.then(function () {
      return req('POST', '/api/fs/write', { path: toServer(path), content: content == null ? '' : String(content) })
        .then(function (r) { if (r && r.ok === false) throw new Error(r.message || '写入被拒绝'); return true; })
        .catch(function (e) { toast('写入服务端失败：' + (e && e.message || e), 'warn'); return false; });
    });
    return writeChain;
  }

  /* ---------------- 当前文件 ---------------- */
  function currentPath() {
    var el = document.querySelector('.rb-ide__path');
    var t = el ? String(el.textContent || '').trim() : '';
    if (!t || t === '未打开文件') return '';
    if (t === 'workspace') return ROOT;
    return ROOT + '/' + t.replace(/^\/+/, '');
  }
  function currentContent() {
    var ta = document.querySelector('.rb-ide__ta');
    return ta ? String(ta.value || '') : '';
  }

  /* ---------------- 运行 ---------------- */
  function cmdFor(p) {
    if (/\.py$/.test(p)) return 'python3 ' + p;
    if (/\.(js|mjs|cjs)$/.test(p)) return 'node ' + p;
    if (/\.(sh|bash)$/.test(p)) return 'bash ' + p;
    if (/\.c$/.test(p)) return 'mkdir -p .build && gcc ' + p + ' -o .build/a.out && .build/a.out';
    if (/\.(cpp|cc|cxx)$/.test(p)) return 'mkdir -p .build && g++ ' + p + ' -o .build/a.out && .build/a.out';
    if (/\.java$/.test(p)) {
      var cls = p.slice(p.lastIndexOf('/') + 1).replace(/\.java$/, '');
      return 'mkdir -p .build && javac -d .build ' + p + ' && java -cp .build ' + cls;
    }
    if (/\.go$/.test(p)) return 'go run ' + p;
    if (/\.php$/.test(p)) return 'php ' + p;
    if (/\.rb$/.test(p)) return 'ruby ' + p;
    return 'cat ' + p;
  }

  function runCurrent() {
    var p = currentPath();
    if (!p) { toast('请先打开一个文件', 'warn'); return; }
    showOut();
    if (!online()) { appendOut('后端未连接：无法执行（IDE 只能编辑草稿）\n'); return; }
    var cmd = cmdFor(p);
    appendOut('$ ' + cmd + '\n');
    var cwd = p.slice(0, p.lastIndexOf('/')) || ROOT;
    pushFile(p, currentContent()).then(function () {
      return req('POST', '/api/run', { cmd: cmd, cwd: cwd });
    }).then(function (r) {
      var o = (r && r.stdout) || '', e = (r && r.stderr) || '';
      appendOut(o + (e ? (o && !/\n$/.test(o) ? '\n' : '') + e : ''));
      appendOut('\n[exit ' + ((r && r.code) | 0) + ' · ' + ((r && r.ms) || 0) + 'ms]\n');
      if (r && r.ok) toast('运行完成', 'ok'); else toast('运行结束，见输出', 'warn');
    }).catch(function (err) { appendOut('执行失败：' + (err && err.message || err) + '\n'); });
  }

  /* ---------------- 目录增删改（真落盘） ---------------- */
  function mkdir(path) {
    if (!online()) { toast('后端未连接：新建只在本机草稿，未落盘', 'warn'); return Promise.resolve(false); }
    return req('POST', '/api/fs/mkdir', { path: toServer(path) })
      .then(function (r) { if (r && r.ok === false) throw new Error(r.message || '创建被拒绝'); return true; })
      .catch(function (e) { toast('创建服务端目录失败：' + (e && e.message || e), 'warn'); return false; });
  }
  function rename(from, to) {
    if (!online()) { toast('后端未连接：重命名只在本机草稿，未落盘', 'warn'); return Promise.resolve(false); }
    return req('POST', '/api/fs/rename', { from: toServer(from), to: toServer(to) })
      .then(function (r) { if (r && r.ok === false) throw new Error(r.message || '重命名被拒绝'); return true; })
      .catch(function (e) { toast('服务端重命名失败：' + (e && e.message || e), 'warn'); return false; });
  }
  function remove(path) {
    if (!online()) { toast('后端未连接：删除只在本机草稿，服务端文件仍在', 'warn'); return Promise.resolve(false); }
    return req('POST', '/api/fs/delete', { path: toServer(path) })
      .then(function (r) { if (r && r.ok === false) throw new Error(r.message || '删除被拒绝'); return true; })
      .catch(function (e) { toast('服务端删除失败：' + (e && e.message || e), 'warn'); return false; });
  }

  /* ---------------- 内置可用编译器探测（真实检测，不虚构） ---------------- */
  function probe(silent) {
    if (!online()) { renderNet(); return Promise.resolve(null); }
    return req('POST', '/api/run', {
      cmd: 'for c in node python3 gcc g++ javac java go php ruby; do printf "%s=" $c; command -v $c >/dev/null 2>&1 && echo yes || echo no; done',
      cwd: '/'
    }).then(function (r) {
      var map = {};
      String((r && r.stdout) || '').split('\n').forEach(function (l) {
        var m = /^([A-Za-z+0-9]+)=(yes|no)$/.exec(l.trim());
        if (m) map[m[1]] = m[2] === 'yes';
      });
      compilers = map;
      renderNet();
      return map;
    }).catch(function () { renderNet(); return null; });
  }

  /* ---------------- 界面注入 ---------------- */
  var ICON_RUN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_SYNC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>';

  function mkBtn(text, icon) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-btn rb-btn--ghost rb-ide__xbtn';
    b.innerHTML = icon + '<span>' + text + '</span>';
    return b;
  }

  function ensureUI() {
    var root = document.querySelector('.rb-ide');
    if (!root) { injected = false; return; }
    if (injected && document.body.contains(root.querySelector('.rb-ide__net'))) return;
    var toolbar = root.querySelector('.rb-toolbar');
    var status = root.querySelector('.rb-ide__status');
    if (!toolbar || !status) return;
    injected = true;

    var saveBtn = toolbar.querySelector('.rb-btn--pri');
    var runBtn = mkBtn('运行', ICON_RUN);
    runBtn.title = '保存并执行当前文件（服务端真实运行）';
    runBtn.addEventListener('click', runCurrent);
    var syncBtn = mkBtn('同步', ICON_SYNC);
    syncBtn.title = '从服务端重新拉取工作区文件';
    syncBtn.addEventListener('click', function () { refresh(); probe(true); });
    toolbar.insertBefore(runBtn, saveBtn || null);
    toolbar.insertBefore(syncBtn, runBtn);

    var net = document.createElement('div');
    net.className = 'rb-ide__net';
    root.insertBefore(net, status);

    var pane = document.createElement('div');
    pane.className = 'rb-ide__out';
    pane.hidden = true;
    pane.innerHTML = '<div class="rb-ide__outhead"><b>运行输出</b>' +
      '<span class="rb-ide__outsp"></span>' +
      '<button type="button" class="rb-ide__outbtn" data-act="clear">清空</button>' +
      '<button type="button" class="rb-ide__outbtn" data-act="close">收起</button></div>' +
      '<pre class="rb-ide__outbody"></pre>';
    root.appendChild(pane);
    pane.addEventListener('click', function (e) {
      var t = e.target, act = t && t.getAttribute && t.getAttribute('data-act');
      if (act === 'clear') { setOut(''); }
      if (act === 'close') { pane.hidden = true; }
    });
    renderNet();
  }

  var outText = '';
  function showOut() { var p = document.querySelector('.rb-ide__out'); if (p) p.hidden = false; }
  function appendOut(s) {
    var p = document.querySelector('.rb-ide__outbody');
    if (!p) return;
    outText = (p.textContent || '') + String(s == null ? '' : s);
    p.textContent = outText;
    p.scrollTop = p.scrollHeight;
  }
  function setOut(s) {
    var p = document.querySelector('.rb-ide__outbody');
    outText = String(s == null ? '' : s);
    if (p) p.textContent = outText;
  }

  function renderNet() {
    var net = document.querySelector('.rb-ide__net');
    if (!net) return;
    var on = online();
    var badge = compilers ? ['node', 'python3', 'gcc', 'g++', 'javac', 'java'].map(function (k) {
      return '<span class="rb-ide__cc' + (compilers[k] ? ' is-on' : '') + '">' + k + (compilers[k] ? ' ✓' : ' ✗') + '</span>';
    }).join('') : '<span class="rb-ide__cc">编译器检测中…</span>';
    net.innerHTML = '<span class="rb-ide__netdot' + (on ? ' is-on' : '') + '"></span>' +
      '<span class="rb-ide__nettext">' + (on ? '服务端工作区已连接 · 保存即落盘' : '离线草稿 · 未连接后端，改动不会落盘') + '</span>' +
      '<span class="rb-ide__netsplit"></span>' + badge;
  }

  /* ---------------- 装配 ---------------- */
  function boot() {
    ensureUI();
    if (A.bus) {
      A.bus.on('file:save', function (p) { if (p && p.path) pushFile(p.path, p.content); });
      A.bus.on('panel:open', function (p) { if (p && p.tab === 'ide') { ensureUI(); refresh(true); } });
    }
    try {
      var mo = new MutationObserver(function () { ensureUI(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    if (online()) { refresh(true).then(function (ok) { if (ok) probe(true); }); }
    A.ready ? A.ready(function () { if (online()) { refresh(true); probe(true); } else renderNet(); }) : null;
  }

  A.ide = A.ide || {};
  A.ide.fs = { refresh: refresh, write: pushFile, run: runCurrent, probe: probe, toServer: toServer, online: online, mkdir: mkdir, rename: rename, remove: remove };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
