/* ============================================================
   AYCHO module: api  |  真实后端客户端
   与 server/ 统一网关（/api/health · /api/auth/* · /api/chat · /api/share）对接。
   · 同源部署（用 node server/terminal-server.js 打开页面）时，apiBase 自动指向当前域名；
   · file:// 双击打开时后端不可达，可在设置中心的「后端网关」填入基址接入；
   · 密钥全部留在服务端，浏览器只带会话令牌。
   事件：api:ready {online, features} / api:unauthorized
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util || {};
  let features = {};
  let probed = false;

  function cfg() { return A.config || (A.config = {}); }
  function base() { return String(cfg().apiBase || '').replace(/\/+$/, ''); }
  function available() { return !!base(); }
  function featureOf(k) { return !!(features && features[k]); }

  function token() { try { return A.store.get('apiToken') || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) A.store.set('apiToken', t); else A.store.remove('apiToken'); } catch (e) {}
  }

  function headers(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  async function request(method, path, body) {
    const b = base();
    if (!b) throw new Error('后端未连接：请在设置中心的「后端网关」填入基址');
    let res;
    try {
      res = await fetch(b + path, {
        method: method,
        headers: headers(),
        body: body == null ? undefined : JSON.stringify(body),
        cache: 'no-store'
      });
    } catch (e) {
      throw new Error('无法连接后端：' + ((e && e.message) || '网络错误'));
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { ok: false, message: text.slice(0, 300) }; }
    if (res.status === 401 || res.status === 403) A.bus.emit('api:unauthorized', { path: path });
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || ('请求失败 ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------- 连通性探测 ---------------- */
  /* 后端地址优先级：window.AYCHO_API_BASE（部署期注入） > localStorage aycho.apiBase（设置页手填） > 同源 */
  function rememberedBase() {
    try { return String(localStorage.getItem('aycho.apiBase') || '').replace(/\/+$/, ''); } catch (e) { return ''; }
  }
  function rememberBase(url) {
    try { if (url) localStorage.setItem('aycho.apiBase', url); else localStorage.removeItem('aycho.apiBase'); } catch (e) {}
  }
  function preferredTarget() {
    let v = '';
    try { if (typeof window !== 'undefined' && window.AYCHO_API_BASE) v = String(window.AYCHO_API_BASE); } catch (e) {}
    if (!v) v = rememberedBase();
    return String(v).replace(/\/+$/, '');
  }

  let gwRetry = 5;
  async function probe(opts) {
    const allowRetry = !opts || opts.retry !== false;
    const forced = preferredTarget() || String(cfg().apiBase || '').trim();
    const origin = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) ? location.origin : '';
    const target = forced || origin;
    if (!target) {
      cfg().apiBase = '';
      probed = true;
      A.bus.emit('api:ready', { online: false, reason: 'local-file' });
      return { online: false, reason: 'local-file' };
    }
    try {
      const r = await fetch(target.replace(/\/+$/, '') + '/api/health', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || j.ok !== true) throw new Error('响应异常');
      cfg().apiBase = target.replace(/\/+$/, '');
      features = j.features || {};
      gwRetry = 5;
      probed = true;
      A.bus.emit('api:ready', { online: true, features: features });
      return { online: true, features: features };
    } catch (e) {
      // 后端可能正在冷启动（免费实例）：短时间内自动重试，避免误判离线
      if (allowRetry && gwRetry-- > 0) {
        cfg().apiBase = '';
        features = {};
        probed = true;
        A.bus.emit('api:ready', { online: false, reason: 'retrying' });
        setTimeout(function () { probe(); }, 6000);
        return { online: false, reason: (e && e.message) || 'unreachable' };
      }
      // 手填/记忆的地址不可达时清除，避免永久卡在失效地址
      if (target && target === rememberedBase()) rememberBase('');
      cfg().apiBase = '';
      features = {};
      probed = true;
      A.bus.emit('api:ready', { online: false, reason: (e && e.message) || 'unreachable' });
      return { online: false, reason: (e && e.message) || 'unreachable' };
    }
  }

  /* 运行时切换后端网关（设置页「后端网关」使用） */
  function setBase(url) {
    const v = String(url || '').trim().replace(/\/+$/, '');
    rememberBase(v);
    cfg().apiBase = '';
    features = {};
    probed = false;
    return probe({ retry: false });
  }

  /* ---------------- 账号 ---------------- */
  const auth = {
    sendCode: (email, scene) => request('POST', '/api/auth/send-code', { email: email, scene: scene || 'register' }),
    register: (email, password, code, name) => request('POST', '/api/auth/register', { email: email, password: password, code: code, name: name || '' }),
    login: (email, password) => request('POST', '/api/auth/login', { email: email, password: password }),
    resetPassword: (email, code, password) => request('POST', '/api/auth/reset-password', { email: email, code: code, password: password }),
    me: () => request('GET', '/api/auth/me'),
    logout: () => request('POST', '/api/auth/logout', {}),
    /* 危险操作核验：登录密码 / 邮箱验证码 */
    verify: (password) => request('POST', '/api/auth/verify', { method: 'password', password: password }),
    verifyCode: (code) => request('POST', '/api/auth/verify', { method: 'code', code: code })
  };

  /* ---------------- 模型 / 对话 ---------------- */
  function chatStream(payload, handlers) {
    handlers = handlers || {};
    const b = base();
    if (!b) { const e = new Error('后端未连接：请在设置中心的「后端网关」填入基址'); if (handlers.onError) handlers.onError(e); return Promise.reject(e); }
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const task = (async () => {
      let res;
      try {
        res = await fetch(b + '/api/chat', {
          method: 'POST', headers: headers(),
          body: JSON.stringify(payload), cache: 'no-store',
          signal: ctrl ? ctrl.signal : undefined
        });
      } catch (e) {
        const err = new Error('无法连接模型服务：' + ((e && e.message) || '网络错误'));
        if (handlers.onError) handlers.onError(err);
        throw err;
      }
      if (!res.ok) {
        const t = await res.text();
        let m = t;
        try { m = JSON.parse(t).message || t; } catch (e) {}
        const err = new Error(m || ('请求失败 ' + res.status));
        if (handlers.onError) handlers.onError(err);
        throw err;
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        const t = await res.text();
        if (handlers.onDelta) handlers.onDelta(t);
        if (handlers.onDone) handlers.onDone();
        return true;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      let buf = '';
      let errored = null;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line.indexOf('data:') !== 0) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let j = null;
          try { j = JSON.parse(raw); } catch (e) { continue; }
          if (j.type === 'meta' && handlers.onMeta) handlers.onMeta(j);
          else if (j.type === 'delta' && handlers.onDelta) handlers.onDelta(j.text || '');
          else if (j.type === 'reason' && handlers.onReason) handlers.onReason(j.text || '');
          else if (j.type === 'usage' && handlers.onUsage) handlers.onUsage(j.usage);
          else if (j.type === 'done' && handlers.onDone) handlers.onDone();
          else if (j.type === 'error') errored = new Error(j.message || '模型返回错误');
        }
      }
      if (errored) { if (handlers.onError) handlers.onError(errored); throw errored; }
      return true;
    })();
    return { abort: () => { try { if (ctrl) ctrl.abort(); } catch (e) {} }, promise: task };
  }

  const model = {
    status: () => request('GET', '/api/model/status'),
    list: () => request('GET', '/api/models')
  };

  /* ---------------- 分享 ---------------- */
  const share = {
    create: (payload) => request('POST', '/api/share', payload),
    get: (slug) => request('GET', '/api/share/' + encodeURIComponent(slug)),
    stop: (slug) => request('DELETE', '/api/share/' + encodeURIComponent(slug)),
    list: () => request('GET', '/api/shares'),
    urlOf: (slug) => base() ? (base() + '/s/' + slug) : (location.origin + '/s/' + slug)
  };

  /* ---------------- 多端同步 ---------------- */
  const sync = {
    pull: () => request('GET', '/api/sync'),
    push: (data) => request('POST', '/api/sync', { data: data }),
    status: () => request('GET', '/api/sync/status')
  };

  A.api = {
    probe: probe,
    base: base,
    setBase: setBase,
    available: available,
    online: () => available() && probed,
    features: () => Object.assign({}, features),
    featureOf: featureOf,
    token: token,
    setToken: setToken,
    request: request,
    auth: auth,
    chat: chatStream,
    model: model,
    share: share,
    sync: sync
  };

  A.ready(() => { probe(); });
})();
