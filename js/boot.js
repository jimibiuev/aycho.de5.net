/* ============================================================
   AYCHO module: boot  |  owner: A(main)  |  contract: v1
   启动编排：开屏动画 → 状态恢复 → 挂载 A 模块 → 登录闸门
             → 右栏 / 设置中心桥接（B/C 缺席时自动兜底）
             → 全局事件接线 → 快捷键
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util, el = U.el, icons = A.icons, store = A.store, bus = A.bus;

  const mounted = { shell: false, chat: false };
  let fbRight = false, fbSettings = false;
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const appNode = () => document.getElementById('ax-app');
  const settingsHost = () => document.getElementById('ax-settings-host');

  /* ============================================================
     1. 开屏动画（每次冷启动播放一次，可跳过）
     ============================================================ */
  function playBoot() {
    const node = document.getElementById('ax-boot');
    if (!node) return;
    const hold = reduceMotion() ? 380 : 1800;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (reduceMotion()) { node.remove(); return; }
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 460);
    };
    const skip = node.querySelector('.ax-boot__skip');
    if (skip) skip.addEventListener('click', finish);
    node.addEventListener('click', (e) => { if (e.target === node) finish(); });
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { finish(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    setTimeout(finish, hold);
  }

  /* ============================================================
     2. 内置工作区文件（接入后端后由后端注入）
     ============================================================ */
  function seedWorkspace() {
    /* 不再注入任何内置示例文件。
       历史版本在这里往 store 里塞了 README.md / index.html / css/tokens.css /
       js/boot.js / package.json 五个「虚构文件」：列表里看得见，点开却提示不存在。
       这里改为一次性清理这些残留。 */
    var SEED_IDS = { f_readme: 1, f_index: 1, f_tokens: 1, f_boot: 1, f_pkg: 1 };
    var list = store.get('projectFiles') || [];
    if (!list.length) return;
    var next = list.filter(function (f) { return !(f && SEED_IDS[f.id]); });
    if (next.length !== list.length) store.set('projectFiles', next);
  }

  /* ============================================================
     3. 挂载与登录闸门
     ============================================================ */
  function mountModules() {
    if (!mounted.shell && A.shell && A.shell.mount) { A.shell.mount(); mounted.shell = true; }
    if (!mounted.chat && A.chat && A.chat.mount) { A.chat.mount(); mounted.chat = true; }
  }
  function showApp() { const n = appNode(); if (n) n.hidden = false; }
  function hideApp() { const n = appNode(); if (n) n.hidden = true; }

  function gate() {
    if (/^#\/s\//.test(location.hash || '')) { A.auth.hide(); showApp(); return; }  // 只读分享页免登录
    if (store.get('authed')) { A.auth.hide(); showApp(); }
    else { hideApp(); A.auth.show(); }
  }

  /* ============================================================
     4. 右侧栏：A 只负责挂载点 + 开关；B 在场则由 B 渲染
     ============================================================ */
  const RB_TABS = [
    { id: 'terminal', title: '终端', icon: 'terminal', order: 10 },
    { id: 'artifacts', title: '产出物', icon: 'box', order: 20 },
    { id: 'files', title: '项目文件', icon: 'files', order: 30 },
    { id: 'browser', title: '浏览器', icon: 'browser', order: 40 },
    { id: 'ide', title: 'IDE', icon: 'code', order: 50 }
  ];

  function registerFallbackRight() {
    if (A.registry.list('right-panel').length) return;   // B 的 rb-*.js 已注册
    fbRight = true;
    RB_TABS.forEach((t) => A.register('right-panel', t.id, {
      title: t.title, icon: t.icon, order: t.order, fallback: true,
      mount: (c) => mountFbPanel(t.id, c)
    }));
  }

  function syncRight() {
    const app = appNode();
    if (!app) return;
    const open = !!store.get('ui.rightOpen');
    app.classList.toggle('is-right-open', open);
    if (open && fbRight) renderFallbackRight();
  }

  function renderFallbackRight() {
    const host = document.getElementById('ax-rightbar');
    if (!host) return;
    const tab = store.get('ui.rightTab') || 'terminal';
    const list = A.registry.list('right-panel').sort((a, b) => (a.order || 0) - (b.order || 0));
    host.innerHTML = '';
    const head = el('div', { class: 'ax-fb__head' },
      el('div', { class: 'ax-fb__tabs' }, list.map((t) => el('button', {
        class: 'ax-fb__tab' + (t.id === tab ? ' is-on' : ''), type: 'button', title: t.title, 'aria-label': t.title,
        onclick: () => { store.set('ui.rightTab', t.id); renderFallbackRight(); }
      }, el('span', { class: 'ax-ico', html: icons.get(t.icon || 'box', 16) })))),
      el('span', { class: 'ax-span' }),
      el('button', { class: 'ax-iconbtn', type: 'button', title: '关闭面板', onclick: () => bus.emit('panel:close') },
        el('span', { class: 'ax-ico', html: icons.get('x', 16) }))
    );
    const body = el('div', { class: 'ax-fb__body ax-scroll' });
    const def = A.registry.get('right-panel', tab);
    if (def && def.mount) def.mount(body);
    host.appendChild(el('div', { class: 'ax-fb ax-fb--right' }, head, body));
  }

  function fbNotice(c, icon, title, desc) {
    c.appendChild(el('div', { class: 'ax-empty' },
      el('span', { html: icons.get(icon, 26) }),
      el('span', { text: title }),
      el('span', { class: 'ax-hint', style: { maxWidth: '30ch' }, text: desc })
    ));
  }

  function mountFbPanel(tab, c) {
    if (tab === 'artifacts') {
      const arts = store.get('artifacts') || [];
      if (!arts.length) return fbNotice(c, 'box', '还没有产出物', '任务执行完成后，生成的文件会自动出现在这里。');
      const list = el('div', { class: 'ax-artlist' });
      arts.forEach((a) => list.appendChild(el('div', { class: 'ax-art' },
        icons.fileNode(a.name || a.path || 'file', 18),
        el('span', { class: 'ax-art__txt' },
          el('b', { class: 'ax-truncate', text: a.name || a.path }),
          el('small', { text: (a.kind || 'file') + ' · ' + U.fmtTime(a.createdAt || Date.now()) })),
        el('span', { class: 'ax-art__acts' },
          el('button', { class: 'ax-iconbtn', type: 'button', title: '下载', onclick: () => bus.emit('artifact:download', { id: a.id }) },
            el('span', { class: 'ax-ico', html: icons.get('download', 15) })),
          el('button', { class: 'ax-iconbtn', type: 'button', title: '分享', onclick: () => bus.emit('artifact:share', { id: a.id }) },
            el('span', { class: 'ax-ico', html: icons.get('share', 15) })))
      )));
      c.appendChild(el('div', { class: 'ax-fb__sect' },
        el('div', { class: 'ax-artifacts__t', text: '工作区产出（' + arts.length + '）' }), list));
      return;
    }
    if (tab === 'files') {
      const files = store.get('projectFiles') || [];
      if (!files.length) return fbNotice(c, 'files', '工作区为空', '把文件拖进对话，或让 Agent 在工作区里创建文件。');
      let current = null;
      const wrap = el('div', { class: 'ax-fb__sect' });
      const render = () => {
        wrap.innerHTML = '';
        if (current) {
          wrap.appendChild(el('div', { class: 'ax-fb__path' },
            el('button', { class: 'ax-minibtn', type: 'button', onclick: () => { current = null; render(); } },
              el('span', { class: 'ax-ico', html: icons.get('chevronLeft', 14) }), el('span', { text: '返回' })),
            el('span', { class: 'ax-truncate ax-hint', text: current.path })));
          wrap.appendChild(el('pre', { class: 'ax-sharepage__src', text: current.content || '（空文件）' }));
          return;
        }
        files.forEach((f) => wrap.appendChild(el('button', {
          class: 'ax-art', type: 'button', onclick: () => { current = f; render(); }
        },
          icons.fileNode(f.path, 18),
          el('span', { class: 'ax-art__txt' },
            el('b', { class: 'ax-truncate', text: f.path.split('/').pop() }),
            el('small', { text: f.path + ' · ' + U.fmtTime(f.updatedAt || Date.now()) }))
        )));
      };
      render();
      c.appendChild(wrap);
      return;
    }
    const meta = RB_TABS.find((t) => t.id === tab) || { title: tab };
    fbNotice(c, meta.icon || 'box', meta.title + '面板', '该面板由 B 份模块（rb-' + tab + '.js）提供，加载后自动接管本挂载点。');
  }

  /* ============================================================
     5. 设置中心：C 在场则由 C 渲染到 #ax-settings-host
     ============================================================ */
  const SET_TABS = [
    { id: 'user', title: '个人账号', icon: 'user', order: 10 },
    { id: 'api', title: 'API 与模型', icon: 'key', order: 20 },
    { id: 'skills', title: '技能 Skills', icon: 'sparkles', order: 30 },
    { id: 'mcp', title: 'MCP 服务', icon: 'plug', order: 40 },
    { id: 'memory', title: '记忆', icon: 'memory', order: 50 },
    { id: 'general', title: '通用', icon: 'sliders', order: 60 },
    { id: 'advanced', title: '高级', icon: 'settings', order: 70 }
  ];

  function registerFallbackSettings() {
    if (A.registry.list('settings-panel').length) return;   // C 的 st-*.js 已注册
    fbSettings = true;
    SET_TABS.forEach((t) => A.register('settings-panel', t.id, {
      title: t.title, icon: t.icon, order: t.order, fallback: true,
      mount: (c) => mountFbSettings(t.id, c)
    }));
  }

  function openSettings(tab) {
    // 优先由 C 模块（st-settings.js）统一接管「全屏设置子页」。
    // 关键修复：绝不在 C 在场时再做 ui.view 切换 / 兜底渲染，否则会二次写 #ax-settings-host
    // 并清空 C 的 layer，导致设置键点开后页面崩坏（历史遗留问题）。
    if (A.settings && typeof A.settings.open === 'function') {
      store.set('ui.settingsTab', tab || store.get('ui.settingsTab') || 'user');
      const app = appNode();
      if (app) app.classList.remove('is-left-open-mobile');
      // 清除历史遗留的 settings 视图标记，避免主舞台停留在空白/半渲染态
      if (store.get('ui.view') === 'settings') {
        store.set('ui.view', store.get('activeConversationId') ? 'chat' : 'home');
        if (A.chat && A.chat.renderStage) A.chat.renderStage();
        if (mounted.shell) A.shell.render();
      }
      A.settings.open(tab);
      return;
    }
    store.set('ui.settingsTab', tab || store.get('ui.settingsTab') || 'user');
    store.set('ui.view', 'settings');
    const app = appNode();
    if (app) app.classList.remove('is-left-open-mobile');
    bus.emit('settings:visibility', { open: true });
    if (fbSettings) renderFallbackSettings();
    if (mounted.shell) A.shell.render();
  }

  function closeSettings() {
    // C 在场时关闭完全由 C 负责；若这里再兜底清空宿主，同样会破坏 C 的容器状态。
    if (A.settings && typeof A.settings.close === 'function') {
      if (store.get('ui.view') === 'settings') {
        store.set('ui.view', store.get('activeConversationId') ? 'chat' : 'home');
        if (mounted.shell) A.shell.render();
      }
      A.settings.close();
      return;
    }
    bus.emit('settings:visibility', { open: false });
    if (fbSettings) { const h = settingsHost(); if (h) h.innerHTML = ''; }   // 兜底渲染由 A 自行清理
    store.set('ui.view', store.get('activeConversationId') ? 'chat' : 'home');
    if (A.chat && A.chat.renderStage) A.chat.renderStage();
    if (mounted.shell) A.shell.render();
  }

  function renderFallbackSettings() {
    const host = settingsHost();
    if (!host) return;
    const tab = store.get('ui.settingsTab') || 'user';
    const list = A.registry.list('settings-panel').sort((a, b) => (a.order || 0) - (b.order || 0));
    host.innerHTML = '';
    const rail = el('div', { class: 'ax-fb__rail' },
      el('div', { class: 'ax-fb__railhead' },
        el('span', { class: 'ax-brand__logo', style: { width: '28px', height: '28px' } }, el('span', { style: { fontSize: '14px' }, text: 'A' })),
        el('span', { class: 'ax-brand__name', text: '设置中心' })),
      list.map((t) => el('button', {
        class: 'ax-fb__nav' + (t.id === tab ? ' is-on' : ''), type: 'button',
        onclick: () => { store.set('ui.settingsTab', t.id); renderFallbackSettings(); }
      }, el('span', { class: 'ax-ico', html: icons.get(t.icon || 'box', 16) }), el('span', { text: t.title }))),
      el('span', { class: 'ax-span' }),
      el('button', { class: 'ax-fb__nav', type: 'button', onclick: () => bus.emit('settings:close') },
        el('span', { class: 'ax-ico', html: icons.get('chevronLeft', 16) }), el('span', { text: '返回工作台' }))
    );
    const body = el('div', { class: 'ax-fb__sheetbody ax-scroll' });
    const def = A.registry.get('settings-panel', tab);
    if (def && def.mount) def.mount(body);
    host.appendChild(el('div', { class: 'ax-fb ax-fb--sheet' }, rail, body));
  }

  function fbCard(title, desc) {
    return el('section', { class: 'ax-fb__card' },
      el('h3', { class: 'ax-fb__cardtitle', text: title }),
      desc ? el('p', { class: 'ax-fb__carddesc', text: desc }) : null
    );
  }
  function fbRow(label, control, desc) {
    return el('div', { class: 'ax-fb__row' },
      el('div', { class: 'ax-fb__rowlabel' }, el('b', { text: label }), desc ? el('small', { text: desc }) : null),
      control
    );
  }
  function fbSwitch(path) {
    const node = el('span', { class: 'ax-switch' + (store.get(path) ? ' is-on' : ''), role: 'switch', tabindex: '0' });
    const toggle = () => {
      const next = !store.get(path);
      store.set(path, next);
      node.classList.toggle('is-on', next);
      bus.emit('settings:change', { path, value: next });
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return node;
  }
  function fbNumber(path, min, max, step) {
    const input = el('input', {
      class: 'ax-input ax-fb__num', type: 'number', value: store.get(path),
      min: String(min), max: String(max), step: String(step || 1)
    });
    input.addEventListener('change', () => {
      const v = U.clamp(Number(input.value) || min, min, max);
      input.value = v;
      store.set(path, v);
      bus.emit('settings:change', { path, value: v });
    });
    return input;
  }

  function mountFbSettings(tab, c) {
    if (tab === 'user') {
      const user = store.get('user') || {};
      c.appendChild(el('div', { class: 'ax-fb__card' },
        el('h3', { class: 'ax-fb__cardtitle', text: '个人账号' }),
        fbRow('昵称', el('span', { class: 'ax-fb__val', text: user.name || '老板' })),
        fbRow('邮箱', el('span', { class: 'ax-fb__val', text: user.email || '未绑定' })),
        fbRow('登录状态', el('span', { class: 'ax-fb__val', text: store.get('authed') ? '已登录（本地持久化）' : '未登录' })),
        el('div', { class: 'ax-fb__acts' },
          el('button', { class: 'ax-btn ax-btn--danger', type: 'button', onclick: () => A.auth.logout() }, el('span', { text: '退出登录' })),
          el('button', { class: 'ax-btn', type: 'button', onclick: () => { store.reset(); location.reload(); } }, el('span', { text: '清空本地数据' })))
      ));
      return;
    }
    if (tab === 'api') {
      const providers = store.get('providers') || [];
      const active = store.get('activeModelId');
      const card = fbCard('模型服务商', '密钥仅保存在本机 localStorage（轻量混淆），不随分享外泄。');
      providers.forEach((p) => {
        card.appendChild(el('div', { class: 'ax-fb__block' },
          el('div', { class: 'ax-fb__blockhead' },
            el('b', { text: p.name }),
            el('span', { class: 'ax-hint ax-truncate', text: p.baseUrl })),
          el('div', { class: 'ax-fb__chips' }, (p.models || []).map((m) => el('button', {
            class: 'ax-chip' + (m.id === active ? ' is-on' : ''), type: 'button',
            onclick: () => { bus.emit('model:change', { modelId: m.id }); renderFallbackSettings(); }
          }, el('span', { text: m.label }))))
        ));
      });
      if (!providers.length) fbNotice(card, 'key', '尚未配置服务商', '在 C 份设置中心里添加 Base URL 与 API Key。');
      c.appendChild(card);
      return;
    }
    if (tab === 'skills') {
      const card = fbCard('技能 Skills', '内置 5 个技能不可删除：子 Agent / 浏览器 / 终端 / 制作 Skill / 记忆。');
      (store.get('skills') || []).forEach((s) => card.appendChild(fbRow(s.name, fbSwitch('skills'), s.source + ' · ' + (s.builtin ? '内置' : '可移除'))));
      c.appendChild(card);
      return;
    }
    if (tab === 'mcp') {
      const card = fbCard('MCP 服务', '启用的服务会注入到对话上下文中。');
      (store.get('mcps') || []).forEach((m) => card.appendChild(fbRow(m.name, fbSwitch('mcps'), (m.tools || []).length + ' 个工具 · ' + (m.enabled ? '已启用' : '已停用'))));
      c.appendChild(card);
      return;
    }
    if (tab === 'memory') {
      const mem = store.get('memories') || [];
      const card = fbCard('记忆', '跨会话保留的偏好与踩坑知识。');
      if (!mem.length) fbNotice(card, 'memory', '还没有记忆', '对话中产生的重要信息会自动沉淀到这里。');
      mem.forEach((m) => card.appendChild(fbRow(m.text, el('span', { class: 'ax-fb__val', text: U.fmtTime(m.createdAt || Date.now()) }))));
      c.appendChild(card);
      return;
    }
    if (tab === 'general') {
      const g = store.get('settings.general') || {};
      const card = fbCard('通用');
      card.appendChild(fbRow('自动生成会话标题', fbSwitch('settings.general.autoTitle'), '首条消息后自动命名'));
      card.appendChild(fbRow('Enter 发送', fbSwitch('settings.general.enterToSend'), '关闭后 Enter 换行、⌘/Ctrl+Enter 发送'));
      card.appendChild(fbRow('字号', fbNumber('settings.general.fontSize', 12, 18, 1), '对话正文字号（px）'));
      card.appendChild(fbRow('语言', el('span', { class: 'ax-fb__val', text: g.language === 'zh-CN' ? '简体中文' : String(g.language) })));
      c.appendChild(card);
      return;
    }
    const a = store.get('settings.advanced') || {};
    const card = fbCard('高级', '谨慎修改：影响每次请求的采样与并发。');
    card.appendChild(fbRow('温度 temperature', fbNumber('settings.advanced.temperature', 0, 2, 0.05)));
    card.appendChild(fbRow('top_p', fbNumber('settings.advanced.topP', 0, 1, 0.05)));
    card.appendChild(fbRow('最大轮次 maxTurns', fbNumber('settings.advanced.maxTurns', 1, 200, 1)));
    card.appendChild(fbRow('并发 concurrency', fbNumber('settings.advanced.concurrency', 1, 8, 1)));
    card.appendChild(fbRow('沙箱执行', fbSwitch('settings.advanced.sandbox')));
    card.appendChild(fbRow('允许 shell 工具', fbSwitch('settings.advanced.allowShell')));
    card.appendChild(fbRow('匿名遥测', fbSwitch('settings.advanced.telemetry'), '默认关闭'));
    c.appendChild(card);
  }

  /* ============================================================
     6. 全局事件接线
     ============================================================ */
  function wire() {
    /* 登录态 */
    bus.on('auth:login', () => { A.auth.hide(); showApp(); gate(); });
    bus.on('auth:logout', () => {
      if (/^#\/s\//.test(location.hash || '')) { showApp(); return; }   // 分享页免登录
      hideApp(); A.auth.show();
    });

    /* 右栏 */
    bus.on('panel:open', (p) => {
      const raw = (p && p.tab) || store.get('ui.rightTab') || 'terminal';
      /* 大子目录入口：/settings/ → settings:home、/account/ → settings:user、
         /skills/ → settings:skills、/chat/ → view:chat。这里把「地址即路由」翻译成真实动作。 */
      if (typeof raw === 'string' && raw.indexOf('settings:') === 0) {
        const sub = raw.slice('settings:'.length) || 'home';
        store.set('ui.rightOpen', false);
        syncRight();
        bus.emit('settings:open', { tab: sub });
        if (mounted.shell) A.shell.render();
        return;
      }
      if (typeof raw === 'string' && raw.indexOf('view:') === 0) {
        const v = raw.slice('view:'.length) || 'home';
        store.set('ui.rightOpen', false);
        store.set('ui.view', v);
        syncRight();
        if (A.chat && A.chat.renderStage) { try { A.chat.renderStage(); } catch (_) {} }
        if (mounted.shell) A.shell.render();
        return;
      }
      const tab = raw;
      store.set('ui.rightTab', tab);
      store.set('ui.rightOpen', true);
      syncRight();
      if (mounted.shell) A.shell.render();
    });
    bus.on('panel:close', () => { store.set('ui.rightOpen', false); syncRight(); if (mounted.shell) A.shell.render(); });
    bus.on('panel:tab', (p) => { store.set('ui.rightTab', (p && p.tab) || 'terminal'); if (store.get('ui.rightOpen')) syncRight(); });

    /* 设置中心 */
    bus.on('settings:open', (p) => openSettings(p && p.tab));
    bus.on('settings:close', closeSettings);

    /* 模型 / 推理 / 思考 */
    bus.on('model:change', (p) => {
      const id = typeof p === 'string' ? p : (p && p.modelId);
      if (!id) return;
      store.set('activeModelId', id);
      const m = findModel(id);
      U.toast('已切换模型：' + (m ? m.label : id), 'ok');
    });
    bus.on('reasoning:change', (p) => {
      /* 等级 0–5（0=Off），严禁用 `|| 3` 兜底：0 是合法档位，否则 Off 会被写回 Medium */
      const raw = Number(typeof p === 'number' ? p : (p && p.level));
      const lv = isFinite(raw) ? U.clamp(Math.round(raw), 0, 5) : 3;
      if (store.get('reasoning') !== lv) store.set('reasoning', lv);
    });
    bus.on('thinking:toggle', (p) => {
      const on = typeof p === 'boolean' ? p : !!(p && p.on);
      store.set('thinking', on);
      U.toast(on ? '思考模式已开启' : '思考模式已关闭', 'ok');
    });

    /* 产出物 */
    bus.on('artifact:select', (p) => {
      const id = p && p.id;
      if (!id) return;
      store.set('activeArtifactId', id);
      store.set('ui.rightTab', 'artifacts');
      store.set('ui.rightOpen', true);
      syncRight();
      if (mounted.shell) A.shell.render();
    });
    bus.on('artifact:download', (p) => {
      const a = findArtifact(p && p.id);
      if (!a) return;
      U.download(a.name || a.path || 'artifact.txt', a.content || '', a.mime || 'text/plain;charset=utf-8');
      U.toast('已开始下载：' + (a.name || a.path), 'ok');
    });
    bus.on('artifact:share', (p) => {
      const id = p && p.id;
      const list = store.get('artifacts') || [];
      const targets = id ? list.filter((a) => a.id === id) : list;
      if (!targets.length) return U.toast('没有可分享的产出物', 'warn');
      const share = Object.assign({}, store.get('share'));
      share.items = (share.items || []).slice();
      targets.forEach((a) => {
        if (!a.slug) {
          a.slug = (a.name || 'item').replace(/\.[a-z0-9]+$/i, '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24).toLowerCase() + '-' + String(a.id).slice(-6);
          a.sharedAt = Date.now();
        }
        if (a.content) {
          const existed = share.items.findIndex((x) => x.slug === a.slug);
          const rec = { slug: a.slug, name: a.name, mime: a.mime || 'text/plain;charset=utf-8', content: a.content, title: a.name };
          if (existed >= 0) share.items[existed] = rec; else share.items.push(rec);
        }
      });
      store.set('artifacts', list);
      share.enabled = true;
      share.slug = targets[0].slug;
      share.url = location.origin + location.pathname + '#/s/' + share.slug;
      store.set('share', share);
      bus.emit('share:create', { slug: share.slug });
      U.copy(share.url);
    });
    bus.on('share:stop', () => {
      const share = { enabled: false, slug: null, url: null, items: [] };
      store.set('share', share);
      const list = store.get('artifacts') || [];
      list.forEach((a) => { a.slug = null; a.sharedAt = null; });
      store.set('artifacts', list);
      U.toast('已停止分享，链接立即失效', 'ok');
    });

    /* 项目文件 */
    bus.on('file:open', (p) => {
      const f = (p && p.file) || p;
      store.set('ui.rightTab', 'files');
      store.set('ui.rightOpen', true);
      syncRight();
      if (mounted.shell) A.shell.render();
      if (f && f.path) U.toast('已打开 ' + f.path, 'ok');
    });
    bus.on('file:save', (p) => {
      const f = p && (p.file || p);
      if (!f || !f.path) return;
      const list = (store.get('projectFiles') || []).slice();
      const i = list.findIndex((x) => x.id === f.id || x.path === f.path);
      const rec = Object.assign({ id: f.id || U.uid('f'), updatedAt: Date.now() }, f);
      if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
      store.set('projectFiles', list);
      if (fbRight && store.get('ui.rightOpen')) renderFallbackRight();
      U.toast('已保存 ' + f.path, 'ok');
    });

    /* 兜底提示：B/C 未加载时的命令入口 */
    bus.on('terminal:run', () => { if (fbRight) U.toast('终端面板由 B 份模块提供，加载后可执行真实命令', 'warn'); });
    bus.on('browser:navigate', () => { if (fbRight) U.toast('浏览器面板由 B 份模块提供', 'warn'); });

    /* 移动端遮罩与断点 */
    window.addEventListener('resize', U.debounce(() => {
      if (window.innerWidth > 900) { const app = appNode(); if (app) app.classList.remove('is-left-open-mobile'); }
      syncRight();
    }, 200));

    /* 快捷键 */
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) {
        if (e.key === 'Escape') {
          if (A.menu && A.menu.isOpen) { A.menu.close(); return; }
          const app = appNode();
          if (app && app.classList.contains('is-left-open-mobile')) { app.classList.remove('is-left-open-mobile'); return; }
          if (store.get('ui.view') === 'settings') { bus.emit('settings:close'); return; }
          if (store.get('ui.rightOpen') && window.innerWidth <= 900) bus.emit('panel:close');
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); if (store.get('authed')) A.chat.newConversation(); }
      else if (k === 'b') { e.preventDefault(); bus.emit('ui:left-toggle'); }
      else if (k === 'j') { e.preventDefault(); bus.emit(store.get('ui.rightOpen') ? 'panel:close' : 'panel:open', { tab: store.get('ui.rightTab') }); }
      else if (k === ',') { e.preventDefault(); bus.emit('settings:open', { tab: store.get('ui.settingsTab') }); }
      else if (k === 'enter' && store.get('settings.general.enterToSend') === false) { /* 交给输入框 */ }
    });
  }

  function findModel(id) {
    let hit = null;
    (store.get('providers') || []).forEach((p) => (p.models || []).forEach((m) => { if (m.id === id) hit = m; }));
    return hit;
  }
  function findArtifact(id) { return (store.get('artifacts') || []).find((a) => a.id === id) || null; }

  /* ============================================================
     7. 启动
     ============================================================ */
  function start() {
    store.load();
    seedWorkspace();
    mountModules();
    gate();
    registerFallbackRight();
    registerFallbackSettings();
    wire();
    syncRight();
    if (store.get('ui.rightOpen') && fbRight) renderFallbackRight();
    try { window.dispatchEvent(new CustomEvent('aycho:ready', { detail: { version: A.VERSION } })); } catch (err) {}
    playBoot();
  }

  A.boot = {
    start,
    replayBoot: playBoot,
    openSettings,
    closeSettings,
    syncRight,
    get usingFallback() { return { right: fbRight, settings: fbSettings }; }
  };

  A.ready(start);
})();
