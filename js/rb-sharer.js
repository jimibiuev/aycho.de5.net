/* AYCHO module: rb-sharer | 真实分享（不再是假的 #/s/ 本地链接）
   调服务端 POST /api/share，内容落盘 server/data/shares/<ID>.json，
   返回形如 https://<分享域名>/artifact/<ID> 的公开 HTML 链接。
   注册到 registry('sharer')，产出物面板的「分享」会自动走真实链路。 */
(function () {
  'use strict';
  window.AYCHO = window.AYCHO || {};
  var A = window.AYCHO;

  var KEY = 'aycho.shareMap';   // { artifactId: {id, url, at} }

  function S(p, d) { try { return A.store ? A.store.get(p, d) : d; } catch (e) { return d; } }
  function setS(p, v) { try { if (A.store) A.store.set(p, v); } catch (e) {} }
  function online() { try { return !!(A.api && A.api.available && A.api.available()); } catch (e) { return false; } }
  function map() { var m = S(KEY, {}); return (m && typeof m === 'object') ? m : {}; }

  function nameOf(art) { return String((art && (art.name || art.path)) || 'artifact'); }
  function extOf(name) { var s = String(name || ''); var i = s.lastIndexOf('.'); return i > 0 ? s.slice(i + 1).toLowerCase() : ''; }
  function mimeOf(art) {
    if (art && art.mime) return String(art.mime);
    var ext = extOf(nameOf(art));
    var m = {
      html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', md: 'text/markdown', txt: 'text/plain',
      json: 'application/json', csv: 'text/csv', xml: 'application/xml', yml: 'text/yaml', yaml: 'text/yaml',
      js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', css: 'text/css',
      py: 'text/x-python', sh: 'text/x-shellscript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp'
    };
    return m[ext] || 'text/plain';
  }
  function textOf(art) {
    if (!art) return '';
    if (typeof art.content === 'string') return art.content;
    if (typeof art.text === 'string') return art.text;
    var url = String(art.url || '');
    if (url.indexOf('data:') === 0) {
      var i = url.indexOf(',');
      if (i < 0) return '';
      var meta = url.slice(5, i), body = url.slice(i + 1);
      try { return meta.indexOf('base64') >= 0 ? atob(body) : decodeURIComponent(body); } catch (_) { return ''; }
    }
    return '';
  }

  /* 返回 Promise<string url>（后端不可达时返回 ''，由调用方降级） */
  function share(art) {
    if (!art || !online()) return '';
    var content = textOf(art);
    if (!content) return '';
    var payload = {
      name: nameOf(art),
      mime: mimeOf(art),
      content: content,
      artifactId: String(art.id || '')
    };
    return A.api.share.create(payload).then(function (r) {
      var m = map();
      m[String(art.id || payload.name)] = { id: r.id || r.slug, url: r.url || '', at: Date.now() };
      setS(KEY, m);
      if (A.bus) A.bus.emit('share:created', { artifactId: art.id, id: r.id || r.slug, url: r.url });
      return r.url || '';
    });
  }

  function unshare(art) {
    if (!art || !online()) return null;
    var m = map();
    var rec = m[String(art.id || '')];
    if (!rec || !rec.id) return null;
    return A.api.share.stop(rec.id).then(function () {
      delete m[String(art.id || '')];
      setS(KEY, m);
      if (A.bus) A.bus.emit('share:stopped', { artifactId: art.id, id: rec.id });
      return true;
    });
  }

  function urlOf(art) {
    var rec = map()[String((art && art.id) || '')];
    return (rec && rec.url) || '';
  }

  function register() {
    if (!A.registry || !A.registry.register) return;
    A.registry.register('sharer', 'aycho-server-sharer', {
      id: 'aycho-server-sharer',
      order: 1,
      online: online,
      share: share,
      unshare: unshare,
      urlOf: urlOf
    });
  }
  if (A.ready) A.ready(register); else register();

  A.sharer = { share: share, unshare: unshare, urlOf: urlOf, online: online };
})();
