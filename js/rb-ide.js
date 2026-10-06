/* AYCHO module: rb-ide | owner: B | contract: v1 */
/* IDE 面板：文件侧栏 + 行号 / 语法高亮 / 当前行 / 幽灵提示 / Tab 缩进 + 自动配对 + Ctrl+S 保存。
   同时对外提供 A.ui.highlight(text,lang) 与 A.ui.highlightLines(text,lang)。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var ROOT = '/workspace';
  var INDENT = '  ';

  var els = null;
  var mounted = false;
  var offs = [];
  var timers = [];

  var cur = { path: '', content: '', dirty: false };
  var wrap = false;
  var sideOpen = true;

  /* ============================================================ 语法高亮 */
  var KW = {
    js: 'var let const function return if else for while do break continue class extends new this super import export from default async await try catch finally throw typeof instanceof delete void yield switch case in of null undefined true false NaN Infinity static get set as',
    py: 'def class return if elif else for while import from as pass break continue try except finally raise with lambda None True False and or not in is global nonlocal yield assert del async await self print',
    sh: 'if then else elif fi for do done while case esac function return export local echo cd ls mkdir rmdir cp mv cat grep sed awk set unset trap exit source read printf sudo npm node python3 pip git curl wget',
    json: 'true false null',
    css: 'important media supports keyframes import font-face from to',
    html: '', md: '', text: ''
  };
  var HASH_COMMENT = { py: 1, sh: 1, yaml: 1 };

  function esc(s) {
    if (A.util && A.util.escapeHtml) return A.util.escapeHtml(s);
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function tok(cls, s) { return '<span class="tk-' + cls + '">' + esc(s) + '</span>'; }
  function kwSet(lang) {
    var m = Object.create(null), a = (KW[lang] || '').split(' ');
    for (var i = 0; i < a.length; i++) if (a[i]) m[a[i]] = 1;
    return m;
  }
  var KW_CACHE = Object.create(null);
  function kw(lang) { return KW_CACHE[lang] || (KW_CACHE[lang] = kwSet(lang)); }

  function hlHtml(line, st) {
    var out = '', i = 0, n = line.length;
    if (st.html) {
      var e0 = line.indexOf('-->', i);
      if (e0 < 0) return tok('com', line);
      out += tok('com', line.slice(0, e0 + 3)); i = e0 + 3; st.html = false;
    }
    while (i < n) {
      if (line.slice(i, i + 4) === '<!--') {
        var ee = line.indexOf('-->', i + 4);
        if (ee < 0) { out += tok('com', line.slice(i)); st.html = true; i = n; }
        else { out += tok('com', line.slice(i, ee + 3)); i = ee + 3; }
        continue;
      }
      var ch = line.charAt(i);
      if (ch === '<') {
        var m = /^<\/?[A-Za-z][\w:-]*/.exec(line.slice(i));
        if (m) { out += tok('punc', m[0].charAt(0)) + tok('tag', m[0].slice(1)); i += m[0].length; continue; }
        out += tok('punc', ch); i++; continue;
      }
      if (ch === '>') { out += tok('punc', ch); i++; continue; }
      if (ch === '/' && line.charAt(i + 1) === '>') { out += tok('punc', '/>'); i += 2; continue; }
      if (ch === '"' || ch === "'") {
        var j = i + 1;
        while (j < n && line.charAt(j) !== ch) j++;
        var seg = line.slice(i, Math.min(j + 1, n));
        out += tok('str', seg); i = Math.min(j + 1, n); continue;
      }
      var at = /^[A-Za-z_:][\w:.-]*/.exec(line.slice(i));
      if (at) { out += tok('attr', at[0]); i += at[0].length; continue; }
      var nm = /^\d+(\.\d+)?/.exec(line.slice(i));
      if (nm) { out += tok('num', nm[0]); i += nm[0].length; continue; }
      out += esc(ch); i++;
    }
    return out;
  }

  function hlMarkdown(line, st) {
    if (/^\s*```/.test(line)) { st.fence = !st.fence; return tok('punc', line); }
    if (st.fence) return tok('str', line);
    var h = /^(\s*#{1,6}\s+)(.*)$/.exec(line);
    if (h) return tok('punc', h[1]) + tok('key', h[2]);
    var li = /^(\s*[-*+]\s+)(.*)$/.exec(line);
    if (li) return tok('op', li[1]) + esc(li[2]);
    if (/^\s*>\s?/.test(line)) return tok('com', line);
    var out = '', rest = line, re = /(`[^`]*`)|(\*\*[^*]+\*\*)|(\[[^\]]*\]\([^)]*\))/;
    while (rest) {
      var m = re.exec(rest);
      if (!m) { out += esc(rest); break; }
      out += esc(rest.slice(0, m.index));
      if (m[1]) out += tok('str', m[1]);
      else if (m[2]) out += tok('key', m[2]);
      else out += tok('fn', m[3]);
      rest = rest.slice(m.index + m[0].length);
    }
    return out;
  }

  function tokenize(line, lang, st) {
    if (lang === 'html') return hlHtml(line, st);
    if (lang === 'md') return hlMarkdown(line, st);
    var kwm = kw(lang), hash = !!HASH_COMMENT[lang];
    var out = '', i = 0, n = line.length;
    while (i < n) {
      if (st.block) {
        var e = line.indexOf('*/', i);
        if (e < 0) return out + tok('com', line.slice(i));
        out += tok('com', line.slice(i, e + 2)); i = e + 2; st.block = false; continue;
      }
      var ch = line.charAt(i), nx = line.charAt(i + 1);
      if (!hash && ch === '/' && nx === '/') return out + tok('com', line.slice(i));
      if (!hash && ch === '/' && nx === '*') { st.block = true; i += 2; continue; }
      if (hash && ch === '#') return out + tok('com', line.slice(i));
      if (ch === '"' || ch === "'" || ch === '`') {
        var j = i + 1, closed = false;
        while (j < n) {
          if (line.charAt(j) === '\\') { j += 2; continue; }
          if (line.charAt(j) === ch) { closed = true; break; }
          j++;
        }
        out += tok('str', line.slice(i, closed ? j + 1 : n));
        i = closed ? j + 1 : n;
        continue;
      }
      if (/[0-9]/.test(ch) && !/[\w$.]/.test(line.charAt(i - 1) || '')) {
        var num = /^(0[xX][0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?(px|em|rem|vh|vw|s|ms|%)?)/.exec(line.slice(i));
        if (num) { out += tok('num', num[0]); i += num[0].length; continue; }
      }
      var w = /^[A-Za-z_$@#][\w$.-]*/.exec(line.slice(i));
      if (w) {
        var word = w[0], after = line.slice(i + word.length);
        if (lang === 'css' && /^\s*:/.test(after)) out += tok('prop', word);
        else if (kwm[word]) out += tok('key', word);
        else if (/^\s*\(/.test(after)) out += tok('fn', word);
        else out += esc(word);
        i += word.length; continue;
      }
      var op = /^(=>|===|!==|\+\+|--|&&|\|\||[+\-*/%=<>!&|?~^]+)/.exec(line.slice(i));
      if (op) { out += tok('op', op[0]); i += op[0].length; continue; }
      if (/[{}()\[\];,.:]/.test(ch)) { out += tok('punc', ch); i++; continue; }
      out += esc(ch); i++;
    }
    return out;
  }

  function highlightLines(text, lang) {
    lang = normalizeLang(lang);
    var lines = String(text == null ? '' : text).split('\n');
    var st = { block: false, html: false, fence: false };
    var out = [];
    for (var i = 0; i < lines.length; i++) out.push(tokenize(lines[i], lang, st));
    return out;
  }
  function normalizeLang(lang) {
    var l = String(lang || 'text').toLowerCase();
    if (l === 'javascript' || l === 'ts' || l === 'typescript' || l === 'jsx' || l === 'tsx') return 'js';
    if (l === 'python') return 'py';
    if (l === 'shell' || l === 'bash' || l === 'zsh') return 'sh';
    if (l === 'xml' || l === 'svg' || l === 'vue') return 'html';
    if (l === 'markdown') return 'md';
    if (l === 'scss' || l === 'less') return 'css';
    if (l === 'yml' || l === 'yaml') return 'yaml';
    return KW[l] ? l : 'text';
  }
  function langOfPath(path) {
    var ext = String(path || '').split('.').pop().toLowerCase();
    var map = { js: 'js', mjs: 'js', cjs: 'js', ts: 'js', jsx: 'js', tsx: 'js', json: 'json', css: 'css', scss: 'css', less: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html', md: 'md', markdown: 'md', py: 'py', sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'yaml', yaml: 'yaml', txt: 'text', log: 'text' };
    return map[ext] || 'js';
  }
  /* ============================================================ 基础 */
  function U() { return A.util || {}; }
  function S(p, d) { return A.store ? A.store.get(p, d) : d; }
  function setState(p, v) { if (A.store) A.store.set(p, v); }
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

  function norm(p) {
    var s = String(p || '').replace(/\\/g, '/'), parts = s.split('/'), out = [];
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
  function relOf(p) { var n = norm(p); return n === ROOT ? 'workspace' : n.replace(ROOT + '/', ''); }
  function files() {
    var v = S('projectFiles', []);
    if (!Array.isArray(v)) return [];
    return v.filter(function (f) { return f && typeof f.path === 'string' && f.path; });
  }
  function findFile(path) {
    var t = abs(path), l = files();
    for (var i = 0; i < l.length; i++) if (norm(l[i].path) === t) return l[i];
    return null;
  }
  function isDirRec(rec) { return !!rec && rec.kind === 'dir'; }
  function isDirPath(p) {
    p = abs(p);
    if (p === ROOT) return true;
    var rec = findFile(p);
    if (rec) return isDirRec(rec);
    var prefix = p + '/', l = files();
    for (var i = 0; i < l.length; i++) if (abs(l[i].path).indexOf(prefix) === 0) return true;
    return false;
  }

  /* ============================================================ 编辑区渲染 */
  function lineCount(text) { return String(text == null ? '' : text).split('\n').length; }

  function renderGutter() {
    if (!els || !els.gutter) return;
    var n = lineCount(cur.content), g = els.gutter, have = g.childNodes.length;
    if (have === n) { syncScroll(); return; }
    if (have < n) {
      for (var i = have; i < n; i++) g.appendChild(el('div', { class: 'rb-ide__no', text: String(i + 1) }));
    } else {
      for (var j = have - 1; j >= n; j--) g.removeChild(g.childNodes[j]);
    }
    syncScroll();
  }

  function renderHighlight() {
    if (!els || !els.hl) return;
    var html = highlightLines(cur.content, langOfPath(cur.path)).join('\n');
    els.hl.innerHTML = html + '\n';
    els.hl.style.width = wrap ? '100%' : 'auto';
  }

  function caretPos() {
    var ta = els.ta, v = String(ta.value || '');
    var idx = typeof ta.selectionStart === 'number' ? ta.selectionStart : 0;
    if (idx > v.length) idx = v.length;
    var lines = v.slice(0, idx).split('\n');
    return { line: lines.length, col: lines[lines.length - 1].length + 1, index: idx };
  }

  function renderCaret() {
    if (!els || !els.curline || !els.ta) return;
    var p = caretPos();
    var lh = 1.6 * 12, pad = 10;
    els.curline.style.transform = 'translateY(' + ((p.line - 1) * lh + pad) + 'px)';
    els.curline.classList.add('rb-ide__curline--on');
    if (els.posEl) els.posEl.textContent = '第 ' + p.line + ' 行，第 ' + p.col + ' 列';
    if (els.selEl) {
      var sel = 0;
      try { sel = Math.abs((els.ta.selectionEnd || 0) - (els.ta.selectionStart || 0)); } catch (_) { sel = 0; }
      els.selEl.textContent = sel ? ('已选 ' + sel + ' 字符') : '';
    }
  }

  function syncScroll() {
    if (els && els.gutter && els.scroll) els.gutter.scrollTop = els.scroll.scrollTop;
  }

  function autoGrowWidth() {
    if (!els || !els.ta) return;
    if (wrap) { els.ta.style.width = '100%'; return; }
    var w = 0;
    try { w = els.hl ? els.hl.scrollWidth : 0; } catch (_) { w = 0; }
    var cw = els.scroll && els.scroll.clientWidth ? els.scroll.clientWidth : 0;
    els.ta.style.width = Math.max(w, cw, 240) + 'px';
  }

  function renderStatus() {
    if (!els) return;
    var bytes = U().byteLength ? U().byteLength(cur.content) : String(cur.content).length;
    if (els.langEl) els.langEl.textContent = cur.path ? langOfPath(cur.path).toUpperCase() : '—';
    if (els.sizeEl) els.sizeEl.textContent = (U().fmtBytes ? U().fmtBytes(bytes) : bytes + ' B');
    if (els.dirtyEl) {
      els.dirtyEl.textContent = cur.path ? (cur.dirty ? '未保存' : '已保存') : '未打开文件';
      els.dirtyEl.style.color = cur.dirty ? 'var(--ax-warn,#fbbf24)' : '';
    }
    if (els.pathEl) els.pathEl.textContent = cur.path ? relOf(cur.path) : '未打开文件';
    if (els.saveBtn) els.saveBtn.disabled = !cur.path || !cur.dirty;
    if (els.ghost) els.ghost.classList.toggle('rb-ide__ghost--on', !cur.path || !String(cur.content).length);
  }

  function renderEmpty() {
    if (!els) return;
    els.emp.style.display = cur.path ? 'none' : '';
    els.editor.style.display = cur.path ? '' : 'none';
  }

  function renderAll() {
    renderGutter(); renderHighlight(); renderCaret(); renderStatus(); renderEmpty(); autoGrowWidth();
  }

  /* ============================================================ 打开 / 保存 */
  function openFile(path, opts) {
    opts = opts || {};
    var p = abs(path), rec = findFile(p);
    if (!rec) { toast('文件不存在：' + baseName(p), 'warn'); return false; }
    if (isDirRec(rec)) { toast('这是文件夹：' + baseName(p), 'warn'); return false; }
    if (cur.path && cur.dirty && cur.path !== p && !opts.force) {
      if (A.ui && typeof A.ui.confirm === 'function') {
        A.ui.confirm({ title: '未保存的修改', text: relOf(cur.path) + ' 有未保存修改，切换后将丢失。', okText: '放弃修改', danger: true })
          .then(function (ok) { if (ok) openFile(p, { force: true }); });
        return false;
      }
    }
    cur.path = p;
    cur.content = rec.content == null ? '' : String(rec.content);
    cur.dirty = false;
    if (els && els.ta) els.ta.value = cur.content;
    if (els && els.scroll) els.scroll.scrollTop = 0;
    renderAll(); highlightSide();
    if (A.rightPanel && A.rightPanel.setStatus) A.rightPanel.setStatus('ok', 'IDE：' + baseName(p));
    if (!opts.silent) toast('已打开 ' + relOf(p), 'ok');
    return true;
  }

  function markDirty() {
    if (!cur.path || cur.dirty) return;
    cur.dirty = true;
    renderStatus();
  }

  function saveFile(opts) {
    if (!cur.path) return false;
    cur.content = els && els.ta ? String(els.ta.value) : cur.content;
    emit('file:save', { path: cur.path, content: cur.content });
    var target = abs(cur.path);
    var next = files().map(function (f) {
      if (abs(f.path) !== target) return f;
      var c = {}; for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) c[k] = f[k];
      c.content = cur.content; c.kind = 'file'; c.updatedAt = Date.now();
      return c;
    });
    setState('projectFiles', next);
    cur.dirty = false;
    renderStatus();
    highlightSide();
    if (!opts || !opts.quiet) toast('已保存 ' + relOf(cur.path), 'ok');
    return true;
  }

  /* ============================================================ 侧栏 */
  function sideRows(dir, depth, out) {
    var l = files(), prefix = dir === ROOT ? ROOT + '/' : dir + '/';
    var kids = [];
    for (var i = 0; i < l.length; i++) {
      var p = abs(l[i].path);
      if (p.indexOf(prefix) !== 0) continue;
      var rest = p.slice(prefix.length);
      if (!rest || rest.indexOf('/') >= 0) continue;
      kids.push({ path: p, rec: l[i], dir: isDirPath(p) });
    }
    kids.sort(function (a, b) {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return baseName(a.path).localeCompare(baseName(b.path));
    });
    for (var k = 0; k < kids.length; k++) {
      var kid = kids[k];
      out.push({ path: kid.path, dir: kid.dir, depth: depth });
      if (kid.dir && openDirs[kid.path]) sideRows(kid.path, depth + 1, out);
    }
    return out;
  }
  var openDirs = Object.create(null);
  var sideInit = false;

  function highlightSide() {
    if (!els || !els.side) return;
    var rows = els.side.querySelectorAll('.rb-ide__item');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('rb-ide__item--on', rows[i].getAttribute('data-path') === cur.path);
    }
  }

  function renderSide() {
    if (!els || !els.side) return;
    if (!sideInit) {
      sideInit = true;
      openDirs[ROOT] = true;
      var l = files();
      for (var i = 0; i < l.length; i++) {
        var p = abs(l[i].path);
        if (p.split('/').length <= 3 && isDirPath(p)) openDirs[p] = true;
      }
    }
    var box = els.side;
    box.textContent = '';
    var rows = sideRows(ROOT, 0, []);
    if (!rows.length) {
      box.appendChild(el('div', { class: 'ax-empty', style: 'padding:20px 12px;text-align:center;font-size:12px', text: '暂无项目文件' }));
      return;
    }
    for (var j = 0; j < rows.length; j++) {
      (function (row) {
        var ic = icon(row.dir ? 'folder' : 'file', 14);
        var item = el('div', {
          class: 'rb-ide__item' + (row.dir ? ' rb-ide__item--dir' : '') + (row.path === cur.path ? ' rb-ide__item--on' : ''),
          'data-path': row.path, title: relOf(row.path), role: 'button', tabindex: '0',
          style: 'padding-left:' + (8 + row.depth * 12) + 'px',
          onclick: function () {
            if (row.dir) { openDirs[row.path] = !openDirs[row.path]; renderSide(); }
            else openFile(row.path);
          },
          onkeydown: function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (row.dir) { openDirs[row.path] = !openDirs[row.path]; renderSide(); }
            else openFile(row.path);
          }
        });
        if (row.dir) item.appendChild(el('span', { class: 'rb-ide__tw' + (openDirs[row.path] ? ' rb-ide__tw--open' : '') }, icon('chevronRight', 11)));
        item.appendChild(el('span', { class: 'rb-ide__ico' }, ic));
        item.appendChild(el('span', { class: 'rb-ide__nm', text: baseName(row.path) }));
        box.appendChild(item);
      })(rows[j]);
    }
    highlightSide();
  }

  /* ============================================================ 编辑交互 */
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

  function insertText(ta, text, s, e) {
    var v = ta.value;
    s = s == null ? ta.selectionStart : s;
    e = e == null ? ta.selectionEnd : e;
    ta.value = v.slice(0, s) + text + v.slice(e);
    var pos = s + text.length;
    try { ta.setSelectionRange(pos, pos); } catch (_) {}
  }
  function lineStartIndex(v, idx) { return v.lastIndexOf('\n', Math.max(0, idx - 1)) + 1; }
  function indentOf(lineText) { var m = /^[ \t]*/.exec(lineText); return m ? m[0] : ''; }

  function onInput() {
    if (!els || !els.ta) return;
    cur.content = String(els.ta.value);
    markDirty();
    renderGutter(); renderHighlight(); renderCaret(); autoGrowWidth(); renderStatus();
  }

  function onKeyDown(e) {
    if (!els || !els.ta) return;
    var ta = els.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    var mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveFile(); return; }
    if (mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); toggleSide(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (s === en && !e.shiftKey) { insertText(ta, INDENT); }
      else {
        var ls = lineStartIndex(v, s), le = v.indexOf('\n', en);
        if (le < 0) le = v.length;
        var lines = v.slice(ls, le).split('\n');
        var outLines = [];
        for (var i = 0; i < lines.length; i++) {
          if (e.shiftKey) outLines.push(lines[i].replace(/^ {1,2}|\t/, ''));
          else outLines.push(INDENT + lines[i]);
        }
        var block = outLines.join('\n');
        ta.value = v.slice(0, ls) + block + v.slice(le);
        try { ta.setSelectionRange(ls, ls + block.length); } catch (_) {}
      }
      onInput();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      var ls2 = lineStartIndex(v, s);
      var curLine = v.slice(ls2, s);
      var ind = indentOf(curLine);
      var trimmed = curLine.replace(/\s+$/, '');
      var extra = /[{\[(:]$/.test(trimmed) ? INDENT : '';
      var nxt = v.charAt(en);
      e.preventDefault();
      if (extra && (nxt === '}' || nxt === ']' || nxt === ')')) {
        insertText(ta, '\n' + ind + extra + '\n' + ind);
        var p = s + 1 + ind.length + extra.length;
        try { ta.setSelectionRange(p, p); } catch (_) {}
      } else {
        insertText(ta, '\n' + ind + extra);
      }
      onInput();
      return;
    }

    if (e.key === 'Backspace' && s === en && s > 0) {
      var before = v.slice(0, s);
      var pair = before.slice(-2);
      var allPair = Object.keys(PAIRS).filter(function (k) { return PAIRS[k] === pair.charAt(1) && k === pair.charAt(0); });
      var isPair = allPair.length > 0 || /^[([{]['"`]$/.test(pair);
      if (isPair) {
        var after = v.slice(en, en + 1);
        if (after === pair.charAt(1) || PAIRS[pair.charAt(0)] === after) {
          e.preventDefault();
          ta.value = v.slice(0, s - 1) + v.slice(s + 1);
          try { ta.setSelectionRange(s - 1, s - 1); } catch (_) {}
          onInput();
          return;
        }
      }
      return;
    }

    if (PAIRS[e.key] && s === en && !mod && !e.altKey) {
      var nxtCh = v.charAt(en);
      if (e.key === '"' || e.key === "'" || e.key === '`') {
        if (nxtCh === e.key) {
          e.preventDefault();
          try { ta.setSelectionRange(s + 1, s + 1); } catch (_) {}
          return;
        }
        var prevCh = v.charAt(s - 1);
        if (/[\w\u4e00-\u9fa5]/.test(prevCh)) return;   // 引号在词中不配对
      }
      e.preventDefault();
      insertText(ta, e.key + PAIRS[e.key]);
      try { ta.setSelectionRange(s + 1, s + 1); } catch (_) {}
      onInput();
      return;
    }
  }

  function focusEditor() { if (els && els.ta) { try { els.ta.focus(); } catch (_) {} } }

  /* ============================================================ 工具栏动作 */
  function toggleSide() {
    sideOpen = !sideOpen;
    if (els && els.side) els.side.classList.toggle('rb-ide__side--shut', !sideOpen);
    if (els && els.sideBtn) els.sideBtn.setAttribute('aria-pressed', sideOpen ? 'true' : 'false');
    later(autoGrowWidth, 210);
  }
  function toggleWrap() {
    wrap = !wrap;
    if (els && els.editor) els.editor.classList.toggle('rb-ide__wrap', wrap);
    if (els && els.wrapBtn) els.wrapBtn.setAttribute('aria-pressed', wrap ? 'true' : 'false');
    renderHighlight(); autoGrowWidth(); renderCaret();
  }
  function runFile() {
    if (!cur.path) { toast('请先打开一个文件', 'warn'); return; }
    if (cur.dirty) saveFile({ quiet: true });
    var p = abs(cur.path);
    var cmd = /\.py$/.test(p) ? ('python3 ' + p)
      : (/\.(js|mjs|cjs)$/.test(p) ? ('node ' + p)
        : (/\.(sh|bash)$/.test(p) ? ('bash ' + p) : ('cat ' + p)));
    emit('panel:open', { tab: 'terminal' });
    emit('terminal:run', { cmd: cmd, byUser: true });
  }
  function downloadCur() {
    if (!cur.path) { toast('请先打开一个文件', 'warn'); return; }
    if (U().download) {
      U().download(baseName(cur.path), els && els.ta ? els.ta.value : cur.content, U().mimeOf ? U().mimeOf(cur.path) : 'text/plain');
      toast('已开始下载 ' + baseName(cur.path), 'ok');
    }
  }
  function newFile() {
    if (!A.files || typeof A.files.create !== 'function') { toast('请到「项目文件」面板新建', 'warn'); return; }
    emit('panel:open', { tab: 'files' });
  }

  /* ============================================================ 构建 */
  /* 打开文件夹：从工作区已有目录/顶层文件里选一个当根（用户要求：左侧能直接选文件夹） */
  function pickFolder() {
    var dirs = Object.create(null);
    files().forEach(function (f) {
      var p = abs(f.path);
      var segs = p.split('/');
      for (var i = 1; i < segs.length; i++) {
        var d = segs.slice(0, i).join('/');
        dirs[d] = true;
      }
    });
    var list = Object.keys(dirs).sort();
    var msg = list.length
      ? '选择一个文件夹作为 IDE 根（将只显示该目录下的文件）：\n' + list.map(function (d) { return d; }).join('\n')
      : '工作区为空，没有可打开的文件夹。先到「项目文件」面板添加文件。';
    var raw = window.prompt(msg, ROOT);
    if (!raw) return;
    var p = abs(raw.trim());
    if (!files().some(function (f) { return abs(f.path).indexOf(p) === 0 || abs(f.path) === p; }) && p !== ROOT) {
      toast('该路径下没有文件：' + p, 'warn');
      return;
    }
    pickFolder._root = p;
    openDirs = Object.create(null);
    openDirs[p] = true;
    openDirs[ROOT] = true;
    sideInit = false;
    renderSide();
    toast('IDE 根已切换到 ' + relOf(p), 'ok');
  }
  pickFolder._root = null;

  function build(host) {
    /* 侧栏 */
    var side = el('div', {
      class: 'rb-ide__side' + (sideOpen ? '' : ' rb-ide__side--shut'),
      'aria-label': '项目文件列表'
    });
    var sideHead = el('div', { class: 'rb-ide__sidehead' },
      icon('files', 14),
      el('span', { class: 'rb-ide__sidetitle', text: '项目文件' }),
      el('span', { class: 'rb-toolbar__spacer' }),
      el('button', { class: 'rb-iconbtn', type: 'button', title: '打开文件夹', 'aria-label': '打开文件夹', style: 'width:24px;height:24px', onclick: pickFolder }, icon('folder', 14)),
      el('button', { class: 'rb-iconbtn', type: 'button', title: '新建文件', 'aria-label': '新建文件', style: 'width:24px;height:24px', onclick: newFile }, icon('plus', 14))
    );
    var sideList = el('div', { class: 'rb-ide__sidebody rb-scrollpane ax-scroll' });
    side.appendChild(sideHead);
    side.appendChild(sideList);

    /* 编辑器 */
    var gutter = el('div', { class: 'rb-ide__gutter', 'aria-hidden': 'true' });
    var hl = el('pre', { class: 'rb-ide__hl', 'aria-hidden': 'true' });
    var curline = el('div', { class: 'rb-ide__curline' });
    var ghost = el('div', { class: 'rb-ide__ghost' }, icon('terminal', 13), el('span', { text: '开始输入… Ctrl/Cmd+S 保存，Tab 缩进' }));
    var ta = el('textarea', {
      class: 'rb-ide__ta', spellcheck: 'false', wrap: 'off', autocapitalize: 'off', autocomplete: 'off',
      'aria-label': '代码编辑器', placeholder: ''
    });
    var inner = el('div', { class: 'rb-ide__inner' }, curline, hl, ta);
    var scroll = el('div', { class: 'rb-ide__scroll ax-scroll' }, inner);
    var editor = el('div', { class: 'rb-ide__editor' + (wrap ? ' rb-ide__wrap' : '') }, gutter, scroll, ghost);

    var emp = el('div', { class: 'rb-ide__emp' },
      icon('code', 26),
      el('h4', { text: '未打开文件' }),
      el('p', { text: '在左侧列表选择一个项目文件，或到「项目文件」面板新建。' }),
      el('button', { class: 'rb-btn', type: 'button', onclick: function () { emit('panel:open', { tab: 'files' }); } }, '前往项目文件')
    );

    var body = el('div', { class: 'rb-ide__body' }, side,
      el('div', { class: 'rb-ide__main' }, editor, emp)
    );

    /* 工具栏 */
    var sideBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '切换侧栏 (Ctrl/Cmd+E)', 'aria-label': '切换侧栏', 'aria-pressed': sideOpen ? 'true' : 'false', onclick: toggleSide }, icon('menu', 16));
    var pathEl = el('span', { class: 'rb-ide__path', text: '未打开文件' });
    var wrapBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '自动换行', 'aria-label': '自动换行', 'aria-pressed': wrap ? 'true' : 'false', onclick: toggleWrap }, icon('box', 16));
    var runBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '在终端运行', 'aria-label': '在终端运行', onclick: runFile }, icon('terminal', 16));
    var dlBtn = el('button', { class: 'rb-iconbtn', type: 'button', title: '下载文件', 'aria-label': '下载文件', onclick: downloadCur }, icon('download', 16));
    var saveBtn = el('button', { class: 'rb-btn rb-btn--pri', type: 'button', title: '保存 (Ctrl/Cmd+S)', disabled: 'disabled', onclick: function () { saveFile(); } }, icon('check', 14), el('span', { text: '保存' }));
    var toolbar = el('div', { class: 'rb-toolbar' },
      sideBtn, pathEl, el('span', { class: 'rb-toolbar__spacer' }), wrapBtn, runBtn, dlBtn, saveBtn
    );

    /* 状态栏 */
    var posEl = el('span', { class: 'rb-ide__st', text: '第 1 行，第 1 列' });
    var selEl = el('span', { class: 'rb-ide__st', text: '' });
    var langEl = el('span', { class: 'rb-ide__st', text: '—' });
    var sizeEl = el('span', { class: 'rb-ide__st', text: '0 B' });
    var dirtyEl = el('span', { class: 'rb-ide__st', text: '未打开文件' });
    var status = el('div', { class: 'rb-ide__status' },
      posEl, selEl, el('span', { class: 'rb-toolbar__spacer' }), langEl, sizeEl, dirtyEl
    );

    var root = el('div', { class: 'rb-ide' }, toolbar, body, status);
    host.appendChild(root);
    els = {
      root: root, side: side, sideList: sideList, editor: editor, gutter: gutter, hl: hl,
      ta: ta, scroll: scroll, curline: curline, ghost: ghost, emp: emp,
      sideBtn: sideBtn, wrapBtn: wrapBtn, saveBtn: saveBtn, pathEl: pathEl,
      posEl: posEl, selEl: selEl, langEl: langEl, sizeEl: sizeEl, dirtyEl: dirtyEl
    };

    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('scroll', function () { syncScroll(); renderCaret(); });
    ta.addEventListener('keyup', renderCaret);
    ta.addEventListener('click', renderCaret);
    ta.addEventListener('select', renderCaret);
    ta.addEventListener('blur', function () { if (els && els.curline) els.curline.classList.remove('rb-ide__curline--on'); });
    ta.addEventListener('focus', renderCaret);
    scroll.addEventListener('scroll', syncScroll);
    window.addEventListener('resize', onResize);
    offs.push(function () { window.removeEventListener('resize', onResize); });

    renderSide();
    renderAll();
  }

  function onResize() { autoGrowWidth(); renderCaret(); }

  /* ============================================================ 事件 */
  function bind() {
    if (!A.bus) return;
    var onOpen = function (p) {
      if (!p || !p.path) return;
      if (!mounted) pendingOpen = p.path;
      else openFile(p.path);
    };
    var onSave = function (p) {
      if (!p || !p.path) return;
      var target = abs(p.path);
      if (!mounted || !cur.path || abs(cur.path) !== target) return;
      if (cur.dirty) return;                      // 本地有未保存修改时不覆盖
      var rec = findFile(target);
      if (!rec) return;
      var nextContent = rec.content == null ? '' : String(rec.content);
      if (nextContent === cur.content) return;
      cur.content = nextContent;
      if (els && els.ta) els.ta.value = nextContent;
      renderAll();
    };
    A.bus.on('file:open', onOpen);
    A.bus.on('file:save', onSave);
    offs.push(function () { A.bus.off('file:open', onOpen); A.bus.off('file:save', onSave); });

    if (A.store) {
      offs.push(A.store.subscribe('projectFiles', function () {
        if (!mounted || !els) return;
        renderSide();
        if (cur.path && !cur.dirty) onSave({ path: cur.path });
        renderStatus();
      }));
    }
  }
  var pendingOpen = '';

  function offAll() { for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (_) {} } offs.length = 0; }

  /* ============================================================ 生命周期 */
  function mount(host) {
    if (!host) return;
    mounted = true;
    if (!els) build(host); else host.appendChild(els.root);
    renderSide();
    renderAll();
    if (pendingOpen) { openFile(pendingOpen, { silent: true }); pendingOpen = ''; }
    later(autoGrowWidth, 60);
    if (A.rightPanel && A.rightPanel.setStatus) {
      A.rightPanel.setStatus(cur.path ? 'ok' : 'off', cur.path ? ('IDE：' + baseName(cur.path)) : 'IDE：未打开文件');
    }
  }
  function unmount() {
    mounted = false;
    clearTimers();
    if (A.ui && A.ui.closeAll) { try { A.ui.closeAll(); } catch (_) {} }
    if (els && els.root && els.root.parentNode) els.root.parentNode.removeChild(els.root);
  }

  A.ready(function () {
    A.register('right-panel', 'ide', {
      title: 'IDE', icon: 'code', order: 50,
      mount: mount, unmount: unmount
    });
    bind();
  });

  /* 对外暴露高亮能力（产出物 / 项目文件预览共用） */
  A.ui = A.ui || {};
  if (typeof A.ui.highlight !== 'function') {
    A.ui.highlight = function (text, lang) { return highlightLines(text, lang).join('\n'); };
  }
  if (typeof A.ui.highlightLines !== 'function') {
    A.ui.highlightLines = function (text, lang) { return highlightLines(text, lang); };
  }
  if (typeof A.ui.langOfPath !== 'function') {
    A.ui.langOfPath = langOfPath;
  }

  A.ide = {
    open: openFile,
    save: saveFile,
    run: runFile,
    current: function () { return { path: cur.path, dirty: cur.dirty, length: String(cur.content).length }; },
    highlight: function (text, lang) { return highlightLines(text, lang).join('\n'); },
    highlightLines: highlightLines,
    langOfPath: langOfPath,
    _offAll: offAll
  };
})();
