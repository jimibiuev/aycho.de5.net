/* AYCHO brand layer: 开屏动画 / 素材自检 / 壳层接线 | owner: C | contract: v1 */
/* 素材：assets/splash_wordmark.png、assets/splash_icon.png、assets/ic_launcher_foreground.png（来自官方仓库 aycho，本地引用） */
(function () {
  'use strict';

  var A = window.AYCHO = window.AYCHO || {};
  var brand = A.brand = A.brand || { name: 'aycho', version: 'web-1', assets: {}, assetsAllOk: false, ready: false };

  var ASSETS = [
    { key: 'launcherIcon', src: './assets/ic_launcher_foreground.png', use: 'favicon / 顶栏图标(brand.css) / 主视觉徽标(brand.css) / 设置中心头部(settings.css) / 浮层头部(overlay.css)' },
    { key: 'splashWordmark', src: './assets/splash_wordmark.png', use: '开屏大标题(brand.js) / 顶栏字标(brand.css)' },
    { key: 'splashIcon', src: './assets/splash_icon.png', use: '开屏中心图形(brand.js) / 分享浮层头部(overlay.css)' }
  ];

  /* ---------- 素材预加载与自检 ---------- */
  function preload() {
    return Promise.all(ASSETS.map(function (item) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          brand.assets[item.key] = { src: item.src, ok: true, w: img.naturalWidth, h: img.naturalHeight, use: item.use };
          resolve(true);
        };
        img.onerror = function () {
          brand.assets[item.key] = { src: item.src, ok: false, use: item.use };
          resolve(false);
        };
        img.src = item.src;
      });
    })).then(function (list) {
      brand.assetsAllOk = list.every(Boolean);
      document.documentElement.setAttribute('data-asset-state', brand.assetsAllOk ? 'ok' : 'missing');
      return brand.assetsAllOk;
    });
  }

  /* ---------- 开屏控制 ---------- */
  var splash = document.getElementById('ax-splash');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var closed = false;
  window.__splashDone = false;

  function endSplash() {
    window.__splashDone = true;
    if (closed) return;
    closed = true;
    if (splash) {
      splash.classList.add('ax-out');
      window.setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 300);
    }
    document.body.classList.remove('ax-booting');
    A.bus.emit('splash:done', {});
  }

  if (splash) {
    splash.addEventListener('click', endSplash);
    window.addEventListener('keydown', function () { if (!closed) endSplash(); }, { once: true });
  }
  brand.closeSplash = endSplash;

  /* ---------- 会话渲染 ---------- */
  function renderMessages() {
    var host = document.getElementById('ax-msg-host');
    if (!host) return 0;
    var msgs = (A.store && A.store.get('messages') || {})[A.store && A.store.get('activeConversationId')] || [];
    host.innerHTML = '';
    for (var i = 0; i < msgs.length; i++) {
      var d = document.createElement('div');
      d.className = 'ax-bubble ' + (msgs[i].role === 'user' ? 'ax-u' : 'ax-a');
      d.textContent = msgs[i].content;
      host.appendChild(d);
    }
    brand.renderedMessages = msgs.length;
    return msgs.length;
  }

  /* ---------- 壳层接线 ---------- */
  function wire() {
    renderMessages();
    var sBtn = document.getElementById('ax-open-settings');
    if (sBtn) sBtn.addEventListener('click', function () {
      if (A.settings && typeof A.settings.open === 'function') A.settings.open('user');
      else if (typeof A.toast === 'function') A.toast('设置中心未挂载', 'info');
    });
    var pBtn = document.getElementById('ax-open-preview');
    if (pBtn) pBtn.addEventListener('click', function () {
      var arts = (A.store && A.store.get('artifacts')) || [];
      if (!arts.length) { if (typeof A.toast === 'function') A.toast('暂无可预览的工件', 'info'); return; }
      if (A.preview && typeof A.preview.open === 'function') A.preview.open(arts[0]);
      else if (typeof A.toast === 'function') A.toast('预览面板未挂载', 'info');
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var wait = Promise.resolve();
    if (typeof A.ready === 'function') {
      wait = new Promise(function (resolve) { A.ready(resolve); });
    } else if (document.readyState === 'loading') {
      wait = new Promise(function (resolve) { document.addEventListener('DOMContentLoaded', resolve); });
    }
    return wait
      .then(preload)
      .then(function () { wire(); brand.ready = true; return true; })
      .catch(function (err) { brand.error = String(err && err.message || err); return false; })
      .then(function (ok) {
        /* 开屏最短展示时长（素材就绪后仍保留入场动画节奏），可点击跳过 */
        var minHold = reduce ? 380 : 1150;
        var t0 = Date.now();
        function go() { window.setTimeout(endSplash, Math.max(0, minHold - (Date.now() - t0))); }
        if (document.readyState === 'complete') go();
        else window.addEventListener('load', go);
        /* 兜底：任何情况下不超过 2.6s 必须收起开屏 */
        window.setTimeout(endSplash, 2600);
        return ok;
      });
  }

  brand.status = function () {
    return { ready: brand.ready, assetsAllOk: brand.assetsAllOk, assets: brand.assets, renderedMessages: brand.renderedMessages, splashDone: window.__splashDone };
  };

  brand.boot = boot();
})();
