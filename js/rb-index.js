/* AYCHO module: rb-index | owner: B | contract: v1 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var ORDER = ['home', 'terminal', 'artifacts', 'files', 'browser', 'ide'];
  var FALLBACK = {
    home: { title: '开始', icon: 'menu', order: 1 },
    terminal: { title: '终端', icon: 'terminal', order: 10 },
    artifacts: { title: '产出物', icon: 'box', order: 20 },
    files: { title: '项目文件', icon: 'files', order: 30 },
    browser: { title: '浏览器', icon: 'browser', order: 40 },
    ide: { title: 'IDE', icon: 'code', order: 50 }
  };

  var root = null, shell = null, tabsEl = null, bodyEl = null;
  var footDot = null, footText = null, footFiles = null;
  var panes = {};          // id -> {el, def, mounted}
  var activeId = null;
  var pendingTimer = null;
  var statusState = { tone: 'off', text: '未连接' };

  /* 子目录入口：/terminal/ 、/browser/ 等页面用 window.AYCHO_ROUTE 指定默认面板，
     并在切换面板时把地址栏同步成对应子目录，便于复制/分享该功能的直达链接 */
  var rawRoute = (typeof window !== 'undefined' && typeof window.AYCHO_ROUTE === 'string') ? window.AYCHO_ROUTE : null;
  /* 原始入口路由，支持 settings:<tab> / view:<name> / 面板 id；页面一加载即生效，避免首帧被右栏默认面板改写地址 */
  function routeTab() {
    var r = window.AYCHO_ROUTE;
    rawRoute = r || null;
    if (!r) return null;
    if (r.indexOf('settings:') === 0 || r.indexOf('view:') === 0) return null;  // 非右栏面板入口
    return FALLBACK[r] ? r : null;
  }
  /* 各入口的独立页面标题（不再共用主标题） */
  var ROUTE_TITLE = {
    home: 'AYCHO · 开始', terminal: 'AYCHO · 终端', browser: 'AYCHO · 浏览器',
    files: 'AYCHO · 文件', artifacts: 'AYCHO · 产出物', ide: 'AYCHO · IDE',
    settings: 'AYCHO · 设置', account: 'AYCHO · 账号', chat: 'AYCHO · 对话',
    skills: 'AYCHO · 技能', mcp: 'AYCHO · MCP', memory: 'AYCHO · 记忆',
    general: 'AYCHO · 通用', advanced: 'AYCHO · 高级'
  };
  function applyRouteTitle(name) {
    var t = ROUTE_TITLE[name];
    if (t) { try { document.title = t; } catch (e) {} }
  }
  /* 面板 id → 子目录名（「开始」面板的目录名是 start，与 id home 不同名） */
  var SUBDIR = { home: 'start', terminal: 'terminal', artifacts: 'artifacts', files: 'files', browser: 'browser', ide: 'ide' };
  var routeLock = null;      // 子目录入口指定的面板
  var userTouched = false;   // 用户是否已主动操作过（操作后不再锁定入口面板）
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function () { userTouched = true; }, true);
    document.addEventListener('keydown', function () { userTouched = true; }, true);
  }
  function syncPath(id) {
    if (!window.AYCHO_SUBDIR) return;
    /* 从 settings:/account/ 这类「大路由」页面进入时，地址由大路由决定，不被右栏默认面板改写 */
    if (rawRoute && (rawRoute.indexOf('settings:') === 0 || rawRoute.indexOf('view:') === 0)) return;
    var name = SUBDIR[id];
    if (!name) return;
    applyRouteTitle(id);
    if (!/\/$/.test(location.pathname)) return;   // 仅目录形式（/terminal/）同步；file://xxx/index.html 不动
    try { history.replaceState(null, '', location.pathname.replace(/[^\/]*\/$/, name + '/')); } catch (e) {}
  }

  /* 会话即地址：/chat/{编号}/ 直达某条会话（复制地址即可分享该会话） */
  function syncChatPath() {
    if (!window.AYCHO_SUBDIR) return;
    if (!/\/$/.test(location.pathname)) return;
    /* 本页若声明了「固定大路由」（如 settings:home、ide、terminal），地址由该路由决定，不被会话地址顶掉 */
    var route = rawRoute || window.AYCHO_ROUTE || '';
    if (route && String(route).indexOf('view:') !== 0) return;
    if (S('ui.view', '') !== 'chat') return;
    var cid = S('activeConversationId', '');
    if (!cid) return;
    try {
      var next;
      if (/\/chat\/[^\/]+\/?$/.test(location.pathname)) {
        /* 已是会话地址：只替换编号，避免 /chat/chat/... 叠加 */
        next = location.pathname.replace(/\/chat\/[^\/]+\/?$/, '/chat/' + encodeURIComponent(String(cid)) + '/');
      } else {
        next = location.pathname.replace(/[^\/]+\/?$/, 'chat/' + encodeURIComponent(String(cid)) + '/');
      }
      next = next.replace(/(?:\/chat)+(?=\/)/g, '/chat');   // 折叠历史叠加
      if (next !== location.pathname) history.replaceState(null, '', next + (location.search || ''));
    } catch (e) {}
  }

  function U() { return A.util || null; }
  function el() {
    var u = U();
    if (u) return u.el.apply(u, arguments);
    return document.createElement(arguments[0]);
  }
  function icon(name, size) {
    if (A.icons && A.icons.node) return A.icons.node(name, size || 16);
    var s = document.createElement('span');
    s.textContent = '';
    return s;
  }
  function store() { return A.store || null; }
  function S(path, fallback) {
    var st = store();
    if (!st) return fallback;
    var v = st.get(path);
    return v === undefined ? fallback : v;
  }
  function setState(path, val) { if (A.store) A.store.set(path, val); }

  function panelDefs() {
    var out = [], seen = {};
    if (A.registry && A.registry.list) {
      var list = A.registry.list('right-panel');
      for (var i = 0; i < list.length; i++) {
        out.push(list[i]);
        seen[list[i].id] = 1;
      }
    }
    for (var j = 0; j < ORDER.length; j++) {
      var id = ORDER[j];
      if (!seen[id]) {
        var f = FALLBACK[id];
        out.push(id === 'home' ? homeDef() : { kind: 'right-panel', id: id, title: f.title, icon: f.icon, order: f.order, mount: null, unmount: null, missing: true });
      }
    }
    out.sort(function (a, b) {
      var oa = a.order == null ? 100 : a.order, ob = b.order == null ? 100 : b.order;
      if (oa !== ob) return oa - ob;
      return ORDER.indexOf(a.id) - ORDER.indexOf(b.id);
    });
    return out;
  }
  /* 内置「开始」面板：左栏启动页，聚合全部功能入口 */
  function homeDef() {
    return { kind: 'right-panel', id: 'home', title: '开始', icon: 'menu', order: 1, mount: mountHome, unmount: null };
  }

  function panelDef(id) {
    if (id === 'home') return homeDef();
    var d = (A.registry && A.registry.get) ? A.registry.get('right-panel', id) : null;
    if (d) return d;
    var f = FALLBACK[id];
    if (!f) return null;
    return { kind: 'right-panel', id: id, title: f.title, icon: f.icon, order: f.order, mount: null, unmount: null, missing: true };
  }

  /* ------------------------------------------------------------- 容器构建 */
  function build() {
    if (shell) return;
    var u = U();
    var aside = document.getElementById('ax-rightbar');
    if (!aside) {
      aside = document.createElement('aside');
      aside.id = 'ax-rightbar';
      (document.body || document.documentElement).appendChild(aside);
    }
    root = aside;
    root.classList.add('rb-root', 'rb-root--closed');

    tabsEl = el('div', { class: 'rb-tabs', role: 'tablist', 'aria-label': '工作台面板' });

    fullBtn = el('button', {
      class: 'rb-iconbtn', type: 'button', title: '全屏显示', 'aria-label': '全屏显示',
      onclick: function () { toggleFull(); }
    }, icon('expand', 15));

    var collapseBtn = el('button', {
      class: 'rb-iconbtn', type: 'button', title: '收起工作台 (Esc)', 'aria-label': '收起工作台',
      onclick: function () { requestClose(); }
    }, icon('x', 15));

    var head = el('div', { class: 'rb-head' }, tabsEl, fullBtn, collapseBtn);

    bodyEl = el('div', { class: 'rb-body' });

    footDot = el('i', { class: 'rb-dot' });
    footText = el('span', { text: '未连接' });
    footFiles = el('span', { text: '0 个文件' });
    var foot = el('div', { class: 'rb-foot' },
      el('span', { class: 'rb-foot__item' }, footDot, footText),
      el('span', { class: 'rb-foot__item' }, footFiles)
    );

    shell = el('div', { class: 'rb-shell rb-shell--closed' }, head, bodyEl, foot);
    root.appendChild(shell);

    renderTabs();
    applyOpen(!!S('ui.rightOpen', false), true);
    setStatus(statusState.tone, statusState.text);
    updateFileCount();
  }

  /* --------------------------------------------------------------- 页签 */
  function renderTabs() {
    if (!tabsEl) return;
    var u = U();
    while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
    var defs = panelDefs();
    for (var i = 0; i < defs.length; i++) {
      (function (def) {
        var btn = el('button', {
          class: 'rb-tab', type: 'button', role: 'tab',
          'data-tab': def.id, title: def.title,
          'aria-selected': 'false',
          onclick: function () { switchTab(def.id, true); }
        }, icon(def.icon, 15), el('span', { class: 'rb-tab__label', text: def.title }));
        tabsEl.appendChild(btn);
      })(defs[i]);
    }
    syncTabUI();
    measure();
  }

  function measure() {
    if (!shell || !tabsEl) return;
    var w = shell.clientWidth || 0;
    shell.setAttribute('data-wide', w >= 356 ? '1' : '0');
  }

  function syncTabUI() {
    if (!tabsEl) return;
    var u = U();
    var list = u ? u.$$('.rb-tab', tabsEl) : Array.prototype.slice.call(tabsEl.children);
    for (var i = 0; i < list.length; i++) {
      var on = list[i].getAttribute('data-tab') === activeId;
      list[i].classList.toggle('rb-tab--on', on);
      list[i].setAttribute('aria-selected', on ? 'true' : 'false');
      list[i].setAttribute('tabindex', on ? '0' : '-1');
    }
    var onTab = u ? u.$('.rb-tab--on', tabsEl) : null;
    if (onTab && typeof onTab.scrollIntoView === 'function') {
      try { onTab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }

  /* ----------------------------------------------------------- 面板生命周期 */
  function paneOf(id) {
    if (panes[id]) return panes[id];
    var def = panelDef(id);
    if (!def) return null;
    var box = el('section', { class: 'rb-pane', 'data-panel': id, role: 'tabpanel' });
    panes[id] = { el: box, def: def, mounted: false };
    bodyEl.appendChild(box);
    return panes[id];
  }

  /* 缺模块兜底：延迟到挂载时再判定，避免脚本加载顺序导致「面板未加载」被永久缓存 */
  function showMissing(id) {
    var p = panes[id];
    if (!p || p.el.querySelector('.ax-empty')) return;
    p.el.innerHTML = '';
    p.el.appendChild(el('div', { class: 'ax-empty' },
      icon('box', 22),
      el('div', { text: '面板未加载' }),
      el('div', { text: '请确认 ' + id + ' 面板模块已引入' })
    ));
  }

  function liveDef(id) {
    return (A.registry && A.registry.get) ? A.registry.get('right-panel', id) : null;
  }

  /* 各面板模块在自身 A.ready 里注册，晚于本模块（脚本顺序），
     此时兜底已缓存 → 注册事件到达后必须把兜底重新挂载为真实面板 */
  function healPlaceholders() {
    for (var id in panes) {
      var p = panes[id];
      if (!p || !p.el) continue;
      var live = liveDef(id);
      if (live && typeof live.mount === 'function' && p.el.querySelector('.ax-empty')) {
        p.def = live;
        p.el.innerHTML = '';
        p.mounted = false;
        mountPane(id);
      }
    }
  }

  function mountPane(id) {
    var p = paneOf(id);
    if (!p) return;
    if (!p.el.parentNode && bodyEl) bodyEl.appendChild(p.el);
    var live = liveDef(id);
    if (live) p.def = live;
    if (!p.def || p.def.missing || typeof p.def.mount !== 'function') {
      if (!live || typeof live.mount !== 'function') { showMissing(id); p.mounted = false; return; }
      p.def = live;
    }
    if (p.mounted) return;
    p.mounted = true;
    if (typeof p.def.mount === 'function') {
      try { p.def.mount(p.el); }
      catch (e) {
        console.error('[aycho:right-panel] mount ' + id, e);
        p.el.appendChild(el('div', { class: 'ax-empty' }, el('div', { text: '面板挂载失败：' + (e && e.message ? e.message : e) })));
      }
    }
  }

  function unmountPane(id, keepEl) {
    var p = panes[id];
    if (!p) return;
    if (p.mounted && typeof p.def.unmount === 'function') {
      try { p.def.unmount(); } catch (e) { console.error('[aycho:right-panel] unmount ' + id, e); }
    }
    p.mounted = false;
    if (!keepEl && p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
  }

  function showPane(id, animate) {
    var p = paneOf(id);
    if (!p) return;
    mountPane(id);
    var list = bodyEl ? bodyEl.children : [];
    for (var i = 0; i < list.length; i++) list[i].classList.remove('rb-pane--in', 'rb-pane--out');
    void p.el.offsetWidth;                       // 强制回流，让「离场态」先落地，再过渡入场
    p.el.classList.add('rb-pane--in');
  }

  function switchTab(id, fromUser) {
    if (!FALLBACK[id]) return;
    if (activeId === id) {
      if (A.store) A.store.set('ui.rightTab', id);
      return;
    }
    var prev = activeId;
    activeId = id;
    if (prev && panes[prev]) {
      panes[prev].el.classList.remove('rb-pane--in');
      panes[prev].el.classList.add('rb-pane--out');
    }
    showPane(id, prev ? true : false);
    syncTabUI();
    if (A.store) A.store.set('ui.rightTab', id);
    syncPath(id);
    if (fromUser) measure();
  }

  /* ------------------------------------------------------------- 开关 */
  function applyOpen(open, instant) {
    if (!root || !shell) return;
    /* 主骨架栅格列宽由 #ax-app 的 class 控制：任何开关路径都必须同步，否则「只藏内容不收面板」 */
    var appNode = document.getElementById('ax-app');
    if (appNode) appNode.classList.toggle('is-right-open', !!open);
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (open) {
      root.classList.remove('rb-root--closed');
      measure();
      if (instant) {
        shell.classList.remove('rb-shell--closed');
      } else {
        var u = U();
        var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
        raf(function () { raf(function () { if (shell) shell.classList.remove('rb-shell--closed'); }); });
      }
      if (!activeId) switchTab(S('ui.rightTab', 'home') || 'home', false);
      else showPane(activeId, !instant);
    } else {
      var cur = activeId;
      if (cur && panes[cur]) {
        panes[cur].el.classList.remove('rb-pane--in');
        panes[cur].el.classList.add('rb-pane--out');
      }
      shell.classList.add('rb-shell--closed');
      if (instant) { root.classList.add('rb-root--closed'); }
      else {
        pendingTimer = setTimeout(function () {
          pendingTimer = null;
          if (root) root.classList.add('rb-root--closed');
        }, 190);
      }
      for (var k in panes) unmountPane(k, true);
    }
  }

  function setOpen(open) {
    open = !!open;
    if (!A.store) { applyOpen(open, false); return; }
    if (!!S('ui.rightOpen', false) !== open) A.store.set('ui.rightOpen', open);  // 订阅者负责 applyOpen
    else applyOpen(open, false);
  }

  function requestOpen(tab) {
    build();
    if (tab && FALLBACK[tab]) {
      if (activeId !== tab) switchTab(tab, true);
      else A.store && A.store.set('ui.rightTab', tab);
    }
    setOpen(true);
  }
  /* 全屏：右栏从「侧栏」提升为整屏工作区（移动端尤其需要） */
  var fullBtn = null;
  function isFull() { var app = document.getElementById('ax-app'); return !!(app && app.classList.contains('is-right-full')); }
  function applyFull(on) {
    var app = document.getElementById('ax-app');
    if (app) app.classList.toggle('is-right-full', !!on);
    if (fullBtn) {
      fullBtn.innerHTML = icon(on ? 'compress' : 'expand', 15);
      fullBtn.setAttribute('title', on ? '退出全屏' : '全屏显示');
      fullBtn.setAttribute('aria-label', on ? '退出全屏' : '全屏显示');
      fullBtn.classList.toggle('is-on', !!on);
    }
    if (A.store && A.store.set) { try { A.store.set('ui.rightFull', !!on); } catch (_) {} }
  }
  function toggleFull() { applyFull(!isFull()); }

  function requestClose() { applyFull(false); build(); setOpen(false); }
  function openFlag() { return !!(root && !root.classList.contains('rb-root--closed')); }

  /* ------------------------------------------------------------- 开始面板 */

  /* 侧栏展开后的启动页：聚合全部功能入口，点卡片直达对应面板 */
  var HOME_ENTRIES = [
    { tab: 'terminal', title: '终端', desc: '真实 Ubuntu 终端，直接执行命令', icon: 'terminal' },
    { tab: 'browser', title: '浏览器', desc: '内置网页浏览与页面调试', icon: 'browser' },
    { tab: 'ide', title: '文件修改', desc: '打开编辑器修改代码与文本', icon: 'code' },
    { tab: 'artifacts', title: '产出物', desc: '查看任务生成的交付文件', icon: 'box' },
    { tab: 'files', title: '工作目录文件', desc: '浏览当前工作目录的文件', icon: 'folder' },
    { tab: 'ide', title: 'IDE', desc: '项目源码编辑与运行', icon: 'sparkles' }
  ];

  function mountHome(host) {
    if (!host) return;
    host.innerHTML = '';
    var wrap = el('div', { class: 'rb-home' });
    wrap.appendChild(el('div', { class: 'rb-home__title', text: '开始' }));
    wrap.appendChild(el('div', { class: 'rb-home__sub', text: '选择一个功能开始工作' }));
    var grid = el('div', { class: 'rb-home__grid' });
    for (var i = 0; i < HOME_ENTRIES.length; i++) {
      (function (it) {
        grid.appendChild(el('button', {
          class: 'rb-home__card', type: 'button',
          onclick: function () { requestOpen(it.tab); }
        },
          el('span', { class: 'rb-home__ico' }, icon(it.icon, 18)),
          el('span', { class: 'rb-home__meta' }, el('b', { text: it.title }), el('small', { text: it.desc }))
        ));
      })(HOME_ENTRIES[i]);
    }
    wrap.appendChild(grid);
    host.appendChild(wrap);
  }

  /* ------------------------------------------------------------- 状态刷新 */
  function setStatus(tone, text) {
    statusState.tone = tone || 'off';
    statusState.text = text || '';
    if (!footDot || !footText) return;
    footDot.className = 'rb-dot' + (tone === 'ok' ? ' rb-dot--ok' : tone === 'warn' ? ' rb-dot--warn' : tone === 'busy' ? ' rb-dot--busy' : '');
    footText.textContent = statusState.text;
    if (footText.parentNode) footText.parentNode.setAttribute('title', statusState.text);
  }

  function updateFileCount() {
    var files = S('projectFiles', []) || [];
    var n = 0;
    for (var i = 0; i < files.length; i++) if (files[i] && files[i].kind !== 'dir') n++;
    if (footFiles) footFiles.textContent = n + ' 个文件';
  }

  /* ------------------------------------------------------------- 公共 UI */
  var layers = [];

  function topLayer() { return layers[layers.length - 1] || null; }
  function popLayer(l) { var i = layers.indexOf(l); if (i >= 0) layers.splice(i, 1); }

  function closeAllLayers() {
    var l = layers.slice();
    for (var i = l.length - 1; i >= 0; i--) { try { l[i].close(); } catch (_) {} }
  }

  function computeOrigin(anchorRect, box) {
    var x = anchorRect.left + anchorRect.width / 2 - box.left;
    var y = (anchorRect.bottom <= box.top) ? 0 : (anchorRect.top >= box.bottom ? box.height : anchorRect.top + anchorRect.height / 2 - box.top);
    x = Math.max(0, Math.min(box.width, x));
    y = Math.max(0, Math.min(box.height, y));
    return x + 'px ' + y + 'px';
  }

  /**
   * 从触发点生长的玻璃弹出层。
   * opts: {anchor, items:[{label,icon,hint,danger,onSelect}|{sep:true}], width, align, onClose}
   */
  function popover(opts) {
    opts = opts || {};
    var anchor = opts.anchor;
    var u = U();
    var box = el('div', { class: 'rb-pop rb-pop--in', role: 'menu' });
    if (opts.width) box.style.width = opts.width + 'px';
    var items = opts.items || [];
    var buttons = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.sep) { box.appendChild(el('div', { class: 'rb-pop__sep' })); continue; }
      if (it.hint) { box.appendChild(el('div', { class: 'rb-pop__hint', text: it.hint })); continue; }
      (function (it) {
        var b = el('button', {
          class: 'rb-pop__item' + (it.danger ? ' rb-pop__item--danger' : ''), type: 'button', role: 'menuitem',
          onclick: function (e) { e.stopPropagation(); close('pick'); if (typeof it.onSelect === 'function') it.onSelect(); }
        }, icon(it.icon || 'chevronRight', 15), el('span', { class: 'rb-pop__label', text: it.label }));
        buttons.push(b);
        box.appendChild(b);
      })(it);
    }
    document.body.appendChild(box);

    var vw = window.innerWidth, vh = window.innerHeight, pad = 8;
    var br = box.getBoundingClientRect();
    var ar = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: vw / 2, right: vw / 2, top: vh / 2, bottom: vh / 2, width: 0, height: 0 };
    var left, top;
    if (opts.align === 'right') left = ar.right - br.width;
    else if (opts.align === 'left') left = ar.left;
    else left = ar.left + ar.width / 2 - br.width / 2;
    left = Math.max(pad, Math.min(vw - br.width - pad, left));
    top = ar.bottom + 6;
    if (top + br.height + pad > vh) {
      var above = ar.top - 6 - br.height;
      top = above >= pad ? above : Math.max(pad, vh - br.height - pad);
    }
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
    box.style.position = 'fixed';
    box.style.setProperty('--rb-origin', computeOrigin(ar, box.getBoundingClientRect()));
    var u2 = U();
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () { box.classList.remove('rb-pop--in'); });

    var layer = { close: close, box: box };
    layers.push(layer);

    var closed = false;
    function close(reason) {
      if (closed) return;
      closed = true;
      popLayer(layer);
      document.removeEventListener('pointerdown', onDoc, true);
      window.removeEventListener('resize', onMove, true);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('keydown', onKey, true);
      box.classList.add('rb-pop--out');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 150);
      if (anchor && anchor.focus) { try { anchor.focus({ preventScroll: true }); } catch (_) { try { anchor.focus(); } catch (__) {} } }
      if (typeof opts.onClose === 'function') opts.onClose(reason);
    }
    function onDoc(e) { if (!box.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) close('outside'); }
    function onMove() { close('move'); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('esc'); return; }
      if (!buttons.length) return;
      var idx = buttons.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
        if (idx < 0) next = 0;
        try { buttons[next].focus({ preventScroll: true }); } catch (_) { buttons[next].focus(); }
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault(); buttons[idx].click();
      } else if (e.key === 'Tab') {
        close('tab');
      }
    }
    setTimeout(function () {
      document.addEventListener('pointerdown', onDoc, true);
      window.addEventListener('resize', onMove, true);
      window.addEventListener('scroll', onMove, true);
      document.addEventListener('keydown', onKey, true);
      if (buttons[0]) { try { buttons[0].focus({ preventScroll: true }); } catch (_) {} }
    }, 0);
    return { close: close, element: box };
  }

  /** 通用弹窗；返回 {close} */
  function modal(opts) {
    opts = opts || {};
    var card = el('div', { class: 'rb-modal__card', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '对话框' });
    var head = el('div', { class: 'rb-modal__head' },
      el('div', { class: 'rb-modal__title', text: opts.title || '' }),
      el('button', { class: 'rb-iconbtn', type: 'button', 'aria-label': '关闭', onclick: function () { close(); } }, icon('x', 15))
    );
    var body = el('div', { class: 'rb-modal__body ax-scroll' });
    if (opts.body) body.appendChild(opts.body);
    card.appendChild(head);
    card.appendChild(body);
    if (opts.actions && opts.actions.length) {
      var foot = el('div', { class: 'rb-modal__foot' });
      for (var i = 0; i < opts.actions.length; i++) {
        (function (act) {
          foot.appendChild(el('button', {
            class: 'rb-btn' + (act.kind === 'primary' ? ' rb-btn--pri' : act.kind === 'danger' ? ' rb-btn--danger' : ''),
            type: 'button',
            onclick: function () { if (act.onClick) act.onClick(close); else close(); }
          }, act.label));
        })(opts.actions[i]);
      }
      card.appendChild(foot);
    }
    var wrap = el('div', { class: 'rb-modal rb-modal--in' }, card);
    document.body.appendChild(wrap);
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () { wrap.classList.remove('rb-modal--in'); });

    var closed = false;
    var layer = { close: function () { close(); }, box: wrap };
    layers.push(layer);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') { trapTab(e); }
    }
    function trapTab(e) {
      var f = wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function close() {
      if (closed) return;
      closed = true;
      popLayer(layer);
      document.removeEventListener('keydown', onKey, true);
      wrap.classList.add('rb-modal--out');
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 170);
      if (opts.onClose) opts.onClose();
    }
    wrap.addEventListener('pointerdown', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey, true);
    setTimeout(function () {
      var f = card.querySelector('input, textarea, button.rb-btn--pri, button.rb-btn, button.rb-iconbtn');
      if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} }
    }, 30);
    return { close: close, element: wrap };
  }

  function confirmBox(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var m = modal({
        title: opts.title || '确认操作',
        body: el('div', { style: 'padding:16px;font-size:13px;line-height:1.8;color:var(--ax-text-2,#a7b0c0);word-break:break-word' }, opts.text || ''),
        actions: [
          { label: opts.cancelText || '取消', onClick: function (c) { c(); } },
          { label: opts.okText || '确认', kind: opts.danger ? 'danger' : 'primary', onClick: function (c) { done = true; c(); resolve(true); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
      void m;
    });
  }

  /* --------------------------------------------------------------- 事件 */
  function bind() {
    if (!A.bus) return;
    A.bus.on('panel:open', function (p) {
      var tab = p && (p.tab || p.panel) ? (p.tab || p.panel) : (typeof p === 'string' ? p : null);
      requestOpen(tab);
    });
    A.bus.on('panel:close', function () { requestClose(); });
    A.bus.on('panel:tab', function (p) {
      var tab = p && (p.tab || p.panel) ? (p.tab || p.panel) : (typeof p === 'string' ? p : null);
      if (tab && FALLBACK[tab]) switchTab(tab, true);
    });
    A.bus.on('registry:add', function (p) { if (p && p.kind === 'right-panel') { renderTabs(); healPlaceholders(); } });
    A.bus.on('registry:remove', function (p) { if (p && p.kind === 'right-panel') renderTabs(); });

    if (A.store) {
      A.store.subscribe('ui.rightOpen', function (v) {
        build();
        /* 子目录入口：用户首次操作前保持右栏展开，避免 store 旧值收起入口面板 */
        if (routeLock && !userTouched && !v) { A.store.set('ui.rightOpen', true); return; }
        if (!!v === openFlag()) return;
        applyOpen(!!v, false);
      });
      A.store.subscribe('ui.rightTab', function (v) {
        if (!v || v === activeId || !FALLBACK[v]) return;
        /* 子目录入口：用户首次操作前，忽略 store 异步载入（旧值/默认值）对入口面板的覆盖 */
        if (routeLock && !userTouched && v !== routeLock) { A.store.set('ui.rightTab', routeLock); return; }
        switchTab(v, false);
      });
      A.store.subscribe('projectFiles', function () { updateFileCount(); });
    }

    window.addEventListener('resize', function () { measure(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !layers.length) return;
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      var l = topLayer();
      if (l) l.close();
    }, true);
  }

  A.ready(function () {
    build();
    bind();
    var route = routeTab();
    routeLock = route;
    var open = route ? true : !!S('ui.rightOpen', false);
    var tab = route || S('ui.rightTab', 'terminal') || 'terminal';
    activeId = null;
    switchTab(FALLBACK[tab] ? tab : 'terminal', false);
    applyOpen(open, true);
    if (route) syncPath(route);
    /* 大子页入口：settings:<tab> 打开设置层对应页签；view:<name> 打开主视图 */
    if (rawRoute && rawRoute.indexOf('settings:') === 0) {
      var st = rawRoute.slice('settings:'.length) || 'user';
      applyRouteTitle(st === 'user' ? 'account' : st);
      setTimeout(function () { A.bus.emit('settings:open', { tab: st }); }, 40);
    } else if (rawRoute && rawRoute.indexOf('view:') === 0) {
      var v = rawRoute.slice('view:'.length) || 'home';
      applyRouteTitle(v);
      setTimeout(function () {
        var cid = null;
        try {
          var m = /[?&]c=([^&#]+)/.exec(location.search || '');
          if (m) cid = decodeURIComponent(m[1]);
          else {
            var hh = /#\/chat\/([^\/?#]+)/.exec(location.hash || '');
            if (hh) cid = decodeURIComponent(hh[1]);
            else {
              /* /chat/{编号}/ 形式：编号即会话 id */
              var pp = /\/chat\/([^\/?#]+)\/?$/.exec(location.pathname || '');
              if (pp && pp[1] && pp[1] !== 'index.html') cid = decodeURIComponent(pp[1]);
            }
          }
        } catch (e) {}
        if (v === 'chat' && A.chat && A.chat.goChat) A.chat.goChat(cid);
      }, 40);
    }
    /* 会话切换时把地址栏同步为 /chat/{编号}/，支持复制直达 */
    if (A.store && A.store.subscribe) {
      A.store.subscribe('activeConversationId', function () { syncChatPath(); });
      A.store.subscribe('ui.view', function () { syncChatPath(); });
    }
  });

  A.ui = A.ui || {};
  A.ui.popover = popover;
  A.ui.modal = modal;
  A.ui.confirm = confirmBox;
  A.ui.closeAll = closeAllLayers;

  A.rightPanel = {
    open: requestOpen,
    close: requestClose,
    toggle: function () { if (openFlag()) requestClose(); else requestOpen(); },
    tab: function (id) { if (FALLBACK[id]) switchTab(id, true); },
    setStatus: setStatus,
    refresh: updateFileCount,
    isOpen: openFlag,
    icons: panelDefs
  };
})();
