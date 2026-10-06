/* ============================================================
   AYCHO module: shell  |  owner: A(main)  |  contract: v1
   左侧边栏 / 顶栏 / 浮层菜单（AYCHO.menu，供 B/C 复用）/ 安装菜单
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util, el = U.el, icons = A.icons, store = A.store, bus = A.bus;

  /* ============================================================
     通用浮层菜单 —— 所有模块共用的弹出层实现
     AYCHO.menu.open({ anchor, content, align:'left'|'right', width, onClose })
     ============================================================ */
  const menu = (() => {
    let current = null;

    function close() {
      if (!current) return;
      const { node, onClose, anchor } = current;
      current = null;
      if (anchor) anchor.classList.remove('is-open');
      node.classList.add('is-closing');
      setTimeout(() => node.remove(), 140);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onWinScroll, true);
      if (onClose) onClose();
    }
    function onDocDown(e) { if (current && !current.node.contains(e.target) && !(current.anchor && current.anchor.contains(e.target))) close(); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    /* 滚动关闭：仅当滚动发生在浮层/锚点之外时才关闭。
       此前是无条件 close，导致浮层内部列表（下载 CLI 指令、模型列表、用户设置、
       添加文件/照片）一上滑整块浮窗就消失。 */
    function onWinScroll(e) {
      if (!current) return;
      const t = e.target;
      if (!t || t === document || t === window || t === document.documentElement || t === document.body) { close(); return; }
      if (t.nodeType === 1 && (current.node.contains(t) || (current.anchor && current.anchor.contains(t)))) return;
      close();
    }

    function open(opts) {
      close();
      const anchor = opts.anchor;
      const node = el('div', { class: 'ax-menu ' + (opts.className || ''), role: 'menu' }, opts.content);
      if (opts.width) node.style.minWidth = opts.width + 'px';
      node.style.visibility = 'hidden';
      document.body.appendChild(node);
      if (anchor && opts.toggle) anchor.classList.add('is-open');

      const rect = anchor ? anchor.getBoundingClientRect() : { left: 20, right: 20, top: 60, bottom: 60 };
      const mw = node.offsetWidth, mh = node.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = opts.align === 'right' ? rect.right - mw : rect.left;
      left = U.clamp(left, 10, Math.max(10, vw - mw - 10));
      let top = rect.bottom + 8;
      let originV = 'top';
      if (top + mh > vh - 10) {
        const above = rect.top - mh - 8;
        top = above > 10 ? above : Math.max(10, vh - mh - 10);
        originV = 'bottom';
      }
      node.style.left = Math.round(left) + 'px';
      node.style.top = Math.round(top) + 'px';
      node.style.setProperty('--ax-origin', `${originV} ${opts.align === 'right' ? 'right' : 'left'}`);
      node.style.visibility = '';
      current = { node, onClose: opts.onClose, anchor };

      setTimeout(() => {
        document.addEventListener('pointerdown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', onWinScroll, true);
      }, 0);
      return { close, node };
    }
    return { open, close, get isOpen() { return !!current; } };
  })();
  A.menu = menu;

  /* 菜单条目构造器（B/C 也可用） */
  function menuItem(opts) {
    const btn = el('button', { class: 'ax-menu__item' + (opts.on ? ' is-on' : ''), type: 'button', role: 'menuitem' },
      opts.icon ? el('span', { class: 'ax-pick__ico', html: icons.get(opts.icon, 16) }) : null,
      el('span', { class: 'ax-pick__txt' }, el('b', { text: opts.label }), opts.desc ? el('small', { text: opts.desc }) : null),
      opts.meta ? el('span', { class: 'ax-menu__meta', text: opts.meta }) : null
    );
    if (opts.on) btn.dataset.on = '1';
    if (opts.onClick) btn.addEventListener('click', (e) => { const r = opts.onClick(e); if (r !== false && !opts.keepOpen) menu.close(); });
    return btn;
  }
  A.menuItem = menuItem;

  /* ============================================================
     渲染：左侧边栏
     ============================================================ */
  let leftHost, listNode, userNode, collapsed = false;

  function renderLeft() {
    if (!leftHost) return;
    leftHost.innerHTML = '';
    collapsed = !store.get('ui.leftOpen');
    leftHost.classList.toggle('is-collapsed', collapsed);
    /* 主骨架栅格列宽由 #ax-app 的 class 控制，不同步就会出现「只藏文字不收宽度」 */
    const appNode = document.getElementById('ax-app');
    if (appNode) appNode.classList.toggle('is-left-collapsed', collapsed && window.innerWidth > 900);

    /* head：品牌 + 栏内折叠按钮（< 收起 / > 展开，图标始终留在栏内，不溢出到内容区） */
    const headToggle = el('button', { class: 'ax-leftbar__toggle', type: 'button', title: collapsed ? '展开侧栏' : '收起侧栏', 'aria-label': collapsed ? '展开侧栏' : '收起侧栏' },
      el('span', { html: icons.get(collapsed ? 'chevronRight' : 'chevronLeft', 15) })
    );
    headToggle.addEventListener('click', () => { bus.emit('ui:left-toggle'); if (window.innerWidth > 900) { renderLeft(); renderTop(); } });
    const head = el('div', { class: 'ax-leftbar__head' },
      el('button', { class: 'ax-brand', type: 'button', title: 'AYCHO', onclick: () => { A.chat && A.chat.goHome(); } },
        el('span', { class: 'ax-brand__logo' }, el('span', { text: 'A' })),
        el('span', { class: 'ax-brand__text' },
          el('span', { class: 'ax-brand__name', text: 'AYCHO' }),
          el('span', { class: 'ax-brand__sub', text: 'agent workspace' })
        )
      ),
      headToggle
    );
    leftHost.appendChild(head);

    /* 新对话 */
    const newBtn = el('button', { class: 'ax-newchat', type: 'button', title: '新建对话' },
      el('span', { html: icons.get('plus', 17) }),
      el('span', { class: 'ax-span', style: { textAlign: 'left' }, text: '新建对话' }),
      el('span', { class: 'ax-hint', text: '⌘K' })
    );
    newBtn.addEventListener('click', () => { A.chat && A.chat.newConversation(); if (window.innerWidth <= 900) closeMobileLeft(); });
    leftHost.appendChild(newBtn);

    /* 列表 */
    listNode = el('div', { class: 'ax-leftbar__list ax-scroll' });
    leftHost.appendChild(listNode);
    renderList();

    /* foot：用户 */
    userNode = el('div', { class: 'ax-leftbar__foot' });
    leftHost.appendChild(userNode);
    renderUser();

  }

  function renderList() {
    if (!listNode) return;
    listNode.innerHTML = '';
    const convs = store.get('conversations') || [];
    const activeId = store.get('activeConversationId');

    if (!convs.length) {
      listNode.appendChild(el('div', { class: 'ax-empty', style: { padding: '26px 12px' } },
        el('span', { html: icons.get('sparkles', 22) }),
        el('span', { text: '还没有对话' })
      ));
      return;
    }
    convs.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach((c) => {
      const isActive = c.id === activeId;
      const streaming = (store.get('messages.' + c.id) || []).some((m) => m.streaming);
      const item = el('div', { class: 'ax-conv' + (isActive ? ' is-active' : ''), role: 'button', tabindex: '0' },
        el('div', { class: 'ax-conv__body' },
          el('div', { class: 'ax-conv__title', text: c.title || '新对话' }),
          el('div', { class: 'ax-conv__meta' },
            el('span', { text: U.fmtTime(c.updatedAt || c.createdAt || Date.now()) }),
            c.agentIds && c.agentIds.length ? el('span', { text: '· ' + c.agentIds.length + ' 个 Agent' }) : null
          )
        ),
        el('span', { class: 'ax-conv__dot', style: { display: streaming ? '' : 'none' } }),
        el('button', { class: 'ax-conv__cog', type: 'button', title: '对话设置', html: icons.get('settings', 15) })
      );

      item.addEventListener('click', (e) => {
        if (e.target.closest('.ax-conv__cog')) return;
        store.set('activeConversationId', c.id);
        bus.emit('chat:select', { id: c.id });
        if (window.innerWidth <= 900) closeMobileLeft();
      });
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') item.click(); });
      item.querySelector('.ax-conv__cog').addEventListener('click', (e) => {
        e.stopPropagation();
        openConvMenu(e.currentTarget, item, c);
      });
      listNode.appendChild(item);
    });
  }

  function openConvMenu(anchor, itemNode, conv) {
    itemNode.classList.add('is-menu-open');
    menu.open({
      anchor, align: 'right', width: 226,
      onClose: () => itemNode.classList.remove('is-menu-open'),
      content: [
        el('div', { class: 'ax-menu__label', text: '对话设置' }),
        menuItem({
          icon: 'refresh', label: '重命名', desc: '修改对话标题',
          onClick: () => {
            const v = window.prompt('对话标题', conv.title || '');
            if (v == null) return;
            const t = v.trim();
            if (!t) return;
            store.set('conversations', store.get('conversations').map((x) => (x.id === conv.id ? { ...x, title: t, updatedAt: Date.now() } : x)));
            bus.emit('chat:title', { id: conv.id, title: t });
            renderList();
          }
        }),
        menuItem({
          icon: 'folder', label: '查看文件夹', desc: '打开该对话的工作目录',
          onClick: () => {
            bus.emit('chat:open-folder', { id: conv.id, title: conv.title });
            U.toast('打开对话文件夹：' + (conv.title || '新对话'), 'ok');
          }
        }),
        menuItem({
          icon: 'share', label: '分享对话', desc: '生成只读分享链接',
          onClick: () => { bus.emit('artifact:share', { convId: conv.id }); }
        }),
        el('div', { class: 'ax-menu__sep' }),
        (() => {
          let armed = false;
          const b = menuItem({
            icon: 'trash', label: '删除对话', desc: '点击两次确认', keepOpen: true,
            onClick: () => {
              if (!armed) {
                armed = true;
                b.classList.add('is-danger');
                b.style.color = 'var(--ax-danger,#f87171)';
                b.querySelector('b').textContent = '再点一次确认删除';
                b.querySelector('small').textContent = '删除后不可恢复';
                setTimeout(() => { if (armed && b.isConnected) { armed = false; b.style.color = ''; b.querySelector('b').textContent = '删除对话'; b.querySelector('small').textContent = '点击两次确认'; } }, 3000);
                return false;
              }
              removeConversation(conv.id);
            }
          });
          return b;
        })()
      ]
    });
  }

  function removeConversation(id) {
    const convs = (store.get('conversations') || []).filter((c) => c.id !== id);
    const msgs = store.get('messages') || {};
    delete msgs[id];
    store.set('conversations', convs);
    store.set('messages', msgs);
    if (store.get('activeConversationId') === id) {
      store.set('activeConversationId', convs[0] ? convs[0].id : null);
      if (convs[0]) bus.emit('chat:select', { id: convs[0].id });
      else A.chat && A.chat.goHome();
    }
    bus.emit('chat:deleted', { id });
    menu.close();
    renderList();
    U.toast('对话已删除', 'ok');
  }

  function renderUser() {
    if (!userNode) return;
    userNode.innerHTML = '';
    const user = store.get('user') || {};
    const chip = el('button', { class: 'ax-userchip', type: 'button' },
      el('span', { class: 'ax-avatar' }, user.avatar ? el('img', { src: user.avatar, alt: '' }) : el('span', { text: (user.name || '老板').slice(0, 1).toUpperCase() })),
      el('span', { class: 'ax-userchip__text' },
        el('span', { class: 'ax-userchip__name', text: user.name || '老板' }),
        el('span', { class: 'ax-userchip__mail', text: user.email || '未登录' })
      ),
      el('span', { class: 'ax-iconbtn', style: { width: '26px', height: '26px', marginLeft: 'auto' }, html: icons.get('chevronDown', 14) })
    );
    chip.addEventListener('click', () => {
      menu.open({
        anchor: chip, align: 'left', width: 244, toggle: true,
        content: [
          el('div', { class: 'ax-menu__label', text: '账号' }),
          menuItem({ icon: 'user', label: user.name || '老板', desc: user.email || '未登录', onClick: () => bus.emit('settings:open', { tab: 'user' }) }),
          el('div', { class: 'ax-menu__sep' }),
          menuItem({ icon: 'settings', label: '设置中心', onClick: () => bus.emit('settings:open', { tab: 'user' }) }),
          menuItem({ icon: 'key', label: 'API 与模型', onClick: () => bus.emit('settings:open', { tab: 'api' }) }),
          menuItem({ icon: 'sparkles', label: '技能 Skills', onClick: () => bus.emit('settings:open', { tab: 'skills' }) }),
          menuItem({ icon: 'plug', label: 'MCP 服务', onClick: () => bus.emit('settings:open', { tab: 'mcp' }) }),
          el('div', { class: 'ax-menu__sep' }),
          menuItem({ icon: 'external', label: '退出登录', onClick: () => A.auth.logout() })
        ]
      });
    });
    userNode.appendChild(chip);
  }

  /* 移动端左栏：改为「点击左栏之外的任何位置」关闭，不再铺遮罩 */
  function openMobileLeft() {
    const app = document.getElementById('ax-app');
    if (!app) return;
    app.classList.add('is-left-open-mobile');
    scrim(false);
    setTimeout(() => document.addEventListener('pointerdown', onLeftOutside, true), 0);
  }
  function onLeftOutside(e) {
    const app = document.getElementById('ax-app');
    if (!app || !app.classList.contains('is-left-open-mobile')) { offLeftOutside(); return; }
    if (e.target && e.target.closest && e.target.closest('.ax-leftbar')) return;
    if (e.target && e.target.closest && e.target.closest('.ax-topbar')) return;
    closeMobileLeft();
  }
  function offLeftOutside() { document.removeEventListener('pointerdown', onLeftOutside, true); }

  function closeMobileLeft() {
    const app = document.getElementById('ax-app');
    if (!app) return;
    app.classList.remove('is-left-open-mobile');
    offLeftOutside();
    scrim(false);
  }

  /* ============================================================
     渲染：顶栏 + 安装菜单
     ============================================================ */
  let topHost;
  function renderTop() {
    if (!topHost) return;
    topHost.innerHTML = '';
    const view = store.get('ui.view');
    const activeId = store.get('activeConversationId');
    const conv = (store.get('conversations') || []).find((c) => c.id === activeId);

    topHost.appendChild(el('button', {
      class: 'ax-iconbtn', type: 'button', title: '侧栏', html: icons.get(window.innerWidth <= 900 && document.getElementById('ax-app') && !document.getElementById('ax-app').classList.contains('is-left-open-mobile') ? 'chevronRight' : 'collapse', 17),
      onclick: () => {
        if (window.innerWidth <= 900) { openMobileLeft(); }
        else {
          const next = !store.get('ui.leftOpen');
          store.set('ui.leftOpen', next); renderLeft(); renderTop();
          /* 展开侧栏即进入「开始」启动页；仅当右栏未打开时唤醒，避免打断进行中的工作 */
          if (next && !store.get('ui.rightOpen')) bus.emit('panel:open', { tab: window.AYCHO_ROUTE || 'home' });
        }
      }
    }));

    topHost.appendChild(el('div', { class: 'ax-topbar__title' },
      el('span', { html: icons.get(view === 'settings' ? 'settings' : view === 'chat' ? 'sparkles' : 'robot', 16) }),
      el('span', { class: 'ax-truncate', text: view === 'settings' ? '设置中心' : (view === 'chat' ? (conv ? conv.title : '对话') : 'AYCHO 工作台') }),
      view === 'chat' && conv ? el('span', { class: 'ax-topbar__badge', text: '进行中' }) : null
    ));

    const actions = el('div', { class: 'ax-topbar__actions' });

    actions.appendChild(el('button', {
      class: 'ax-iconbtn', type: 'button', title: '设置', html: icons.get('settings', 17),
      onclick: () => bus.emit('settings:open', { tab: store.get('ui.settingsTab') || 'user' })
    }));

    const installBtn = el('button', { class: 'ax-iconbtn', type: 'button', title: '安装 AYCHO', html: icons.get('download', 17) });
    installBtn.addEventListener('click', () => openInstallMenu(installBtn));
    actions.appendChild(installBtn);

    const rightOn = store.get('ui.rightOpen');
    actions.appendChild(el('button', {
      class: 'ax-iconbtn' + (rightOn ? ' is-active' : ''), type: 'button', title: '侧面板', html: icons.get('terminal', 17),
      onclick: () => bus.emit(rightOn ? 'panel:close' : 'panel:open', { tab: store.get('ui.rightTab') || 'terminal' })
    }));

    topHost.appendChild(actions);
  }

  /* ---------------- 安装菜单 ---------------- */
  const RELEASES = 'https://github.com/jimibiuev/aycho/releases';
  const NPM_AGNES_AYCHO = 'npm i -g agnes-aycho';
  const NPM_AGNES_CODER = 'npm i -g agnes-coder';

  function codeLine(text, label) {
    const n = el('button', { class: 'ax-codebtn', type: 'button', title: '点击复制', text });
    n.addEventListener('click', () => U.copy(text));
    return n;
  }

  function osName() {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return '未知系统';
  }

  function openInstallMenu(anchor) {
    const os = osName();
    const isMobile = window.innerWidth <= 900 || /Android|iPhone|iPad/i.test(navigator.userAgent);

    const body = el('div', { class: 'ax-install__scroll' },
      el('div', { class: 'ax-install__hero' },
        el('span', { class: 'ax-brand__logo' }, el('span', { text: 'A' })),
        el('div', null,
          el('div', { class: 'ax-install__title', text: '安装 AYCHO' }),
          el('div', { class: 'ax-install__desc', text: '检测到 ' + os + ' · 选择适合你的安装方式' })
        )
      ),

      /* 1. 手机版安装 */
      el('div', { class: 'ax-install__sect' },
        el('h4', { text: '手机版安装' }),
        el('p', { text: '下载 Android 安装包（APK），在手机上获得完整 Agent 能力（Shizuku 免 root 自动化）。' }),
        (() => {
          const b = el('button', { class: 'ax-install__item ax-install__item--primary', type: 'button' },
            el('span', { class: 'ax-pick__ico', html: icons.get('phone', 16) }),
            el('span', { class: 'ax-pick__txt' }, el('b', { text: '前往 GitHub Releases 下载' }), el('small', { text: RELEASES.replace('https://', '') })),
            el('span', { class: 'ax-menu__meta', html: icons.get('external', 14) })
          );
          b.addEventListener('click', () => { window.open(RELEASES, '_blank', 'noopener'); U.toast('已在新标签打开下载页', 'ok'); });
          return b;
        })(),
        isMobile ? el('p', { text: '当前为移动端浏览器：若已安装 AYCHO App，可在 App 内直接打开本工作台。' }) : null
      ),

      /* 2. agnes-aycho */
      el('div', { class: 'ax-install__sect' },
        el('h4', { text: '下载 agnes-aycho（本机 CLI）' }),
        el('p', { text: '在本机终端安装 AYCHO 命令行，可让 Agent 直接读写你电脑上的文件与终端。' }),
        codeLine(NPM_AGNES_AYCHO, 'npm'),
        el('p', { text: 'Windows / macOS / Linux 通用，需先安装 Node.js ≥ 18；也可用 npx ' + NPM_AGNES_AYCHO.replace('npm i -g ', '') })
      ),

      /* 3. agnes-coder */
      el('div', { class: 'ax-install__sect' },
        el('h4', { text: '下载 agnes-coder' }),
        el('p', { text: '增强编码 Agent（含代码索引与 IDE 联动）。' }),
        codeLine(NPM_AGNES_CODER, 'npm')
      ),

      /* 4. 授权 */
      el('div', { class: 'ax-install__sect' },
        el('h4', { text: '授权登录' }),
        el('p', { text: '把网页端生成的令牌写入本机，完成 CLI 与工作台绑定。' }),
        codeLine('agnes auth set <YOUR_TOKEN>', 'auth'),
        el('p', { text: '令牌在「设置 → 通用」中生成，仅本机保存。' })
      ),

      /* 5. 启动 */
      el('div', { class: 'ax-install__sect' },
        el('h4', { text: '启动 AYCHO 模式' }),
        el('p', { text: '以 AYCHO 工作台模式运行，自动连接当前会话。' }),
        codeLine('agnes --aycho', 'run')
      )
    );

    /* 允许 B/C 通过注册表追加安装项 */
    const extra = A.registry.list('install-item');
    if (extra.length) {
      const sect = el('div', { class: 'ax-install__sect' }, el('h4', { text: '其它' }));
      extra.forEach((it) => {
        if (typeof it.render === 'function') sect.appendChild(it.render());
        else if (it.node) sect.appendChild(it.node);
      });
      body.appendChild(sect);
    }

    menu.open({ anchor, align: 'right', width: 380, toggle: true, content: body });
  }

  /* ============================================================
     遮罩（移动端）
     ============================================================ */
  let scrimNode = null;
  function scrim(on, onClick) {
    /* 移动端不使用全屏遮罩：遮罩挂在 body 上且 z-index 高于 .ax-app 的层叠上下文，
       会把包括已打开的左侧栏在内的整个界面压暗，并吞掉侧栏内所有点击
       —— 表现为「全屏变暗 + 按钮按不动 + 一按就退出左边」。 */
    if (window.innerWidth <= 900) { if (scrimNode) { scrimNode.remove(); scrimNode = null; } return; }
    if (on) {
      if (scrimNode) return;
      scrimNode = el('div', { class: 'ax-scrim' });
      scrimNode.addEventListener('click', () => { onClick && onClick(); });
      document.body.appendChild(scrimNode);
    } else if (scrimNode) { scrimNode.remove(); scrimNode = null; }
  }

  /* ============================================================
     对外 API
     ============================================================ */
  let didMount = false;   // 幂等：boot 与自启动可能各调一次
  A.shell = {
    mount() {
      if (didMount) return;
      didMount = true;
      leftHost = document.getElementById('ax-leftbar');
      topHost = document.getElementById('ax-topbar');
      renderLeft(); renderTop();
      bus.on('state:change', (e) => {
        const p = e && e.path;
        if (p === '*' || p === 'conversations' || p === 'activeConversationId' || p === 'ui.view' || p === 'ui.leftOpen') { renderList(); renderTop(); }
        if (p === '*' || p === 'user') renderUser();
      });
      bus.on('chat:refresh-list', renderList);
      bus.on('ui:left-toggle', () => {
        if (window.innerWidth <= 900) { document.getElementById('ax-app').classList.toggle('is-left-open-mobile'); }
        else { store.set('ui.leftOpen', !store.get('ui.leftOpen')); renderLeft(); renderTop(); }
      });
      bus.on('toast', (p) => U.toast(p && p.text, p && p.type));
      window.addEventListener('resize', U.debounce(() => { if (window.innerWidth > 900) { scrim(false); document.getElementById('ax-app').classList.remove('is-left-open-mobile'); } }, 200));
    },
    render: () => { renderLeft(); renderTop(); },
    renderList,
    closeMobileLeft,
    scrim
  };
})();
