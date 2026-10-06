/* ============================================================
   AYCHO module: utils + icons  |  owner: A(main)  |  contract: v1
   DOM 助手 / 格式化 / 下载 / toast / 图标库（UI 图标 + 文件类型图标）
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = {};

  /* ---------------- DOM ---------------- */
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** el('div', {class:'x', onclick:fn, dataset:{k:'v'}}, child1, child2) */
  U.el = function (tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
        else node.setAttribute(k, v);
      });
    }
    children.flat(4).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  };

  U.svg = function (str, cls) {
    const wrap = document.createElement('span');
    wrap.className = cls || '';
    wrap.style.display = 'inline-flex';
    wrap.innerHTML = str;
    return wrap.firstElementChild || wrap;
  };

  U.uid = (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  U.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.debounce = function (fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms || 200); };
  };
  U.throttle = function (fn, ms) {
    let last = 0, timer = null;
    return function (...a) {
      const now = Date.now();
      if (now - last >= (ms || 100)) { last = now; fn.apply(this, a); }
      else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn.apply(this, a); }, ms - (now - last)); }
    };
  };

  /* ---------------- 格式化 ---------------- */
  U.fmtTime = function (ts) {
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400 * 1) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  U.fmtBytes = function (n) {
    if (!n && n !== 0) return '-';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
  };
  U.fmtClock = function (ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  U.copy = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      U.toast('已复制到剪贴板', 'ok');
      return true;
    } catch (e) { U.toast('复制失败，请手动选择', 'err'); return false; }
  };

  /** 触发浏览器下载 */
  U.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'download.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /** SVG / 文本 → dataURL（用于分享与预览） */
  U.toDataUrl = function (content, mime) {
    return 'data:' + (mime || 'text/plain;charset=utf-8') + ',' + encodeURIComponent(content);
  };

  /* ---------------- toast ---------------- */
  U.toast = function (text, type) {
    let host = document.getElementById('ax-toasts');
    if (!host) {
      host = U.el('div', { id: 'ax-toasts', class: 'ax-toasts', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    const dotColor = { ok: 'var(--ax-ok)', err: 'var(--ax-danger)', warn: 'var(--ax-warn)' }[type] || 'var(--ax-accent)';
    const item = U.el('div', { class: 'ax-toast' },
      U.el('span', { class: 'ax-toast__dot', style: { background: dotColor } }),
      U.el('span', { class: 'ax-toast__text', text })
    );
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add('is-in'));
    setTimeout(() => {
      item.classList.remove('is-in');
      setTimeout(() => item.remove(), 220);
    }, type === 'err' ? 4200 : 2600);
  };
  A.util = U;

  /* ============================================================
     图标库：统一 24x24 stroke 图标（currentColor）
     ============================================================ */
  const S = (d, extra) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}${extra || ''}</svg>`;
  const PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M5 12h13M12 5l7 7-7 7"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4M4 19h16"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
    expand: '<path d="M4 9V4h5M20 15v5h-5M15 4h5v5M4 15v5h5"/>',
    compress: '<path d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5"/>',
    terminal: '<path d="M5 8l4 4-4 4M12 16h7"/><rect x="2" y="4" width="20" height="16" rx="3"/>',
    edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10v4z"/><path d="M13.5 6.5l4 4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9S9.6 5.6 12 3z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.5-4.5 3.5 3.5 3-3 4 4"/>',
    list: '<path d="M8.5 6h11M8.5 12h11M8.5 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    gemini: '<path d="M10 3.2l1.7 4.6 4.6 1.7-4.6 1.7L10 15.8l-1.7-4.6L3.7 9.5l4.6-1.7z"/><path d="M18 14.2l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>',
    wave: '<path d="M2.5 12h2l2-5.5 3 11 3-7.5 2 4h7"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    files: '<path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4h4"/>',
    browser: '<circle cx="12" cy="12" r="9"/><path d="M3 9h18M3 15h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 4l3 3M15 6l2 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
    brain: '<path d="M9.5 4.5A3 3 0 0 0 6.6 7 2.8 2.8 0 0 0 4 9.8c0 1 .5 1.9 1.3 2.4A3 3 0 0 0 4.6 14c0 1.6 1.3 2.9 2.9 2.9h.5V19a2 2 0 1 0 4 0v-2h.5A2.9 2.9 0 0 0 15.4 14a3 3 0 0 0-.7-1.8A3 3 0 0 0 16 9.8 2.8 2.8 0 0 0 13.4 7a3 3 0 0 0-2.9-2.5z"/>',
    plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v4"/>',
    memory: '<path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
    sparkles: '<path d="M12 4l1.4 3.9L17 9l-3.6 1.1L12 14l-1.4-3.9L7 9l3.6-1.1z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    plug2: '<path d="M6 6l4 4M14 14l4 4M9 3v4M3 9h4M15 21v-4M21 15h-4M8 16l8-8"/>',
    collapse: '<path d="M4 6h16M4 12h10M4 18h16"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    settings2: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    minus: '<path d="M5 12h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    clipboard: '<rect x="8" y="3" width="8" height="4" rx="1.5"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>',
    robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="12" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="15" cy="8.5" r="1.2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.4 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7L12.6 17"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-4 4 3 3-2 4 4"/>',
    coins: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'
  };
  const icons = {
    get(name, size) {
      const p = PATHS[name] || PATHS.box;
      const s = Number(size) || 18;
      return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    },
    /** 返回真实 <svg> 元素（供 appendChild 使用）；要 HTML 字符串请用 get() */
    node(name, size, cls) {
      const wrap = document.createElement('span');
      wrap.innerHTML = icons.get(name, size);
      const el = wrap.firstElementChild || wrap;
      if (cls) el.setAttribute('class', cls);
      return el;
    },
    /** 同 node()，兼容旧调用签名 svg(name, size, cls) */
    svg(name, size, cls) { return icons.node(name, size, cls); },
    names() { return Object.keys(PATHS); },

    /* ---------- 文件类型图标（按扩展名，专属配色） ---------- */
    ext(name) {
      const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
      return m ? m[1] : '';
    },
    group(ext) {
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'].includes(ext)) return 'image';
      if (['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(ext)) return 'video';
      if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
      if (['html', 'htm', 'css'].includes(ext)) return 'web';
      if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'lua', 'sql', 'swift', 'dart'].includes(ext)) return 'code';
      if (['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml', 'csv', 'lock'].includes(ext)) return 'data';
      if (['md', 'mdx', 'txt', 'rst', 'log'].includes(ext)) return 'doc';
      if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'].includes(ext)) return 'archive';
      if (['pdf'].includes(ext)) return 'pdf';
      if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'word';
      if (['xls', 'xlsx', 'ods'].includes(ext)) return 'sheet';
      if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slide';
      if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
      if (['apk', 'exe', 'dmg', 'deb', 'rpm', 'appimage', 'msi'].includes(ext)) return 'binary';
      return 'file';
    },
    /** 返回 {svg, color} —— 用于文件列表左侧小图标 */
    file(name) {
      const ext = icons.ext(name);
      const g = icons.group(ext);
      const colors = {
        image: '#22d3ee', video: '#f472b6', audio: '#a78bfa', web: '#fb923c',
        code: '#7c9cff', data: '#fbbf24', doc: '#94a3b8', archive: '#f0abfc',
        pdf: '#f87171', word: '#60a5fa', sheet: '#34d399', slide: '#fb923c',
        font: '#c4b5fd', binary: '#9ca3af', file: '#8b93a7'
      };
      const glyphs = {
        image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-4 4 3 3-2 4 4"/>',
        video: '<rect x="2.5" y="5" width="14" height="14" rx="3"/><path d="M16.5 10l5-3v10l-5-3z"/>',
        audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
        web: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M7 6.5h.01M9.5 6.5h.01"/>',
        code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
        data: '<path d="M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2z"/><path d="M4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6"/>',
        doc: '<path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4h4M9 13h6M9 16h4"/>',
        archive: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M12 4v5M12 12v1M12 16v1"/>',
        pdf: '<path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4h4M9 14h1.5a1.5 1.5 0 0 0 0-3H9v6M14 11v6"/>',
        word: '<path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4h4M9 12l1.3 5L12 13l1.7 4L15 12"/>',
        sheet: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M9.5 9.5V20M15 9.5V20"/>',
        slide: '<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M12 16v4M9 20h6"/>',
        font: '<path d="M6 18l6-13 6 13M8.5 13.5h7"/>',
        binary: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M8 9v6M16 9v6M8 12h8"/>',
        file: '<path d="M8 3h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v4h4"/>'
      };
      return { svg: S(glyphs[g] || glyphs.file), color: colors[g] || colors.file, group: g, ext };
    },
    fileNode(name, size) {
      const info = icons.file(name);
      const node = U.svg(info.svg, 'ax-fileico');
      if (size) { node.setAttribute('width', size); node.setAttribute('height', size); }
      node.style.color = info.color;
      node.dataset.group = info.group;
      return node;
    }
  };
  A.icons = icons;
})();
