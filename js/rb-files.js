/* AYCHO module: rb-files | owner: B | contract: v1 */
/* 项目文件面板：目录树 / 新建 / 重命名 / 删除 / 搜索 / 底部预览 / 打开到 IDE。
   数据源 store.projectFiles[{id,path,kind,content,updatedAt}]，根为 /workspace（隐含，不落库）。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var ROOT = '/workspace';
  var els = null;
  var mounted = false;
  var offs = [];
  var timers = [];
  var query = '';
  var selected = '';
  var openDirs = Object.create(null);   // path → true 展开
  var expandedInit = false;

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
  function toast(t, ty) { if (A.toast) A.toast(t, ty); }
  function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }
  function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers.length = 0; }

  function files() {
    var v = S('projectFiles', []);
    if (!Array.isArray(v)) return [];
    return v.filter(function (f) { return f && typeof f === 'object' && typeof f.path === 'string' && f.path; });
  }
  function uid() { return U().uid ? U().uid('f') : ('f' + Math.random().toString(36).slice(2, 9)); }

  function norm(p) {
    var s = String(p || '').replace(/\\/g, '/');
    var parts = s.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return '/' + out.join('/');
  }
  function abs(p) {
    var n = norm(p);
    if (n === '/' || n === ROOT) return ROOT;
    if (n.indexOf(ROOT + '/') === 0) return n;
    return norm(ROOT + '/' + n.slice(1));
  }
  function baseName(p) { var n = norm(p); return n === '/' ? '/' : n.slice(n.lastIndexOf('/') + 1); }
  function parentOf(p) { var n = norm(p); if (n === '/' || n === ROOT) return null; var i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); }
  function relOf(p) { var n = norm(p); return n === ROOT ? 'workspace' : n.replace(ROOT + '/', ''); }

  function byPath() {
    var m = Object.create(null);
    var l = files();
    for (var i = 0; i < l.length; i++) m[norm(l[i].path)] = l[i];
    return m;
  }
  function isDirPath(map, p) {
    if (p === ROOT || p === '/') return true;
    var rec = map[p];
    if (rec) return rec.kind === 'dir';
    var prefix = p + '/';
    for (var k in map) if (k.indexOf(prefix) === 0) return true;
    return false;
  }
  function directChildren(map, dir) {
    var out = [];
    var prefix = dir === ROOT ? ROOT + '/' : dir + '/';
    for (var k in map) {
      if (k.indexOf(prefix) !== 0) continue;
      var rest = k.slice(prefix.length);
      if (!rest || rest.indexOf('/') >= 0) continue;
      out.push({ path: k, rec: map[k], dir: isDirPath(map, k) });
    }
    out.sort(function (a, b) {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return baseName(a.path).localeCompare(baseName(b.path));
    });
    return out;
  }
  function sizeOf(rec) {
    if (rec && typeof rec.size === 'number') return rec.size;
    var c = rec && typeof rec.content === 'string' ? rec.content : '';
    return U().byteLength ? U().byteLength(c) : c.length;
  }

  /* --------------------------------------------------------------- 写操作 */
  function writeFiles(next, msg) {
    var prev = files();
    setState('projectFiles', next);
    syncServer(prev, next);
    if (msg) toast(msg, 'ok');
  }

  /* 文件面板的增删改同步到服务端真实工作区（后端不可达时保留本机草稿，并如实提示） */
  function syncServer(prev, next) {
    var fs = A.ide && A.ide.fs;
    if (!fs || typeof fs.online !== 'function' || !fs.online()) return;
    var pm = Object.create(null), nm = Object.create(null);
    prev.forEach(function (f) { pm[norm(f.path)] = f; });
    next.forEach(function (f) { nm[norm(f.path)] = f; });
    var removed = [], added = [];
    Object.keys(pm).forEach(function (p) { if (!nm[p]) removed.push(p); });
    Object.keys(nm).forEach(function (p) { if (!pm[p]) added.push(p); });
    /* 单删单增且内容一致 → 视为重命名，走 rename 保住目录子树 */
    if (removed.length === 1 && added.length === 1) {
      var o = pm[removed[0]], n = nm[added[0]];
      if ((o.kind === 'dir') === (n.kind === 'dir') && String(o.content || '') === String(n.content || '')) {
        fs.rename(removed[0], added[0]);
        return;
      }
    }
    removed.forEach(function (p) { if (fs.remove) fs.remove(p); });
    added.forEach(function (p) {
      var f = nm[p];
      if (f.kind === 'dir') { if (fs.mkdir) fs.mkdir(p); }
      else if (fs.write) fs.write(p, f.content || '');
    });
    Object.keys(nm).forEach(function (p) {
      var f = nm[p], o = pm[p];
      if (o && f.kind !== 'dir' && String(o.content || '') !== String(f.content || '') && fs.write) fs.write(p, f.content || '');
    });
  }
  function siblingExists(map, dir, name, exceptPath) {
    var kids = directChildren(map, dir);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].path === exceptPath) continue;
      if (baseName(kids[i].path).toLowerCase() === name.toLowerCase()) return true;
    }
    return false;
  }
  function validName(name) {
    var n = String(name || '').trim();
    if (!n) return '名称不能为空';
    if (n.indexOf('/') >= 0 || n.indexOf('\\') >= 0) return '名称不能包含斜杠';
    if (n === '.' || n === '..') return '名称非法';
    if (n.length > 64) return '名称过长';
    return '';
  }

  function createNode(dirPath, name, kind, content) {
    var err = validName(name);
    if (err) { toast(err, 'warn'); return null; }
    var map = byPath();
    var dir = abs(dirPath || ROOT);
    if (!isDirPath(map, dir)) { toast('目标不是目录', 'warn'); return null; }
    var path = norm(dir + '/' + name.trim());
    if (map[path] || siblingExists(map, dir, name.trim(), null)) { toast('同名项目已存在', 'warn'); return null; }
    var rec = { id: uid(), path: path, kind: kind === 'dir' ? 'dir' : 'file', content: kind === 'dir' ? '' : (content == null ? '' : content), updatedAt: Date.now() };
    var next = files().slice();
    next.push(rec);
    writeFiles(next, (kind === 'dir' ? '已新建文件夹 ' : '已新建文件 ') + baseName(path));
    if (kind !== 'dir') select(path, true);
    return rec;
  }
  function renameNode(path, name) {
    path = abs(path);
    if (path === ROOT) { toast('工作区根目录不可重命名', 'warn'); return; }
    var err = validName(name);
    if (err) { toast(err, 'warn'); return; }
    var map = byPath();
    var rec = map[path];
    if (!rec && !isDirPath(map, path)) return;
    var dir = parentOf(path);
    var nextPath = norm(dir + '/' + name.trim());
    if (nextPath === path) return;
    if (map[nextPath] || siblingExists(map, dir, name.trim(), path)) { toast('同名项目已存在', 'warn'); return; }
    var isDir = isDirPath(map, path);
    var next = files().map(function (f) {
      var p = norm(f.path);
      if (p === path || (isDir && p.indexOf(path + '/') === 0)) {
        var c = {}; for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) c[k] = f[k];
        c.path = nextPath + p.slice(path.length);
        c.updatedAt = Date.now();
        return c;
      }
      return f;
    });
    writeFiles(next, '已重命名为 ' + name.trim());
    if (selected === path || (isDir && selected.indexOf(path + '/') === 0)) select(nextPath + selected.slice(path.length), false);
  }
  function deleteNode(path) {
    path = abs(path);
    if (path === ROOT) { toast('工作区根目录不可删除', 'warn'); return; }
    var map = byPath();
    var isDir = isDirPath(map, path);
    var victims = files().filter(function (f) {
      var p = norm(f.path);
      return p === path || (isDir && p.indexOf(path + '/') === 0);
    });
    if (!victims.length) return;
    var tip = isDir ? ('将删除文件夹 ' + baseName(path) + ' 及其中的 ' + (victims.length - (map[path] ? 1 : 0)) + ' 个项目') : ('将删除文件 ' + baseName(path));
    var go = function () {
      var next = files().filter(function (f) {
        var p = norm(f.path);
        return !(p === path || (isDir && p.indexOf(path + '/') === 0));
      });
      writeFiles(next, '已删除 ' + baseName(path));
      if (selected === path || selected.indexOf(path + '/') === 0) clearPreview();
    };
    if (A.ui && typeof A.ui.confirm === 'function') {
      A.ui.confirm({ title: '删除确认', text: tip + '，该操作不可撤销。', okText: '删除', danger: true }).then(function (ok) { if (ok) go(); });
    } else go();
  }

  /* --------------------------------------------------------------- 输入弹窗 */
  function promptBox(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!A.ui || typeof A.ui.modal !== 'function') {
        var v = window.prompt ? window.prompt(opts.label || '', opts.value || '') : null;
        resolve(v == null ? null : String(v));
        return;
      }
      var done = false;
      var input = el('input', { type: 'text', value: opts.value || '', placeholder: opts.placeholder || '' });
      var body = el('div', { style: 'padding:14px 16px' },
        el('div', { style: 'font-size:11.5px;color:var(--ax-text-3);margin-bottom:6px', text: opts.label || '' }),
        el('div', { class: 'rb-field' }, input)
      );
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done = true; m.close(); resolve(String(input.value || '').trim()); }
      });
      var m = A.ui.modal({
        title: opts.title || '', body: body,
        actions: [
          { label: '取消', onClick: function (c) { c(); } },
          { label: opts.okText || '确定', kind: 'primary', onClick: function (c) { done = true; c(); resolve(String(input.value || '').trim()); } }
        ],
        onClose: function () { if (!done) resolve(null); }
      });
      later(function () { try { input.focus(); input.select(); } catch (_) {} }, 40);
    });
  }

  /* --------------------------------------------------------------- 预览 */
  function codePreview(text, lang) {
    var hl = (A.ui && typeof A.ui.highlightLines === 'function') ? A.ui.highlightLines(text, lang) : null;
    var lines = String(text == null ? '' : text).split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
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
  function langOf(path) {
    var ext = String(path || '').split('.').pop().toLowerCase();
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') return 'js';
    if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg' || ext === 'vue') return 'html';
    if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'sh';
    if (ext === 'py') return 'py';
    if (ext === 'json') return 'json';
    return 'text';
  }

  function clearPreview() {
    selected = '';
    if (!els) return;
    els.prev.style.display = 'none';
    if (els.prevBody) els.prevBody.textContent = '';
    syncSelected();
  }

  function showPreview(path) {
    var rec = byPath()[abs(path)];
    if (!rec || rec.kind === 'dir') { clearPreview(); return; }
    selected = abs(path);
    if (!els) return;
    els.prev.style.display = '';
    els.prevName.textContent = relOf(selected);
    if (els.prevMeta) els.prevMeta.textContent = (U().fmtBytes ? U().fmtBytes(sizeOf(rec)) : '') + (rec.updatedAt && U().fmtTime ? ' · ' + U().fmtTime(rec.updatedAt) : '');
    els.prevBody.textContent = '';
    els.prevBody.appendChild(codePreview(rec.content, langOf(selected)));
    syncSelected();
  }

  function select(path, openIde) {
    showPreview(path);
    if (openIde) openInIde(selected || path);
  }
  function openInIde(path) {
    var p = abs(path);
    if (!p) return;
    emit('file:open', { path: p });
    toast('已在 IDE 打开 ' + baseName(p), 'ok');
  }
  function downloadFile(path) {
    var rec = byPath()[abs(path)];
    if (!rec) return;
    if (U().download) {
      U().download(baseName(rec.path), rec.content == null ? '' : rec.content, U().mimeOf ? U().mimeOf(rec.path) : 'text/plain');
      toast('已开始下载 ' + baseName(rec.path), 'ok');
    }
  }
  function runInTerminal(path) {
    var p = abs(path);
    var cmd = /\.py$/.test(p) ? ('python3 ' + p) : (/\.(js|mjs|cjs)$/.test(p) ? ('node ' + p) : (/\.(sh|bash)$/.test(p) ? ('bash ' + p) : ('cat ' + p)));
    emit('panel:open', { tab: 'terminal' });
    emit('terminal:run', { cmd: cmd, byUser: true });
  }

  /* --------------------------------------------------------------- 渲染 */
  function matchQuery(node, map) {
    if (!query) return true;
    var q = query.toLowerCase();
    if (baseName(node.path).toLowerCase().indexOf(q) >= 0) return true;
    return subtreeMatch(node.path, map, q);
  }
  function subtreeMatch(path, map, q) {
    var prefix = path + '/';
    for (var k in map) if (k.indexOf(prefix) === 0 && baseName(k).toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }

  function buildNodes(dir, depth, map, out) {
    var kids = directChildren(map, dir);
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (!matchQuery(kid, map)) continue;
      var open = !!openDirs[kid.path] || (!!query && kid.dir);
      var row = el('div', {
        class: 'rb-node__row', role: 'treeitem', tabindex: '0', 'data-path': kid.path,
        style: 'padding-left:' + (4 + depth * 14) + 'px',
        'aria-expanded': kid.dir ? String(!!open) : null,
        onclick: function (e) {
          var p = e.currentTarget.getAttribute('data-path');
          var m = byPath();
          if (isDirPath(m, p)) { toggleDir(p); }
          else { showPreview(p); }
        },
        onkeydown: function (e) {
          var p = e.currentTarget.getAttribute('data-path');
          if (e.key === 'Enter') { e.preventDefault(); var m = byPath(); if (isDirPath(m, p)) toggleDir(p); else showPreview(p); }
        }
      });
      var caret = el('span', { class: 'rb-node__caret' + (kid.dir ? (open ? ' rb-node__caret--open' : '') : ' rb-node__caret--leaf') }, icon('chevronRight', 13));
      var ic = icon(kid.dir ? 'folder' : 'file', 16);
      if (ic && A.icons && A.icons.color) { try { ic.style.color = kid.dir ? (A.icons.color('folder') || '') : (A.icons.color(baseName(kid.path)) || ''); } catch (_) {} }
      var acts = el('span', { class: 'rb-node__acts' },
        el('button', {
          class: 'rb-iconbtn', type: 'button', title: '重命名', 'aria-label': '重命名', style: 'width:24px;height:24px',
          onclick: function (e) { e.stopPropagation(); askRename(kid.path); }
        }, icon('sliders', 13)),
        el('button', {
          class: 'rb-iconbtn', type: 'button', title: '删除', 'aria-label': '删除', style: 'width:24px;height:24px',
          onclick: function (e) { e.stopPropagation(); deleteNode(kid.path); }
        }, icon('trash', 13))
      );
      row.appendChild(caret);
      row.appendChild(el('span', { class: 'rb-node__ico' }, ic));
      row.appendChild(el('span', { class: 'rb-node__name', text: baseName(kid.path) }));
      if (!kid.dir) row.appendChild(el('span', { class: 'rb-node__size', text: U().fmtBytes ? U().fmtBytes(sizeOf(kid.rec)) : '' }));
      row.appendChild(acts);

      var kidsBox = null;
      if (kid.dir) {
        kidsBox = el('div', { class: 'rb-node__kids' + (open ? '' : ' rb-node__kids--shut') });
        buildNodes(kid.path, depth + 1, map, kidsBox);
      }
      out.appendChild(el('div', { class: 'rb-node' + (kid.dir ? ' rb-node--dir' : ''), 'data-path': kid.path }, row, kidsBox));
    }
  }

  function toggleDir(path) {
    openDirs[path] = !openDirs[path];
    render();
  }

  function render() {
    if (!els) return;
    var map = byPath();
    var tree = els.tree;
    tree.textContent = '';
    if (!expandedInit) {
      openDirs[ROOT] = true;
      expandedInit = true;
      var top = directChildren(map, ROOT);
      for (var i = 0; i < top.length; i++) if (top[i].dir && top[i].path.split('/').length <= 3) openDirs[top[i].path] = true;
    }
    openDirs[ROOT] = true;

    var rootRow = el('div', {
      class: 'rb-node__row', role: 'treeitem', tabindex: '0', 'data-path': ROOT, style: 'padding-left:4px',
      onclick: function () { toggleDir(ROOT); }
    },
      el('span', { class: 'rb-node__caret' + (openDirs[ROOT] ? ' rb-node__caret--open' : '') }, icon('chevronRight', 13)),
      el('span', { class: 'rb-node__ico' }, icon('folder', 16)),
      el('span', { class: 'rb-node__name', text: 'workspace' }),
      el('span', { class: 'rb-node__size', text: files().length + ' 项' })
    );
    tree.appendChild(el('div', { class: 'rb-node rb-node--dir', 'data-path': ROOT }, rootRow));

    var kidsBox = el('div', { class: 'rb-node__kids' + (openDirs[ROOT] ? '' : ' rb-node__kids--shut') });
    buildNodes(ROOT, 1, map, kidsBox);
    tree.appendChild(kidsBox);

    if (!files().length) {
      tree.appendChild(el('div', { class: 'ax-empty', style: 'padding:24px 16px;text-align:center' },
        el('div', { style: 'font-size:12.5px;color:var(--ax-text-2,#a7b0c0)', text: '项目文件为空' }),
        el('div', { style: 'font-size:12px;margin-top:4px;opacity:.8', text: '可在终端里 mkdir / touch，或点上方新建' })
      ));
    }
    if (els.badge) els.badge.textContent = files().length + ' 项';
    if (els.empty) els.empty.style.display = (files().length && !query) ? 'none' : '';
    syncSelected();
    report();
  }

  function syncSelected() {
    if (!els || !els.tree) return;
    var rows = els.tree.querySelectorAll('.rb-node__row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('rb-node__row--on', rows[i].getAttribute('data-path') === selected);
    }
  }

  function report() {
    if (!A.rightPanel || typeof A.rightPanel.setStatus !== 'function') return;
    var n = files().length;
    A.rightPanel.setStatus(n ? 'ok' : 'off', n ? ('项目文件：' + n + ' 项') : '项目文件：空');
  }

  /* --------------------------------------------------------------- 右上操作 */
  function askNew(kind) {
    var dir = selected ? (isDirPath(byPath(), selected) ? selected : parentOf(selected)) : ROOT;
    promptBox({
      title: kind === 'dir' ? '新建文件夹' : '新建文件',
      label: '位置：' + relOf(abs(dir || ROOT)),
      placeholder: kind === 'dir' ? '文件夹名' : '文件名，如 main.js',
      okText: '创建'
    }).then(function (name) {
      if (!name) return;
      var rec = createNode(dir || ROOT, name, kind, '');
      if (rec && kind === 'dir') { openDirs[parentOf(rec.path)] = true; openDirs[rec.path] = true; render(); }
      else if (rec) render();
    });
  }
  function askRename(path) {
    promptBox({ title: '重命名', label: '当前：' + relOf(abs(path)), value: baseName(path), okText: '重命名' }).then(function (name) {
      if (!name) return;
      renameNode(path, name);
    });
  }
  function collapseAll() {
    openDirs = Object.create(null);
    openDirs[ROOT] = true;
    render();
  }
  function expandAll() {
    var map = byPath();
    for (var k in map) if (isDirPath(map, k)) openDirs[k] = true;
    openDirs[ROOT] = true;
    render();
  }

  /* --------------------------------------------------------------- 构建 */
  function build(host) {
    var badge = el('span', { class: 'rb-badge', text: '0 项' });
    var search = el('input', { type: 'search', placeholder: '搜索文件', 'aria-label': '搜索文件' });
    var searchWrap = el('div', { class: 'rb-field', style: 'flex:1 1 120px;min-width:110px' }, icon('search', 14), search);
    var addFile = el('button', { class: 'rb-iconbtn', type: 'button', title: '新建文件', 'aria-label': '新建文件', onclick: function () { askNew('file'); } }, icon('plus', 16));
    var addDir = el('button', { class: 'rb-iconbtn', type: 'button', title: '新建文件夹', 'aria-label': '新建文件夹', onclick: function () { askNew('dir'); } }, icon('folder', 16));
    var folding = el('button', { class: 'rb-iconbtn', type: 'button', title: '折叠全部', 'aria-label': '折叠全部', onclick: function () { if (els.folded) { expandAll(); } else { collapseAll(); } els.folded = !els.folded; } }, icon('collapse', 16));

    var onSearch = U().debounce ? U().debounce(function () { query = String(search.value || '').trim(); render(); }, 160) : function () { query = String(search.value || '').trim(); render(); };
    search.addEventListener('input', onSearch);

    var tree = el('div', { class: 'rb-tree', role: 'tree', 'aria-label': '项目文件树' });
    var scroll = el('div', { class: 'rb-scrollpane ax-scroll', style: 'flex:1 1 auto' }, tree);

    var prevName = el('span', { class: 'rb-fileprev__name', text: '' });
    var prevMeta = el('span', { class: 'rb-node__size', text: '' });
    var prevBody = el('div', { class: 'rb-fileprev__body ax-scroll' });
    var prev = el('div', { class: 'rb-fileprev', style: 'display:none' },
      el('div', { class: 'rb-fileprev__head' },
        icon('file', 14), prevName, prevMeta,
        el('button', { class: 'rb-iconbtn', type: 'button', title: '在 IDE 打开', 'aria-label': '在 IDE 打开', style: 'width:24px;height:24px', onclick: function () { if (selected) openInIde(selected); } }, icon('code', 14)),
        el('button', { class: 'rb-iconbtn', type: 'button', title: '在终端运行', 'aria-label': '在终端运行', style: 'width:24px;height:24px', onclick: function () { if (selected) runInTerminal(selected); } }, icon('terminal', 14)),
        el('button', { class: 'rb-iconbtn', type: 'button', title: '下载', 'aria-label': '下载', style: 'width:24px;height:24px', onclick: function () { if (selected) downloadFile(selected); } }, icon('download', 14)),
        el('button', { class: 'rb-iconbtn', type: 'button', title: '关闭预览', 'aria-label': '关闭预览', style: 'width:24px;height:24px', onclick: function () { clearPreview(); } }, icon('x', 14))
      )
    );
    prev.appendChild(prevBody);

    var root = el('div', { class: 'rb-files' },
      el('div', { class: 'rb-toolbar' },
        el('span', { class: 'rb-toolbar__title', text: '项目文件' }),
        badge,
        el('span', { class: 'rb-toolbar__spacer' }),
        addFile, addDir, folding
      ),
      el('div', { class: 'rb-toolbar', style: 'border-bottom:1px solid var(--ax-hairline);padding:6px 10px' }, searchWrap),
      scroll,
      prev
    );
    els = { root: root, tree: tree, badge: badge, prev: prev, prevName: prevName, prevMeta: prevMeta, prevBody: prevBody, search: search, empty: null, folded: false };
    host.appendChild(root);
  }

  /* --------------------------------------------------------------- 事件 */
  function bind() {
    if (!A.bus) return;
    var pair = function (evt, fn) { A.bus.on(evt, fn); offs.push(function () { A.bus.off(evt, fn); }); };
    pair('file:open', function (p) {
      if (!p || !p.path) return;
      var rec = byPath()[abs(p.path)];
      if (rec && rec.kind !== 'dir' && mounted) showPreview(rec.path);
    });
    pair('file:save', function (p) {
      if (!p || !p.path) return;
      var target = abs(p.path);
      var next = files().map(function (f) {
        if (norm(f.path) !== target) return f;
        var c = {}; for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) c[k] = f[k];
        c.content = p.content == null ? '' : String(p.content);
        c.kind = 'file';
        c.updatedAt = Date.now();
        return c;
      });
      if (JSON.stringify(next) === JSON.stringify(files())) return;
      setState('projectFiles', next);
      if (mounted && selected === target) showPreview(target);
    });
    if (A.store) offs.push(A.store.subscribe('projectFiles', function () { if (mounted) render(); }));
  }
  function offAll() { for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (_) {} } offs.length = 0; }

  /* --------------------------------------------------------------- 生命周期 */
  function mount(host) {
    if (!host) return;
    mounted = true;
    if (!els) build(host); else host.appendChild(els.root);
    render();
  }
  function unmount() {
    mounted = false;
    clearTimers();
    if (A.ui && A.ui.closeAll) { try { A.ui.closeAll(); } catch (_) {} }
    if (els && els.root && els.root.parentNode) els.root.parentNode.removeChild(els.root);
  }

  A.ready(function () {
    A.register('right-panel', 'files', {
      title: '项目文件', icon: 'files', order: 30,
      mount: mount, unmount: unmount
    });
    bind();
  });

  A.files = {
    ROOT: ROOT,
    create: createNode,
    rename: renameNode,
    remove: deleteNode,
    open: openInIde,
    select: select,
    refresh: render,
    count: function () { return files().length; },
    _offAll: offAll
  };
})();
