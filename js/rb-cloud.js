/* AYCHO module: rb-cloud | 云端工作区桥
   把「项目文件」状态与服务器真实磁盘（/api/fs/*）双向绑定：
   · 启动时从 /api/fs/tree 拉真实文件树覆盖本地内置文件；
   · 之后 projectFiles 的每次变更（新建/改名/删除/IDE 保存）防抖 700ms 全量镜像到磁盘。
   这样 IDE 的 Ctrl+S = 真写服务端文件，终端里 cat 得到同一份内容。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var timer = null;
  var applying = false;
  var lastResult = null;

  function online() { try { return !!(A.api && A.api.available && A.api.available()); } catch (e) { return false; } }
  function base() { try { return String((A.config && A.config.apiBase) || '').replace(/\/+$/, ''); } catch (e) { return ''; } }
  function files() { try { return A.store ? (A.store.get('projectFiles', []) || []) : []; } catch (e) { return []; } }
  function toast(t, ty) { if (A.toast) A.toast(t, ty); }

  function toRec(it) {
    var path = String(it.path || '/');
    return {
      id: 'fs:' + path,
      path: path,
      kind: it.kind === 'dir' ? 'dir' : 'file',
      content: it.content == null ? '' : String(it.content),
      size: it.size || 0,
      updatedAt: it.updatedAt || Date.now()
    };
  }

  function load() {
    if (!online()) { if (A.bus) A.bus.emit('cloud:offline', {}); return Promise.resolve(false); }
    return fetch(base() + '/api/fs/tree?withContent=1', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !Array.isArray(d.items)) return false;
        if (d.items.length) {
          applying = true;
          try { A.store.set('projectFiles', d.items.map(toRec)); } finally { applying = false; }
        }
        lastResult = { root: d.root, count: d.items.length, at: Date.now() };
        if (A.bus) A.bus.emit('cloud:ready', lastResult);
        toast('已连接云端工作区（' + d.items.length + ' 项）', 'ok');
        return true;
      })
      .catch(function (e) { if (A.bus) A.bus.emit('cloud:error', { message: (e && e.message) || String(e) }); return false; });
  }

  function push() {
    if (!online()) return Promise.resolve(null);
    var payload = files().map(function (f) {
      return { path: f.path, kind: f.kind === 'dir' ? 'dir' : 'file', content: f.kind === 'dir' ? '' : (f.content == null ? '' : String(f.content)) };
    });
    return fetch(base() + '/api/fs/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payload })
    }).then(function (r) { return r.json(); }).then(function (d) {
      lastResult = d;
      if (A.bus) A.bus.emit('cloud:synced', d);
      return d;
    }).catch(function (e) {
      if (A.bus) A.bus.emit('cloud:error', { message: (e && e.message) || String(e) });
      return null;
    });
  }

  function schedule() {
    if (applying) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; push(); }, 700);
  }

  function run(cmd, cwd) {
    return fetch(base() + '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: cmd, cwd: cwd || '/' })
    }).then(function (r) { return r.json(); });
  }

  function init() {
    if (A.store && A.store.subscribe) A.store.subscribe('projectFiles', schedule);
    load();
  }
  if (A.ready) A.ready(init); else init();

  A.cloud = { load: load, push: push, run: run, online: online, last: function () { return lastResult; } };
})();
