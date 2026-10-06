/* ============================================================
   AYCHO module: store  |  owner: A(main)  |  contract: v1
   全局状态 + 事件总线 + 模块注册表
   所有模块（A/B/C）只能通过本文件的 API 通信，禁止直接改他人状态
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});

  /* ---------------- 事件总线 ---------------- */
  const handlers = new Map();
  const bus = {
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, new Set());
      handlers.get(evt).add(fn);
      return () => bus.off(evt, fn);
    },
    once(evt, fn) {
      const off = bus.on(evt, (p) => { off(); fn(p); });
      return off;
    },
    off(evt, fn) {
      const s = handlers.get(evt);
      if (s) s.delete(fn);
    },
    emit(evt, payload) {
      const s = handlers.get(evt);
      if (s) s.forEach((fn) => { try { fn(payload, evt); } catch (e) { console.error('[bus]', evt, e); } });
      const w = handlers.get('*');
      if (w) w.forEach((fn) => { try { fn(payload, evt); } catch (e) {} });
    },
    clear() { handlers.clear(); }
  };
  A.bus = bus;

  /* ---------------- 状态 ---------------- */
  const PERSIST_KEY = 'aycho.state.v1';

  const initial = {
    /* 账号 */
    authed: false,
    user: { name: '老板', email: '', avatar: '' },
    passwordStrength: 0,

    /* 会话 */
    conversations: [],        // {id,title,createdAt,updatedAt,agentIds[]}
    activeConversationId: null,
    messages: {},              // convId -> Message[]
    streaming: false,

    /* AI 编排 */
    providers: [],             // {id,name,baseUrl,keyRef,models:[{id,label,enabled}]}
    activeModelId: null,
    reasoning: 3,              // 0..5（0=Off）
    thinking: true,
    agents: [],                // {id,name,desc,color,modelId,builtin}
    activeAgentIds: [],
    skills: [],                // {id,name,desc,builtin,enabled,source}
    mcps: [],                  // {id,name,desc,enabled,tools:[]}
    memories: [],              // {id,text,tags,createdAt,convId}

    /* 工作区 */
    artifacts: [],             // {id,name,path,kind,mime,content,url,sharedAt,shareUrl,createdAt}
    activeArtifactId: null,
    projectFiles: [],          // {id,path,kind,content,updatedAt}
    share: { enabled: false, slug: null, url: null, items: [] },

    /* 界面 */
    ui: {
      leftOpen: true,
      rightOpen: false,
      rightTab: 'terminal',    // terminal | artifacts | files | browser | ide
      view: 'home',            // home | chat | settings | share
      settingsTab: 'user',     // user | api | skills | mcp | memory | general | advanced
      composerMenu: null,      // null | 'plus' | 'model'
      installMenu: false
    },

    settings: {
      general: { language: 'zh-CN', autoTitle: true, enterToSend: true, showLineNumbers: true, fontSize: 14, density: 'comfortable' },
      advanced: { maxTurns: 32, temperature: 0.7, topP: 0.95, streamSpeed: 1, sandbox: true, allowShell: true, telemetry: false, concurrency: 3 }
    }
  };

  let state = deepClone(initial);

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function getPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
  }
  function setPath(obj, path, val) {
    const ks = path.split('.');
    let cur = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof cur[ks[i]] !== 'object' || cur[ks[i]] === null) cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    cur[ks[ks.length - 1]] = val;
  }

  const store = {
    raw() { return state; },
    get(path) { return path ? getPath(state, path) : state; },
    /** set('ui.rightOpen', true) 或 set({ui:{rightOpen:true}})（浅合并） */
    set(pathOrObj, val) {
      if (typeof pathOrObj === 'object' && pathOrObj !== null) {
        Object.keys(pathOrObj).forEach((k) => {
          if (typeof pathOrObj[k] === 'object' && !Array.isArray(pathOrObj[k]) && typeof state[k] === 'object' && !Array.isArray(state[k])) {
            state[k] = Object.assign({}, state[k], pathOrObj[k]);
          } else {
            state[k] = pathOrObj[k];
          }
        });
        store.save();
        bus.emit('state:change', { path: '*', value: state });
        return state;
      }
      const path = pathOrObj;
      setPath(state, path, val);
      store.save();
      bus.emit('state:change', { path, value: val });
      bus.emit('state:' + path, val);
      return state;
    },
    /** 订阅状态变更，兼容两种签名（B 的 rb-* 使用 (path, fn)，A 早期契约用 (fn)）：
     *   subscribe(fn)        —— 任意 state:change 均回调，fn 收到事件对象 {path,value}
     *   subscribe(path, fn)  —— 仅相关路径变更时回调，fn 收到该路径的最新值（第二个参数为事件对象）
     * 参数非法时返回空解绑函数，绝不把非函数塞进总线（否则每次广播都会抛错）。 */
    subscribe(a, b) {
      if (typeof a === 'function') return bus.on('state:change', (e) => a(e));
      if (typeof b !== 'function') return () => {};
      const path = String(a);
      const head = path.split('.')[0];
      const hit = (p) => !p || p === '*' || p === path || String(p).split('.')[0] === head;
      return bus.on('state:change', (e) => {
        if (!hit(e && e.path)) return;
        try { b(store.get(path), e); } catch (err) { console.error('[store.subscribe]', path, err); }
      });
    },
    save() {
      try { localStorage.setItem(PERSIST_KEY, JSON.stringify(store.export())); } catch (e) {}
    },
    /** 仅持久化必要字段；apiKey 使用轻量混淆后再落盘 */
    export() {
      return {
        authed: state.authed, user: state.user,
        /* 会话令牌：刷新后据此向后端恢复登录态（浏览器只带令牌，模型密钥始终留在服务端） */
        apiToken: state.apiToken || '',
        conversations: state.conversations, activeConversationId: state.activeConversationId, messages: state.messages,
        providers: state.providers.map((p) => ({ ...p, keyRef: p.keyRef ? obfuscate(p.keyRef) : '' })),
        activeModelId: state.activeModelId, reasoning: state.reasoning, thinking: state.thinking,
        agents: state.agents, activeAgentIds: state.activeAgentIds,
        skills: state.skills, mcps: state.mcps, memories: state.memories,
        artifacts: state.artifacts, projectFiles: state.projectFiles, share: state.share,
        ui: state.ui, settings: state.settings
      };
    },
    load() {
      try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data.providers) data.providers = data.providers.map((p) => ({ ...p, keyRef: p.keyRef ? deobfuscate(p.keyRef) : '' }));
        state = Object.assign(deepClone(initial), data);
        state.ui = Object.assign(deepClone(initial.ui), data.ui || {});
        bus.emit('state:change', { path: '*', value: state });
        return true;
      } catch (e) { return false; }
    },
    reset() {
      state = deepClone(initial);
      try { localStorage.removeItem(PERSIST_KEY); } catch (e) {}
      bus.emit('state:change', { path: '*', value: state });
    }
  };
  A.store = store;

  /* apiKey 不落明文（轻量混淆，非加密；生产请走后端密钥库） */
  function obfuscate(s) { try { return 'x1:' + btoa(unescape(encodeURIComponent(s))).split('').reverse().join(''); } catch (e) { return s; } }
  function deobfuscate(s) {
    if (typeof s !== 'string' || !s.startsWith('x1:')) return s;
    try { return decodeURIComponent(escape(atob(s.slice(3).split('').reverse().join('')))); } catch (e) { return ''; }
  }

  /* ---------------- 模块注册表 ---------------- */
  const registry = { 'right-panel': {}, 'settings-panel': {}, 'install-item': {}, 'artifact-viewer': {}, 'command': {} };
  const reg = {
    add(kind, id, def) {
      if (!registry[kind]) registry[kind] = {};
      registry[kind][id] = def;
      bus.emit('registry:add', { kind, id, def });
      return def;
    },
    get(kind, id) { return (registry[kind] || {})[id]; },
    /** 按 order 升序返回（C 的设置页 / B 的面板均依赖稳定顺序） */
    list(kind) {
      return Object.entries(registry[kind] || {})
        .map(([id, def]) => ({ id, ...def }))
        .sort((a, b) => (a.order == null ? 100 : a.order) - (b.order == null ? 100 : b.order));
    },
    remove(kind, id) { delete (registry[kind] || {})[id]; bus.emit('registry:remove', { kind, id }); }
  };
  A.registry = reg;
  A.register = (kind, id, def) => reg.add(kind, id, def);

  /* ---------------- 就绪钩子 ---------------- */
  const queue = [];
  A.ready = (fn) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(fn, 0);
    else queue.push(fn);
  };
  document.addEventListener('DOMContentLoaded', () => { while (queue.length) queue.shift()(); });

  /* ---------------- 事件契约（冻结） ----------------
     auth:login {user}            auth:logout
     chat:new {conv}              chat:select {id}        chat:deleted {id}
     chat:title {id,title}        chat:send {convId,text,attachments,agentIds,modelId,reasoning,thinking}
     msg:append {convId,msg}      msg:stream {convId,msgId,delta}
     msg:update {convId,msg}      msg:done  {convId,msgId}
     msg:tool {convId,msgId,tool}  msg:stop  {convId}
     panel:open {tab}             panel:close             panel:tab {tab}
     model:change {modelId}       reasoning:change {level} thinking:toggle {on}
     providers:change             agents:change           skills:change        mcps:change
     artifact:add {artifact}      artifact:select {id}    artifact:remove {id}
     artifact:share {id}          artifact:unshare {id}   artifact:download {id}
     file:open {file}             file:save {file}
     terminal:run {cmd}           terminal:out {data}
     browser:navigate {url}
     share:create {slug}          share:stop
     settings:open {tab}          settings:close
     toast {text,type}
     state:change {path,value}    registry:add  registry:remove
   ------------------------------------------------------ */

  /* 立即恢复上一次持久化状态：必须早于任何模块的 ready 回调。
     否则模块初始化时的 store.set 会先把「默认状态」写回 localStorage，
     把尚未加载的登录态覆盖掉（刷新后掉登录的根因）。 */
  try { store.load(); } catch (e) {}

  A.VERSION = '1.0.0';
  A.CONTRACT = 'v1';
})();
