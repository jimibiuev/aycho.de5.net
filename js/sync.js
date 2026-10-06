/* ============================================================
   AYCHO module: sync  |  真实多端同步
   登录后把工作台快照（会话 / 产出物 / 设置 / 记忆 / 智能体…）推到服务端，
   另一台设备用同一账号登录即可拉回，不再是「只喊口号」的同步。
   · 模型密钥永不上传：推送前剥离 providers[].keyRef
   · 冲突策略：最后写入生效（比较 updatedAt），并广播状态供 UI 展示
   事件：sync:state {status:'off'|'idle'|'syncing'|'ok'|'error', at, rev, message}
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util || {};
  const PERSIST_KEY = 'aycho.state.v1';   // 与 store 保持一致
  const META_KEY = 'aycho.sync.v1';
  let timer = null;
  let busy = false;

  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function setMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(Object.assign(meta(), m))); } catch (e) {}
  }

  function enabled() {
    try {
      const v = A.store.get('settings.general.syncEnabled');
      return v === undefined || v === null ? true : !!v;
    } catch (e) { return true; }
  }

  function ready() {
    return !!(A.api && A.api.available() && A.api.token());
  }

  function emit(status, extra) {
    A.bus.emit('sync:state', Object.assign({ status: status, at: Date.now() }, extra || {}));
  }

  /* 剥离敏感字段后再上传 */
  function snapshot() {
    const data = A.store.export();
    if (Array.isArray(data.providers)) {
      data.providers = data.providers.map((p) => Object.assign({}, p, { keyRef: '' }));
    }
    return data;
  }

  function applyRemote(remote) {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(remote));
      A.store.load();
      return true;
    } catch (e) { return false; }
  }

  async function pull(opts) {
    if (!ready() || !enabled()) { emit('off'); return false; }
    if (busy) return false;
    busy = true;
    emit('syncing', { direction: 'pull' });
    try {
      const r = await A.api.sync.pull();
      if (r.empty || !r.data) {
        setMeta({ lastRev: 0, lastAt: 0 });
        emit('idle');
        busy = false;
        return false;
      }
      const m = meta();
      if (!m.lastAt || r.updatedAt > m.lastAt) {
        const ok = applyRemote(r.data);
        setMeta({ lastRev: r.rev, lastAt: r.updatedAt });
        emit('ok', { rev: r.rev, direction: 'pull' });
        if (!opts || opts.silent !== true) {
          U.toast && U.toast('已从云端同步最新工作台', 'ok');
        }
        busy = false;
        return ok;
      }
      emit('idle');
      busy = false;
      return false;
    } catch (e) {
      emit('error', { message: (e && e.message) || '同步失败' });
      busy = false;
      return false;
    }
  }

  async function push() {
    if (!ready() || !enabled()) { emit('off'); return false; }
    if (busy) return false;
    busy = true;
    emit('syncing', { direction: 'push' });
    try {
      const r = await A.api.sync.push(snapshot());
      setMeta({ lastRev: r.rev, lastAt: r.updatedAt });
      emit('ok', { rev: r.rev, direction: 'push' });
      busy = false;
      return true;
    } catch (e) {
      emit('error', { message: (e && e.message) || '同步失败' });
      busy = false;
      return false;
    }
  }

  /* 本地改动 → 防抖推送 */
  function schedule() {
    if (!ready() || !enabled()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; push(); }, 2500);
  }

  async function status() {
    if (!ready()) return { online: false, enabled: enabled() };
    try {
      const s = await A.api.sync.status();
      return { online: true, enabled: enabled(), exists: s.exists, rev: s.rev, updatedAt: s.updatedAt, size: s.size };
    } catch (e) {
      return { online: false, enabled: enabled(), message: (e && e.message) || '' };
    }
  }

  A.sync = {
    pull: pull,
    push: push,
    now: () => push(),
    status: status,
    snapshotSize: () => { try { return JSON.stringify(snapshot()).length; } catch (e) { return 0; } }
  };

  A.ready(() => {
    A.bus.on('state:change', () => schedule());
    A.bus.on('api:ready', (e) => { if (e && e.online && A.api.token()) pull({ silent: true }); });
    A.bus.on('auth:login', () => { setTimeout(() => pull({ silent: true }), 300); });
    A.bus.on('auth:logout', () => emit('off'));
  });
})();
