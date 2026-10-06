/* ============================================================
   AYCHO module: compat  |  owner: A(main)  |  contract: v1
   三方合并兼容层：把 A 的 utils/store 能力补齐到 B/C 期望的命名空间，
   只做「新增别名与扩展」，不覆盖任何既有实现，保证 A 自身行为不变。
   依赖：js/utils.js、js/store.js 先于本文件加载。
   ============================================================ */
(function () {
  var A = (window.AYCHO = window.AYCHO || {});
  var U = A.util || {};

  /* ---------------- 1. toast 别名（B/C 统一调用 AYCHO.toast） ---------------- */
  if (typeof A.toast !== 'function' && typeof U.toast === 'function') {
    A.toast = function (text, type) { return U.toast(text, type); };
  }

  /* ---------------- 2. 运行时配置（设置中心只读探测后端状态） ---------------- */
  if (!A.config) {
    A.config = {
      apiBase: '',                      // 留空表示尚未接入网关；接入后端时填入基址
      terminal: {                       // 终端 xterm 资源（终端为 CDN 白名单例外；运行时按序降级）
        js: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js',
        css: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css',
        jsAlt: 'https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js',
        cssAlt: 'https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css'
      }
    };
  }

  /* ---------------- 3. 品牌素材清单（CSS 负责渲染，此处仅登记状态供 UI 探测） ---------------- */
  if (!A.brand) {
    A.brand = {
      name: 'aycho',
      version: 'web-1',
      assets: {
        launcherIcon: { src: './assets/ic_launcher_foreground.png', use: 'favicon / 顶栏图标 / 设置中心头部' },
        splashWordmark: { src: './assets/splash_wordmark.png', use: '开屏字标 / 顶栏字标' },
        splashIcon: { src: './assets/splash_icon.png', use: '开屏中心图形 / 分享浮层头部' }
      },
      assetsAllOk: true,
      ready: true
    };
  }

  /* ---------------- 4. 密码强度（C 的设置中心使用；A 的登录页内部实现不变） ---------------- */
  if (typeof A.handlePasswordStrength !== 'function') {
    A.handlePasswordStrength = function (pw) {
      pw = String(pw == null ? '' : pw);
      var checks = {
        length: pw.length >= 8,
        lower: /[a-z]/.test(pw),
        upper: /[A-Z]/.test(pw),
        digit: /[0-9]/.test(pw),
        symbol: /[^A-Za-z0-9]/.test(pw)
      };
      var score = 0;
      if (checks.length) score++;
      if (checks.lower && checks.upper) score++;
      if (checks.digit) score++;
      if (checks.length && checks.digit && (checks.upper || checks.symbol)) score++;
      score = Math.min(4, score);
      return { score: score, checks: checks, label: ['很弱', '较弱', '一般', '较强', '很强'][score] };
    };
  }

  /* ---------------- 5. 图标 API 扩展（B 的 rb-* 优先调用 icons.svg / icons.color） ---------------- */
  var icons = A.icons;
  if (icons && typeof icons.get === 'function') {
    /* icons.svg(name, size, cls) → 真实 SVG 元素（与 icons.node 同构，额外支持 class 透传） */
    if (typeof icons.svg !== 'function') {
      icons.svg = function (name, size, cls) {
        var proto = document.createElement('div');
        proto.innerHTML = icons.get(name, size || 16);
        var node = proto.firstElementChild;
        if (!node) {
          node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          node.setAttribute('viewBox', '0 0 24 24');
        }
        node.setAttribute('class', [cls || '', 'ax-ico', 'ax-i'].filter(Boolean).join(' '));
        node.setAttribute('width', String(size || 16));
        node.setAttribute('height', String(size || 16));
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('focusable', 'false');
        return node;
      };
    }
    /* icons.html(name, size) → SVG 字符串 */
    if (typeof icons.html !== 'function') {
      icons.html = function (name, size) { return icons.get(name, size); };
    }
    /* icons.color(nameOrGroup) → 该类型图标的专属色（接受文件名 / 扩展名 / 分组名） */
    if (typeof icons.color !== 'function') {
      icons.color = function (name) {
        var n = String(name == null ? '' : name);
        if (n === 'folder' || n === 'folder-open' || n === 'dir') return 'var(--ax-accent, #7c9cff)';
        if (typeof icons.file === 'function') return icons.file(n).color;
        return 'var(--ax-text-3, #8b93a7)';
      };
    }
    /* icons.folderNode(size) → 目录图标 DOM */
    if (typeof icons.folderNode !== 'function') {
      icons.folderNode = function (size) {
        var node = typeof icons.node === 'function' ? icons.node('folder', size || 16)
                                                   : icons.svg('folder', size || 16);
        node.classList.add('ax-fileico');
        node.style.color = 'var(--ax-accent, #7c9cff)';
        return node;
      };
    }
    /* icons.groups / paths：兼容登记（B 版工具函数按分组取图） */
    if (!icons.groups) {
      icons.groups = ['image', 'video', 'audio', 'web', 'code', 'data', 'doc', 'archive', 'pdf', 'word', 'sheet', 'slide', 'font', 'binary', 'file'];
    }
  }

  /* ---------------- 6. util 别名扩展 ---------------- */
  if (typeof U.escapeAttr !== 'function') {
    U.escapeAttr = function (s) { return U.escapeHtml ? U.escapeHtml(s).replace(/"/g, '&quot;') : String(s == null ? '' : s); };
  }
  if (typeof U.copyFallback !== 'function') {
    U.copyFallback = function (text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) { return false; }
    };
  }

  /* ---------------- 7. 模块就绪自检（记录到 registry，便于联调与回归） ---------------- */
  A.ready(function () {
    var kinds = ['right-panel', 'settings-panel', 'artifact-viewer', 'install-item', 'command'];
    var summary = {};
    kinds.forEach(function (k) {
      summary[k] = A.registry && A.registry.list ? A.registry.list(k).length : 0;
    });
    A.__modules = summary;
    A.bus.emit('compat:ready', summary);
  });
})();
