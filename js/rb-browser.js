/* AYCHO module: rb-browser | owner: B | contract: v1 */
/* 浏览器面板：地址栏 / 前进后退 / 刷新 / 收藏书签（localStorage aycho.browser.v1）/ 内嵌 iframe + 加载失败降级为外链提示。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var MARKS_KEY = 'aycho.browser.v1';
  var LOAD_TIMEOUT = 7000;
  var els = null;
  var mounted = false;
  var offs = [];
  var timers = [];

  var hist = [];
  var hIndex = -1;
  var current = '';
  var loading = false;
  var loadTimer = null;
  var proxied = false;   // 当前 iframe 是否走服务端代理 /api/browser/proxy
  var marks = [];

  /* --------------------------------------------------------------- 基础 */
  function U() { return A.util || {}; }
  function el() { var u = U(); return u.el ? u.el.apply(null, arguments) : null; }
  function icon(name, size, cls) {
    if (A.icons && A.icons.svg) return A.icons.svg(name, size || 16, cls);
    if (A.icons && A.icons.node) return A.icons.node(name, size || 16);
    return null;
  }
  function toast(t, ty) { if (A.toast) A.toast(t, ty); }
  function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers.length = 0; }

  /* --------------------------------------------------------------- 书签 */
  function loadMarks() {
    try {
      var raw = localStorage.getItem(MARKS_KEY);
      var arr = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (m) { return m && typeof m.url === 'string'; }).slice(0, 24);
    } catch (_) { return []; }
  }
  function saveMarks() {
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (_) {}
  }
  function markOf(url) {
    for (var i = 0; i < marks.length; i++) if (marks[i].url === url) return marks[i];
    return null;
  }
  function toggleMark(url) {
    if (!url) return;
    var m = markOf(url);
    if (m) {
      marks = marks.filter(function (x) { return x.url !== url; });
      toast('已取消收藏', 'ok');
    } else {
      marks = marks.concat([{ url: url, title: hostOf(url) || url, addedAt: Date.now() }]).slice(-24);
      toast('已收藏当前页面', 'ok');
    }
    saveMarks();
    renderMarks();
  }

  /* --------------------------------------------------------------- URL */
  function isUrlLike(s) {
    var v = String(s || '').trim();
    if (!v) return false;
    if (/\s/.test(v)) return false;
    if (/^https?:\/\//i.test(v)) return true;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|:\d+)/i.test(v)) return true;
    if (/^localhost(:\d+)?(\/|$)/i.test(v)) return true;
    return false;
  }
  function normalizeUrl(input) {
    var v = String(input || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^file:\/\//i.test(v)) return v;
    if (isUrlLike(v)) return 'https://' + v;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(v);
  }
  function hostOf(url) {
    var u = U().parseUrl;
    var parts = null;
    try { parts = u ? u(url) : null; } catch (_) {}
    if (parts && parts.host) return parts.host;
    try { return String(new URL(url).host); } catch (_) {}
    var m = String(url || '').match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1] : '';
  }

  /* --------------------------------------------------------------- 加载 */
  function setBusy(on, hint) {
    loading = !!on;
    if (els) {
      if (els.prog) els.prog.classList.toggle('rb-bw__prog--on', loading);
      if (els.back) els.back.disabled = hIndex <= 0;
      if (els.fwd) els.fwd.disabled = hIndex >= hist.length - 1;
      if (els.reload) {
        els.reload.textContent = '';
        els.reload.appendChild(icon(loading ? 'x' : 'refresh', 16));
        els.reload.setAttribute('title', loading ? '停止加载' : '刷新');
      }
    }
    if (loading && hint) showBlocked('loading', hint);
    else if (!loading) hideBlocked();
  }

  function showBlocked(kind, extra) {
    if (!els || !els.blocked) return;
    var title = '', desc = '', spin = false, actions = [];
    if (kind === 'loading') {
      title = '正在加载';
      desc = extra || current || '';
      spin = true;
      actions.push({ label: '停止', onClick: function () { stopLoad(); hideBlocked(); } });
    } else if (kind === 'blocked') {
      title = '该站点拒绝了面板内嵌';
      desc = (extra || current) + '\n许多站点通过 X-Frame-Options / CSP 禁止被嵌入。可改用新窗口打开。';
      actions.push({ label: '在新窗口打开', kind: 'primary', onClick: function () { openExternal(current); } });
      actions.push({ label: '重试', onClick: function () { reload(); } });
    } else {
      title = '未开始浏览';
      desc = '输入网址或搜索关键词后回车，或点上方收藏快速访问。';
      if (marks.length) actions.push({ label: '打开第一个收藏', onClick: function () { if (marks[0]) loadUrl(marks[0].url); } });
    }
    els.blocked.textContent = '';
    els.blocked.style.display = '';
    if (spin) els.blocked.appendChild(el('div', { class: 'rb-bw__spin' }));
    else els.blocked.appendChild(icon('external', 22));
    els.blocked.appendChild(el('h4', { text: title }));
    var p = el('p', { text: desc });
    els.blocked.appendChild(p);
    if (actions.length) {
      var bar = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center' });
      for (var i = 0; i < actions.length; i++) {
        (function (a) {
          bar.appendChild(el('button', { class: 'rb-btn' + (a.kind === 'primary' ? ' rb-btn--pri' : ''), type: 'button', onclick: function () { a.onClick(); } }, a.label));
        })(actions[i]);
      }
      els.blocked.appendChild(bar);
    }
  }
  function hideBlocked() { if (els && els.blocked) { els.blocked.style.display = 'none'; els.blocked.textContent = ''; } }

  function stopLoad() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    if (els && els.frame) { try { els.frame.setAttribute('src', 'about:blank'); } catch (_) {} }
    setBusy(false);
  }

  function loadUrl(input, opts) {
    opts = opts || {};
    var url = /^https?:\/\//i.test(String(input || '')) || /^file:\/\//i.test(String(input || '')) ? String(input).trim() : normalizeUrl(input);
    if (!url) return;
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    current = url;
    if (els && els.addr) els.addr.value = url;
    if (!opts.replace) {
      hist = hist.slice(0, hIndex + 1);
      hist.push(url);
      hIndex = hist.length - 1;
    }
    showFrame(url);
    if (A.bus && !opts.silent && !opts.fromEvent) A.bus.emit('browser:navigate', { url: url });
  }

  /* 服务端代理可用性：后端在线且是 http(s) 网址时，默认走代理渲染，
     这样 X-Frame-Options / CSP 禁止内嵌的站点也能真打开。 */
  function canProxy(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    // 代理必须指向真实后端（网关绝对地址）；纯静态站没有后端，走代理只会拿到 404
    return !!apiBase();
  }
  /* 关键：静态托管站（如 GitHub Pages）本身没有后端，必须把请求发给网关绝对地址；
     否则 /api/browser/proxy 会命中静态站的 404 页面 —— 这就是“假浏览器”的根因。 */
  function apiBase() {
    try {
      if (A.api && typeof A.api.base === 'function') {
        var b = String(A.api.base() || '').replace(/\/+$/, '');
        if (b) return b;
      }
    } catch (_) {}
    try { if (window.AYCHO_API_BASE) return String(window.AYCHO_API_BASE).replace(/\/+$/, ''); } catch (_) {}
    return '';
  }
  function proxySrc(url) { return apiBase() + '/api/browser/proxy?url=' + encodeURIComponent(url); }

  function showFrame(url, opts) {
    if (!els || !els.frame) return;
    opts = opts || {};
    proxied = opts.direct ? false : canProxy(url);
    setBusy(true, url);
    var src = url;
    if (proxied) {
      src = proxySrc(url);
      toast('经服务端代理打开：' + hostOf(url), 'ok');
    }
    try { els.frame.setAttribute('src', src); } catch (_) {}
    loadTimer = setTimeout(function () {
      loadTimer = null;
      if (!loading) return;
      // 超时未 load：代理也打不开时，最后再试一次直连
      if (proxied) { showFrame(url, { direct: true }); return; }
      setBusy(false);
      showBlocked('blocked', url);
    }, LOAD_TIMEOUT);
  }

  function onFrameLoad() {
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    var blank = false;
    try { blank = !els.frame.getAttribute('src') || els.frame.getAttribute('src') === 'about:blank'; } catch (_) {}
    if (blank) return;
    setBusy(false);
    if (A.rightPanel && A.rightPanel.setStatus) A.rightPanel.setStatus('ok', hostOf(current) || '浏览器');
  }

  function go(delta) {
    var next = hIndex + delta;
    if (next < 0 || next >= hist.length) return;
    hIndex = next;
    current = hist[hIndex];
    if (els && els.addr) els.addr.value = current;
    showFrame(current);
  }
  function back() { go(-1); }
  function forward() { go(1); }
  function reload() { if (current) showFrame(current); else loadUrl(els && els.addr ? els.addr.value : ''); }
  function openExternal(url) {
    if (!url) return;
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (_) {}
    if (U().copy) { try { U().copy(url); } catch (_) {} }
    toast('已在新窗口打开（链接已复制）', 'ok');
  }

  /* --------------------------------------------------------------- 渲染 */
  function renderMarks() {
    if (!els || !els.marks) return;
    var box = els.marks;
    box.textContent = '';
    if (!marks.length) {
      box.appendChild(el('span', { class: 'rb-bw__chip', style: 'pointer-events:none;opacity:.6' }, icon('link', 13), el('span', { text: '暂无收藏' })));
      return;
    }
    for (var i = 0; i < marks.length; i++) {
      (function (m) {
        var chip = el('button', {
          class: 'rb-bw__chip' + (m.url === current ? ' rb-bw__chip--on' : ''), type: 'button', title: m.url,
          onclick: function () { loadUrl(m.url); }
        }, icon('link', 13), el('span', { text: String(m.title || hostOf(m.url) || m.url).slice(0, 18) }));
        var x = el('span', {
          class: 'rb-bw__chipx', role: 'button', tabindex: '0', title: '移除收藏',
          onclick: function (e) { e.stopPropagation(); marks = marks.filter(function (y) { return y.url !== m.url; }); saveMarks(); renderMarks(); }
        }, icon('x', 12));
        chip.appendChild(x);
        box.appendChild(chip);
      })(marks[i]);
    }
  }

  function syncNavUI() {
    if (!els) return;
    if (els.back) els.back.disabled = hIndex <= 0;
    if (els.fwd) els.fwd.disabled = hIndex >= hist.length - 1;
    if (els.markBtn) els.markBtn.setAttribute('aria-pressed', markOf(current) ? 'true' : 'false');
  }

  /* --------------------------------------------------------------- 构建 */
  function build(host) {
    var addr = el('input', { type: 'text', placeholder: '输入网址，或输入关键词用 Bing 搜索', 'aria-label': '地址栏', spellcheck: 'false', enterkeyhint: 'go', inputmode: 'url' });
    addr.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); loadUrl(addr.value); }
      else if (e.key === 'Escape') { addr.value = current; }
    });
    var addrWrap = el('div', { class: 'rb-field', style: 'flex:1 1 auto;min-width:0' }, icon('search', 14), addr);
    /* 手机软键盘不一定有「前往/回车」，必须给一个看得见、点得动的按钮 */
    var goBtn = el('button', {
      class: 'rb-btn rb-btn--pri rb-bw__go', type: 'button', title: '前往 / 用 Bing 搜索', 'aria-label': '前往或用 Bing 搜索',
      onclick: function () { loadUrl(addr.value); }
    }, icon('search', 15), el('span', { text: '前往' }));

    var backBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '后退', 'aria-label': '后退', disabled: 'disabled', onclick: function () { back(); } }, icon('chevronLeft', 16));
    var fwdBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '前进', 'aria-label': '前进', disabled: 'disabled', onclick: function () { forward(); } }, icon('chevronRight', 16));
    var reloadBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '刷新', 'aria-label': '刷新', onclick: function () { if (loading) { stopLoad(); hideBlocked(); } else reload(); } }, icon('refresh', 16));

    var bar = el('div', { class: 'rb-bw__bar' },
      el('div', { class: 'rb-bw__nav' }, backBtn, fwdBtn, reloadBtn),
      addrWrap,
      goBtn,
      el('button', { class: 'rb-iconbtn', type: 'button', title: '新窗口打开', 'aria-label': '新窗口打开', onclick: function () { openExternal(current || addr.value); } }, icon('external', 16))
    );

    var markBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '收藏当前页', 'aria-label': '收藏当前页', onclick: function () { toggleMark(current); syncNavUI(); } }, icon('plus', 15));
    var marksRow = el('div', { class: 'rb-bw__marks' });
    var marksHead = el('div', { class: 'rb-bw__marks', style: 'padding-top:0' },
      el('span', { class: 'rb-toolbar__title', text: '收藏' }), markBtn, marksRow
    );

    var frame = el('iframe', {
      class: 'rb-bw__frame', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
      referrerpolicy: 'no-referrer', loading: 'lazy', title: '内嵌浏览器'
    });
    frame.addEventListener('load', onFrameLoad);

    var prog = el('div', { class: 'rb-bw__prog' });
    var blocked = el('div', { class: 'rb-bw__blocked' });
    var stage = el('div', { class: 'rb-bw__stage' }, frame, prog, blocked);

    var root = el('div', { class: 'rb-bw' }, bar, marksHead, stage);
    els = { root: root, addr: addr, frame: frame, blocked: blocked, prog: prog, marks: marksRow, back: backBtn, fwd: fwdBtn, reload: reloadBtn, markBtn: markBtn, stage: stage };
    host.appendChild(root);

    marks = loadMarks();
    renderMarks();
    syncNavUI();
    showBlocked('idle');
  }

  /* --------------------------------------------------------------- 事件 */
  function bind() {
    if (!A.bus) return;
    var onNav = function (p) {
      if (!p || !p.url) return;
      if (A.store && A.store.get('ui.rightTab', '') !== 'browser') A.bus.emit('panel:open', { tab: 'browser' });
      if (mounted && els) loadUrl(p.url, { fromEvent: true });
      else pendingUrl = p.url;
    };
    A.bus.on('browser:navigate', onNav);
    offs.push(function () { A.bus.off('browser:navigate', onNav); });
  }
  var pendingUrl = '';

  /* --------------------------------------------------------------- 生命周期 */
  function mount(host) {
    if (!host) return;
    mounted = true;
    if (!els) build(host); else { host.appendChild(els.root); renderMarks(); syncNavUI(); }
    if (pendingUrl) { loadUrl(pendingUrl); pendingUrl = ''; }
    if (A.rightPanel && A.rightPanel.setStatus) A.rightPanel.setStatus('off', current ? hostOf(current) : '浏览器：未加载');
  }
  function unmount() {
    mounted = false;
    clearTimers();
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
    loading = false;
    if (A.ui && A.ui.closeAll) { try { A.ui.closeAll(); } catch (_) {} }
    if (els && els.frame) { try { els.frame.setAttribute('src', 'about:blank'); } catch (_) {} }
    if (els && els.root && els.root.parentNode) els.root.parentNode.removeChild(els.root);
  }
  function offAll() { for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (_) {} } offs.length = 0; }

  A.ready(function () {
    A.register('right-panel', 'browser', {
      title: '浏览器', icon: 'browser', order: 40,
      mount: mount, unmount: unmount
    });
    bind();
  });

  A.browser = {
    open: function (url) { loadUrl(url); return current; },
    back: back,
    forward: forward,
    reload: reload,
    marks: function () { return marks.slice(); },
    current: function () { return current; },
    host: hostOf,
    _offAll: offAll
  };
})();
