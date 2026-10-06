/* AYCHO module: rb-artifacts | owner: B | contract: v1 */
/* 产出物面板：列表 / 过滤 / 内建降级预览 / 下载 / 分享 / 删除
   依赖 store.artifacts + activeArtifactId；预览优先复用 registry('preview')，缺失走内建。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var els = null;                 // 面板 DOM 句柄
  var mounted = false;
  var filter = 'all';
  var offs = [];                  // 订阅取消函数
  var timers = [];                // 需在 unmount 清理的定时器
  var busy = false;

  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'image', label: '图片' },
    { id: 'code', label: '代码' },
    { id: 'data', label: '数据' },
    { id: 'other', label: '其他' }
  ];

  var EXT_KIND = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', ico: 'image',
    svg: 'svg', html: 'html', htm: 'html', md: 'text', txt: 'text', log: 'text', rst: 'text',
    json: 'data', csv: 'data', tsv: 'data', xml: 'data', yaml: 'data', yml: 'data', toml: 'data', ini: 'data',
    js: 'code', mjs: 'code', cjs: 'code', ts: 'code', jsx: 'code', tsx: 'code', css: 'code', scss: 'code', less: 'code',
    py: 'code', sh: 'code', bash: 'code', zsh: 'code', go: 'code', rs: 'code', java: 'code', kt: 'code', rb: 'code',
    php: 'code', sql: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code', swift: 'code', vue: 'code', svelte: 'code'
  };

  /* --------------------------------------------------------------- 基础 */
  function U() { return A.util || {}; }
  function S(path, dft) { return A.store ? A.store.get(path, dft) : dft; }
  function setState(path, v) { if (A.store) A.store.set(path, v); }
  function emit(evt, payload) { if (A.bus) A.bus.emit(evt, payload); }
  function el() { var u = U(); return u.el ? u.el.apply(null, arguments) : null; }
  function icon(name, size, cls) {
    if (A.icons && A.icons.svg) return A.icons.svg(name, size || 16, cls);
    if (A.icons && A.icons.node) return A.icons.node(name, size || 16);
    return null;
  }
  function toast(text, type) { if (A.toast) A.toast(text, type); }
  function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers.length = 0; }

  function list() {
    var v = S('artifacts', []);
    return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : [];
  }
  function activeId() { return S('activeArtifactId', null); }

  function extOf(name) {
    var s = String(name || '');
    var i = s.lastIndexOf('.');
    if (i <= 0) return '';
    return s.slice(i + 1).toLowerCase();
  }
  function kindOf(art) {
    art = art || {};
    var k = String(art.kind || '');
    if (k && k !== 'file' && k !== 'binary') return k;
    var ext = extOf(art.name || art.path);
    if (EXT_KIND[ext]) return EXT_KIND[ext];
    var mime = String(art.mime || '').toLowerCase();
    if (mime.indexOf('image/svg') === 0) return 'svg';
    if (mime.indexOf('image/') === 0) return 'image';
    if (mime.indexOf('text/html') === 0) return 'html';
    if (mime.indexOf('json') >= 0 || mime.indexOf('csv') >= 0 || mime.indexOf('yaml') >= 0) return 'data';
    if (mime.indexOf('text/') === 0) return 'text';
    if (mime.indexOf('javascript') >= 0 || mime.indexOf('css') >= 0) return 'code';
    return k || 'binary';
  }
  function bucketOf(art) {
    var k = kindOf(art);
    if (k === 'image' || k === 'svg') return 'image';
    if (k === 'code') return 'code';
    if (k === 'data') return 'data';
    if (k === 'html' || k === 'text') return 'other';
    return 'other';
  }
  function labelOf(art) {
    var k = kindOf(art);
    var m = { image: '图片', svg: '矢量图', html: '网页', text: '文本', code: '代码', data: '数据', binary: '二进制', file: '文件' };
    return m[k] || '文件';
  }
  function nameOf(art) { return String((art && (art.name || art.path)) || '未命名'); }
  function mimeOf(art) { return art.mime || (U().mimeOf ? U().mimeOf(nameOf(art)) : 'text/plain'); }

  function textOf(art) {
    if (!art) return '';
    if (typeof art.content === 'string') return art.content;
    var url = String(art.url || '');
    if (url.indexOf('data:') === 0) {
      var i = url.indexOf(',');
      if (i < 0) return '';
      var meta = url.slice(5, i), body = url.slice(i + 1);
      try { return meta.indexOf('base64') >= 0 ? atob(body) : decodeURIComponent(body); } catch (_) { return ''; }
    }
    return '';
  }
  function srcOf(art) {
    if (art && typeof art.url === 'string' && art.url) return art.url;
    var txt = textOf(art);
    if (!txt) return '';
    var mime = mimeOf(art);
    if (kindOf(art) === 'svg' && mime.indexOf('svg') < 0) mime = 'image/svg+xml';
    try { return 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(txt); } catch (_) { return ''; }
  }
  function isTextual(art) {
    var k = kindOf(art);
    return k === 'code' || k === 'data' || k === 'text' || k === 'html' || k === 'svg';
  }
  function sizeOf(art) {
    if (art && typeof art.size === 'number') return art.size;
    if (art && typeof art.bytes === 'number') return art.bytes;
    if (U().byteLength) return U().byteLength(textOf(art));
    return textOf(art).length;
  }

  /* --------------------------------------------------------------- 分享 */
  function sharerOf() {
    if (!A.registry || !A.registry.list) return null;
    var l = A.registry.list('sharer') || [];
    for (var i = 0; i < l.length; i++) if (l[i] && typeof l[i].share === 'function') return l[i];
    return null;
  }
  function fallbackShareUrl(art) {
    var slug = U().slug ? U().slug(nameOf(art)) : String(art.id || 'item');
    var share = S('share', {}) || {};
    var base = '';
    try { base = String(location.origin || ''); } catch (_) {}
    return base + '/#/s/' + slug;
  }
  function applyShared(art, url) {
    var next = list().map(function (x) {
      if (x.id !== art.id) return x;
      var c = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) c[k] = x[k];
      c.shareUrl = url; c.sharedAt = Date.now();
      return c;
    });
    setState('artifacts', next);
    var share = S('share', {}) || {};
    var items = Array.isArray(share.items) ? share.items.slice() : [];
    if (items.indexOf(art.id) < 0) items.push(art.id);
    var patch = { items: items }; for (var k2 in share) if (Object.prototype.hasOwnProperty.call(share, k2)) patch[k2] = share[k2];
    patch.items = items;
    setState('share', patch);
    if (U().copy) { try { U().copy(url); } catch (_) {} }
    toast('分享链接已复制：' + url, 'ok');
    return url;
  }
  function doShare(art) {
    var sh = sharerOf();
    if (sh) {
      var r = null;
      try { r = sh.share(art); } catch (e) { console.error('[aycho:artifacts] sharer', e); }
      if (r && typeof r.then === 'function') {
        toast('正在生成分享链接…');
        r.then(function (url) { applyShared(art, url || fallbackShareUrl(art)); })
          .catch(function (e) { toast('分享失败：' + ((e && e.message) || e), 'warn'); });
        return '';
      }
      if (r) { applyShared(art, r); return r; }
    }
    var url = fallbackShareUrl(art);
    applyShared(art, url);
    return url;
  }
  function doUnshare(art) {
    var sh = sharerOf();
    if (sh && typeof sh.unshare === 'function') {
      try { var p = sh.unshare(art); if (p && p.then) p.catch(function () {}); } catch (_) {}
    }
    var next = list().map(function (x) {
      if (x.id !== art.id) return x;
      var c = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k)) c[k] = x[k];
      c.shareUrl = ''; c.sharedAt = null;
      return c;
    });
    setState('artifacts', next);
    var share = S('share', {}) || {};
    var items = (Array.isArray(share.items) ? share.items : []).filter(function (id) { return id !== art.id; });
    var patch = {}; for (var k2 in share) if (Object.prototype.hasOwnProperty.call(share, k2)) patch[k2] = share[k2];
    patch.items = items;
    setState('share', patch);
    toast('已取消分享', 'ok');
  }

  /* --------------------------------------------------------------- 下载 */
  function downloadArt(art) {
    var u = U();
    var name = nameOf(art);
    var txt = textOf(art);
    try {
      if (u.download) {
        if (txt) u.download(name, txt, mimeOf(art));
        else if (art.url) {
          var a = document.createElement('a');
          a.href = art.url; a.download = name;
          a.setAttribute('rel', 'noopener');
          document.body.appendChild(a); a.click();
          setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
        } else { toast('该产出物没有可下载内容', 'warn'); return false; }
        toast('已开始下载 ' + name, 'ok');
        return true;
      }
    } catch (e) { console.error('[aycho:artifacts] download', e); }
    toast('下载失败', 'err');
    return false;
  }

  /* --------------------------------------------------------------- 预览 */
  function previewerOf() {
    if (!A.registry || !A.registry.list) return null;
    var l = A.registry.list('preview') || [];
    for (var i = 0; i < l.length; i++) if (l[i] && typeof l[i].open === 'function') return l[i];
    return null;
  }

  function buildCodePreview(text, lang) {
    var hl = (A.ui && typeof A.ui.highlightLines === 'function') ? A.ui.highlightLines(text, lang) : null;
    var lines = String(text == null ? '' : text).split('\n');
    if (lines.length && lines[lines.length - 1] === '' && lines.length > 1) lines.pop();
    var box = el('div', { class: 'rb-code' });
    for (var i = 0; i < lines.length; i++) {
      var html = hl && hl[i] != null ? hl[i] : (U().escapeHtml ? U().escapeHtml(lines[i]) : lines[i]);
      box.appendChild(el('div', { class: 'rb-code__row' },
        el('span', { class: 'rb-code__no', text: String(i + 1) }),
        el('span', { class: 'rb-code__txt', html: html || '\u200b' })
      ));
    }
    if (!lines.length) box.appendChild(el('div', { class: 'rb-code__row' }, el('span', { class: 'rb-code__txt', text: '（空文件）' })));
    return box;
  }

  function buildPreviewBody(art) {
    var k = kindOf(art);
    var wrap = el('div', { class: 'rb-previewwrap' });
    var box = el('div', { class: 'rb-previewbox' });

    if (k === 'image' || k === 'svg') {
      var src = srcOf(art);
      if (src) box.appendChild(el('img', { class: 'rb-imgview', src: src, alt: nameOf(art) }));
      else box.appendChild(el('div', { class: 'ax-empty' }, el('div', { text: '图片内容不可用' })));
    } else if (k === 'html') {
      var html = textOf(art);
      var frame = el('iframe', { class: 'rb-render', sandbox: 'allow-scripts allow-popups allow-forms', style: 'height:60vh' });
      frame.setAttribute('title', nameOf(art));
      frame.setAttribute('srcdoc', html || '<p style="font-family:sans-serif;color:#666">（空文档）</p>');
      box.appendChild(frame);
    } else if (isTextual(art)) {
      box.appendChild(buildCodePreview(textOf(art), langOf(art)));
    } else {
      var info = el('div', { class: 'ax-empty' },
        el('div', { text: '该类型不支持内联预览' }),
        el('div', { style: 'margin-top:6px;font-size:11.5px;opacity:.75', text: labelOf(art) + ' · ' + (U().fmtBytes ? U().fmtBytes(sizeOf(art)) : '') })
      );
      box.appendChild(info);
    }
    wrap.appendChild(box);
    return wrap;
  }

  function langOf(art) {
    var ext = extOf(nameOf(art));
    if (!ext) return 'text';
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js';
    if (ext === 'svg' || ext === 'html' || ext === 'htm' || ext === 'xml') return 'html';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
    if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'sh';
    if (ext === 'py') return 'py';
    if (ext === 'json') return 'json';
    return 'js';
  }

  var previewApi = null;
  function previewArtifact(art) {
    if (!art) return;
    if (previewApi && previewApi.box && previewApi.box.parentNode) { try { previewApi.close(); } catch (_) {} }
    previewApi = null;
    var p = previewerOf();
    if (p) {
      var ok = true;
      if (typeof p.can === 'function') { try { ok = !!p.can(kindOf(art), art.mime); } catch (_) { ok = false; } }
      if (ok) {
        try { p.open(art); return; } catch (e) { console.error('[aycho:artifacts] preview', e); }
      }
    }
    if (!A.ui || typeof A.ui.modal !== 'function') { toast('预览不可用', 'warn'); return; }
    var actions = [
      { label: '复制内容', onClick: function () { copyArt(art); } },
      { label: '下载', kind: 'primary', onClick: function () { downloadArt(art); } }
    ];
    previewApi = A.ui.modal({ title: nameOf(art) + ' · ' + labelOf(art), body: buildPreviewBody(art), actions: actions });
  }
  function copyArt(art) {
    var txt = textOf(art);
    if (!txt) { toast('无可复制内容', 'warn'); return; }
    if (U().copy) { U().copy(txt); toast('已复制到剪贴板', 'ok'); }
  }

  /* --------------------------------------------------------------- 选择 */
  function select(id) {
    if (S('activeArtifactId', null) !== id) setState('activeArtifactId', id);
    emit('artifact:select', { id: id });
    syncActiveRow();
  }

  /* --------------------------------------------------------------- 渲染 */
  function visible() {
    return list().filter(function (a) { return filter === 'all' || bucketOf(a) === filter; });
  }

  function rowFor(art) {
    var u = U();
    var id = art.id;
    var row = el('div', {
      class: 'rb-row', role: 'button', tabindex: '0', 'data-id': id,
      onclick: function () { select(id); previewArtifact(art); },
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); previewArtifact(art); }
      }
    });
    var ico = el('span', { class: 'rb-row__ico' });
    var k = kindOf(art);
    if (k === 'image' || k === 'svg') {
      var src = srcOf(art);
      if (src) ico.appendChild(el('img', { src: src, alt: '', style: 'width:30px;height:30px;object-fit:cover;border-radius:8px;border:1px solid var(--ax-border-soft)' }));
      else ico.appendChild(icon('image', 18));
    } else {
      var ic = icon(icNameFor(art), 18);
      if (ic && A.icons && A.icons.color) { try { ic.style.color = iconColorFor(art); } catch (_) {} }
      ico.appendChild(ic);
    }
    var meta = [labelOf(art)];
    var sz = u.fmtBytes ? u.fmtBytes(sizeOf(art)) : '';
    if (sz) meta.push(sz);
    var tm = u.fmtTime ? u.fmtTime(art.createdAt) : '';
    if (tm) meta.push(tm);
    if (art.shareUrl) meta.push('已分享');

    var more = el('button', {
      class: 'rb-iconbtn', type: 'button', 'aria-label': '更多操作', title: '更多操作',
      onclick: function (e) { e.stopPropagation(); openRowMenu(art, e.currentTarget); }
    }, icon('chevronDown', 15));

    row.appendChild(ico);
    row.appendChild(el('div', { class: 'rb-row__main' },
      el('div', { class: 'rb-row__name', text: nameOf(art) }),
      el('div', { class: 'rb-row__meta', text: meta.join(' · ') })
    ));
    row.appendChild(el('div', { class: 'rb-row__acts' }, more));
    if (id === activeId()) row.classList.add('rb-row--on');
    return row;
  }

  function icNameFor(art) {
    var k = kindOf(art);
    if (k === 'image' || k === 'svg') return 'image';
    if (k === 'html') return 'browser';
    if (k === 'code') return 'code';
    if (k === 'data') return 'box';
    if (k === 'text') return 'files';
    return 'file';
  }
  function iconColorFor(art) {
    if (!A.icons) return '';
    var n = nameOf(art);
    return A.icons.color ? A.icons.color(n) : '';
  }

  function openRowMenu(art, anchor) {
    if (!A.ui || typeof A.ui.popover !== 'function') return;
    var items = [
      { label: '预览', icon: 'eye', onSelect: function () { previewArtifact(art); } },
      { label: '下载', icon: 'download', onSelect: function () { downloadArt(art); emit('artifact:download', { id: art.id }); } },
      { label: '复制内容', icon: 'clipboard', onSelect: function () { copyArt(art); } },
      { sep: true }
    ];
    if (art.shareUrl) {
      items.push({ label: '复制分享链接', icon: 'link', onSelect: function () { if (U().copy) U().copy(art.shareUrl); toast('已复制分享链接', 'ok'); } });
      items.push({ label: '取消分享', icon: 'x', onSelect: function () { doUnshare(art); } });
    } else {
      items.push({ label: '分享', icon: 'share', onSelect: function () { doShare(art); emit('artifact:share', { id: art.id }); } });
    }
    items.push({ sep: true });
    items.push({ label: '移除', icon: 'trash', danger: true, onSelect: function () { removeArtifact(art.id); } });
    A.ui.popover({ anchor: anchor, items: items, align: 'right', width: 176 });
  }

  function removeArtifact(id) {
    var next = list().filter(function (x) { return x.id !== id; });
    if (next.length === list().length) return;
    setState('artifacts', next);
    if (activeId() === id) setState('activeArtifactId', next.length ? next[0].id : null);
    emit('artifact:remove', { id: id });
    toast('已移除产出物', 'ok');
  }

  function syncActiveRow() {
    if (!els || !els.list) return;
    var rows = els.list.querySelectorAll('.rb-row');
    var id = activeId();
    for (var i = 0; i < rows.length; i++) {
      var on = rows[i].getAttribute('data-id') === id;
      rows[i].classList.toggle('rb-row--on', !!on);
    }
  }

  function render() {
    if (!els || !els.list) return;
    var items = visible();
    var all = list();
    els.list.textContent = '';
    for (var i = 0; i < items.length; i++) {
      var row = rowFor(items[i]);
      if (row) els.list.appendChild(el('li', { class: 'rb-art__item', style: 'display:block' }, row));
    }
    if (els.empty) els.empty.style.display = items.length ? 'none' : '';
    if (els.count) els.count.textContent = all.length + ' 个';
    if (els.badge) els.badge.textContent = items.length === all.length ? String(all.length) : (items.length + '/' + all.length);
    if (els.clearBtn) els.clearBtn.disabled = !all.length;
    if (els.dlAllBtn) els.dlAllBtn.disabled = !items.length;
    if (els.emptyHint) {
      els.emptyHint.textContent = all.length ? '当前筛选下没有产出物' : '会话中生成的图片、代码、文档会自动出现在这里';
    }
    syncActiveRow();
    report();
  }

  function report() {
    if (!A.rightPanel || typeof A.rightPanel.setStatus !== 'function') return;
    var n = list().length;
    if (!n) { A.rightPanel.setStatus('off', '产出物：暂无'); return; }
    A.rightPanel.setStatus('ok', '产出物：' + n + ' 个');
  }

  function downloadAll() {
    var items = visible();
    if (!items.length || busy) return;
    busy = true;
    for (var i = 0; i < items.length; i++) {
      (function (art, idx) { later(function () { downloadArt(art); if (idx === items.length - 1) busy = false; }, 220 * idx); })(items[i], i);
    }
    toast('开始下载 ' + items.length + ' 个产出物', 'ok');
  }

  function clearAll() {
    var n = list().length;
    if (!n) return;
    if (!A.ui || typeof A.ui.confirm !== 'function') { setState('artifacts', []); setState('activeArtifactId', null); return; }
    A.ui.confirm({
      title: '清空产出物',
      text: '将移除列表中的 ' + n + ' 个产出物记录（聊天记录不受影响，已分享的链接会失效）。',
      okText: '清空',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      setState('artifacts', []);
      setState('activeArtifactId', null);
      emit('artifact:remove', { id: null });
      toast('已清空产出物', 'ok');
    });
  }

  /* --------------------------------------------------------------- 构建 */
  function build(host) {
    var segs = [];
    for (var i = 0; i < FILTERS.length; i++) {
      (function (f) {
        segs.push(el('button', {
          class: 'rb-seg__item' + (f.id === filter ? ' rb-seg__item--on' : ''), type: 'button', 'data-f': f.id,
          onclick: function () { filter = f.id; if (els.seg) { var all = els.seg.querySelectorAll('.rb-seg__item'); for (var j = 0; j < all.length; j++) all[j].classList.toggle('rb-seg__item--on', all[j].getAttribute('data-f') === f.id); } render(); }
        }, f.label));
      })(FILTERS[i]);
    }

    var badge = el('span', { class: 'rb-badge', text: '0' });
    var dlAll = el('button', { class: 'rb-iconbtn', type: 'button', title: '下载当前列表', 'aria-label': '下载当前列表', onclick: function () { downloadAll(); } }, icon('download', 16));
    var clearBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '清空产出物', 'aria-label': '清空产出物', onclick: function () { clearAll(); } }, icon('trash', 16));

    var listEl = el('ul', { class: 'rb-list' });
    var emptyHint = el('div', { style: 'font-size:12px;margin-top:4px;opacity:.8', text: '' });
    var empty = el('div', { class: 'ax-empty', style: 'padding:28px 18px;text-align:center' },
      el('div', { style: 'font-size:12.5px;color:var(--ax-text-2,#a7b0c0)', text: '暂无产出物' }),
      emptyHint
    );
    var scroll = el('div', { class: 'rb-scrollpane ax-scroll' }, listEl, empty);

    var seg = el('div', { class: 'rb-seg' }, segs);
    var root = el('div', { class: 'rb-art' },
      el('div', { class: 'rb-toolbar' },
        el('span', { class: 'rb-toolbar__title', text: '产出物' }),
        badge,
        el('span', { class: 'rb-toolbar__spacer' }),
        seg,
        dlAll,
        clearBtn
      ),
      scroll
    );
    els = { root: root, list: listEl, empty: empty, emptyHint: emptyHint, badge: badge, seg: seg, clearBtn: clearBtn, dlAllBtn: dlAll };
    host.appendChild(root);
  }

  /* --------------------------------------------------------------- 事件 */
  function bind() {
    if (!A.bus) return;
    var pair = function (evt, fn) { A.bus.on(evt, fn); offs.push(function () { A.bus.off(evt, fn); }); };
    pair('artifact:add', function (p) {
      var art = p && p.artifact ? p.artifact : (p && p.id ? p : null);
      if (!art || !art.id) return;
      var next = list().slice();
      var idx = -1;
      for (var i = 0; i < next.length; i++) if (next[i].id === art.id) { idx = i; break; }
      if (idx >= 0) next[idx] = art; else next.unshift(art);
      if (artifactEqual(next, list())) return;
      setState('artifacts', next);
      toast('新增产出物：' + nameOf(art), 'ok');
    });
    pair('artifact:select', function (p) {
      if (!p || !p.id) return;
      if (activeId() !== p.id) setState('activeArtifactId', p.id);
      if (mounted) syncActiveRow();
    });
    pair('artifact:remove', function (p) {
      if (!p || !p.id) return;
      var next = list().filter(function (x) { return x.id !== p.id; });
      if (next.length !== list().length) setState('artifacts', next);
    });
    pair('artifact:download', function (p) {
      if (!p || !p.id) return;
      var art = findById(p.id);
      if (art) downloadArt(art);
    });
    pair('artifact:share', function (p) {
      if (!p || !p.id) return;
      var art = findById(p.id);
      if (art && !art.shareUrl) doShare(art);
    });
    pair('artifact:unshare', function (p) {
      if (!p || !p.id) return;
      var art = findById(p.id);
      if (art && art.shareUrl) doUnshare(art);
    });

    if (A.store) {
      offs.push(A.store.subscribe('artifacts', function () { trackVersions(); if (mounted) render(); }));
      offs.push(A.store.subscribe('activeArtifactId', function () { if (mounted) syncActiveRow(); }));
      trackVersions();
    }
  }

  function artifactEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function findById(id) {
    var l = list();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  /* 版本基线：同名产出物内容一旦变化，把上一版内容记到 prevContent，供预览页做红绿 diff */
  var versionSnap = null;
  function trackVersions() {
    var l = list();
    var map = Object.create(null);
    var changed = false;
    for (var i = 0; i < l.length; i++) {
      var a = l[i], k = String(nameOf(a)), now = textOf(a);
      map[k] = now;
      if (versionSnap && versionSnap[k] != null && versionSnap[k] !== now && a.prevContent == null) {
        a.prevContent = versionSnap[k];
        changed = true;
      }
    }
    if (changed) setState('artifacts', l);
    versionSnap = map;
  }
  A.artifactsTrack = trackVersions;

  /* --------------------------------------------------------------- 生命周期 */
  function mount(host) {
    if (!host) return;
    mounted = true;
    if (!els) build(host);
    else host.appendChild(els.root);
    render();
  }
  function unmount() {
    mounted = false;
    clearTimers();
    busy = false;
    if (previewApi) { try { previewApi.close(); } catch (_) {} previewApi = null; }
    if (A.ui && A.ui.closeAll) { try { A.ui.closeAll(); } catch (_) {} }
    if (els && els.root && els.root.parentNode) els.root.parentNode.removeChild(els.root);
    if (els) els.list.textContent = '';
  }

  function offAll() {
    for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (_) {} }
    offs.length = 0;
  }

  A.ready(function () {
    A.register('right-panel', 'artifacts', {
      title: '产出物', icon: 'box', order: 20,
      mount: mount, unmount: unmount
    });
    bind();
  });

  A.artifacts = {
    render: render,
    preview: previewArtifact,
    select: select,
    filter: function (f) { filter = f || 'all'; if (mounted) render(); },
    download: downloadArt,
    count: function () { return list().length; },
    _offAll: offAll
  };
})();
