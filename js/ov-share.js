/* AYCHO module: js/ov-share | owner: C | contract: v1 */
/* 分享浮层：链接生成 / 复制 / 停止；对外暴露 AYCHO.share={create,stop,list,resolve}
   监听事件：artifact:share{id} / artifact:unshare{id} / share:create{id} / share:stop{slug}
   说明：slug 为 base62 随机 10 位；链接形如 <origin>/#/s/<slug>；刷新后仍可由 localStorage 解析 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {} }; }
  function get(p, d) { try { var v = ST().get(p); return v === undefined || v === null ? d : v; } catch (e) { return d; } }
  function set(p, v) { try { ST().set(p, v); if (typeof ST().save === "function") ST().save(); emit("state:change", { path: p }); } catch (e) {} }
  function emit(ev, pl) { try { BUS().emit(ev, pl); } catch (e) {} }
  function on(ev, fn) { try { BUS().on(ev, fn); } catch (e) {} }
  function toast(t, ty) {
    if (typeof A.toast === "function") { try { A.toast(t, ty || "info"); return; } catch (e) {} }
    emit("toast", { text: t, type: ty || "info" });
  }
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v, i, c, j;
    attrs = attrs || {};
    for (k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style" && typeof v === "object") { for (var s in v) if (Object.prototype.hasOwnProperty.call(v, s)) e.style[s] = v[s]; }
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") e.value = v;
      else if (k === "checked" || k === "disabled" || k === "hidden") e[k] = !!v;
      else e.setAttribute(k, v);
    }
    for (i = 2; i < arguments.length; i++) {
      c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) { for (j = 0; j < c.length; j++) { var x = c[j]; if (x === null || x === undefined || x === false) continue; e.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); } }
      else e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function txt(s) { return document.createTextNode(s == null ? "" : String(s)); }
  function uid() {
    if (A.util && typeof A.util.uid === "function") { try { return A.util.uid(); } catch (e) {} }
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  var B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  function slug() {
    var out = "", i, n;
    try {
      var buf = new Uint8Array(10);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      for (i = 0; i < 10; i++) out += B62.charAt(buf[i] % 62);
      return out;
    } catch (e) {
      for (i = 0; i < 10; i++) { n = Math.floor(Math.random() * 62); out += B62.charAt(n); }
      return out;
    }
  }
  function copy(text) {
    if (A.util && typeof A.util.copy === "function") {
      try { var r = A.util.copy(text); if (r && typeof r.then === "function") return r; return Promise.resolve(true); } catch (e) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta); res(true);
      } catch (e) { rej(e); }
    });
  }
  function linkOf(sg) {
    var origin = location.origin || (location.protocol + "//" + location.host);
    return origin + "/#/s/" + sg;
  }

  /* ---------- store 读写 ---------- */
  function items() {
    var it = get("share.items", []);
    return Array.isArray(it) ? it.slice() : [];
  }
  function persist(arr) {
    set("share.items", arr);
    set("share.enabled", arr.length > 0);
    if (arr.length) { set("share.slug", arr[arr.length - 1].slug); set("share.url", arr[arr.length - 1].url); }
    else { set("share.slug", ""); set("share.url", ""); }
  }
  function findArtifact(id) {
    var arr = get("artifacts", []) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
    return null;
  }
  function setArtifactShare(id, url) {
    var arr = get("artifacts", []);
    if (!Array.isArray(arr)) return;
    var changed = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === id) { arr[i].shareUrl = url || ""; changed = true; }
    }
    if (changed) set("artifacts", arr);
  }

  /* ---------- 服务端真实分享（跨设备可达） ---------- */
  function api() { return (A.api && typeof A.api.available === "function" && A.api.available()) ? A.api : null; }
  function remoteCreate(item) {
    var a = api();
    if (!a || !a.share) return;
    a.share.create({
      artifactId: item.artifactId, name: item.name, content: item.content,
      mime: item.mime || "", createdAt: item.createdAt
    }).then(function (r) {
      if (!r || !r.slug) return;
      var arr = items(), i;
      for (i = 0; i < arr.length; i++) {
        if (arr[i].artifactId === item.artifactId) {
          arr[i].slug = r.slug;
          arr[i].url = r.url || linkOf(r.slug);
          arr[i].remote = true;
        }
      }
      persist(arr);
      setArtifactShare(item.artifactId, r.url || linkOf(r.slug));
      var fresh = null, a2 = items();
      for (i = 0; i < a2.length; i++) if (a2[i].artifactId === item.artifactId) fresh = a2[i];
      if (fresh) {
        if (cur && cur.artifactId === item.artifactId) openItem(fresh);
        emit("share:synced", fresh);
        toast("分享已发布到服务端，任意设备可访问", "ok");
      }
    })["catch"](function (e) {
      toast("服务端分享失败，已保留本机链接：" + (e && e.message ? e.message : "未知错误"), "warn");
    });
  }
  function remoteStop(sg) {
    var a = api();
    if (!a || !a.share) return;
    a.share.stop(sg)["catch"](function () {});
  }
  function remoteFetch(sg) {
    var a = api();
    if (!a || !a.share) return Promise.resolve(null);
    return a.share.get(sg).then(function (r) {
      if (!r || r.error) return null;
      var rec = {
        slug: r.slug || sg, artifactId: r.artifactId || "", name: r.name || "分享内容",
        content: r.content || "", mime: r.mime || "text/plain",
        createdAt: r.createdAt || Date.now(), url: location.origin + "/#/s/" + (r.slug || sg),
        remote: true
      };
      var arr = items(), i, hit = false;
      for (i = 0; i < arr.length; i++) if (arr[i].slug === sg) { arr[i] = rec; hit = true; }
      if (!hit) arr.push(rec);
      persist(arr);
      return rec;
    })["catch"](function () { return null; });
  }

  /* ---------- 浮层 ---------- */
  var layer = null, card = null, linkText = null, badge = null, cur = null, lastFocus = null;

  function ensure() {
    if (layer) return;
    var host = document.getElementById("ax-overlay-host") || document.body;
    layer = h("div", { class: "ov-layer" });
    layer.setAttribute("data-ov", "share");
    card = h("div", { class: "ov-share", role: "dialog", "aria-modal": "true", "aria-label": "分享" });
    linkText = h("span", { class: "ov-link-text", text: "" });
    badge = h("span", { class: "ov-badge", text: "永久有效" });

    var copyBtn = h("button", { class: "ov-btn ov-primary", type: "button" }, txt("复制"));
    copyBtn.addEventListener("click", function () {
      if (!cur) return;
      copy(cur.url).then(function () { toast("链接已复制", "ok"); })
        .catch(function () { toast("复制失败，请手动长按选择链接", "error"); });
    });
    var openBtn = h("button", {
      class: "ov-btn", type: "button", onclick: function () { if (cur) window.open(cur.url, "_blank", "noopener"); }
    }, txt("打开"));
    var stopBtn = h("button", { class: "ov-btn ov-danger", type: "button" }, txt("停止分享"));
    stopBtn.addEventListener("click", function () {
      if (!cur) return;
      confirmStop(stopBtn, function () {
        A.share.stop(cur.slug);
      });
    });

    card.appendChild(h("div", { class: "ov-share-head" },
      h("h4", { class: "ov-share-title", text: "分享链接" }),
      badge,
      h("button", { class: "ov-btn", type: "button", onclick: close }, txt("关闭"))));
    card.appendChild(h("div", { class: "ov-share-body" },
      h("div", { class: "ov-link" }, linkText, copyBtn, openBtn),
      h("div", { class: "ov-share-note" },
        txt("已连接后端：内容快照写入服务端，换设备/换浏览器打开同一链接即可读取。"),
        h("br"),
        txt("关闭网页 ≠ 关闭分享：只要不点「停止分享」，链接一直有效。"),
        h("br"),
        txt("点「停止分享」后，服务端记录即刻删除，链接立即失效且不可恢复。")),
      h("div", { class: "ov-share-note", text: "链接形如 /#/s/<slug>。" })));
    card.appendChild(h("div", { class: "ov-share-foot" },
      stopBtn, h("div", { class: "ov-grow" }),
      h("button", { class: "ov-btn", type: "button", onclick: close }, txt("完成"))));

    layer.appendChild(h("div", { class: "ov-scrim", onclick: close }));
    layer.appendChild(card);
    host.appendChild(layer);
    document.addEventListener("keydown", onKey, false);
  }
  function confirmStop(anchor, onOk) {
    var box = card.querySelector(".ov-confirm");
    if (box) return;
    box = h("div", { class: "ov-share-foot ov-confirm" },
      h("div", { class: "ov-share-note", text: "停止后该链接立即失效，且不可恢复。" }),
      h("div", { class: "ov-grow" }),
      h("button", { class: "ov-btn", type: "button", onclick: function () { if (box.parentNode) box.parentNode.removeChild(box); } }, txt("取消")),
      h("button", { class: "ov-btn ov-danger", type: "button", onclick: function () { if (box.parentNode) box.parentNode.removeChild(box); onOk(); } }, txt("确认停止")));
    card.appendChild(box);
    anchor.disabled = box ? false : false;
  }
  function onKey(e) {
    if (e.key === "Escape" && layer && layer.classList.contains("ov-open")) { e.stopPropagation(); close(); }
  }
  function openItem(item) {
    ensure();
    cur = item;
    linkText.textContent = item.url;
    linkText.title = item.url;
    badge.className = "ov-badge" + (item.dead ? " ov-dead" : "");
    badge.textContent = item.dead ? "已失效" : "永久有效";
    lastFocus = document.activeElement;
    requestAnimationFrame(function () { layer.classList.add("ov-open"); });
  }
  function close() {
    if (!layer) return;
    layer.classList.remove("ov-open");
    cur = null;
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
  }

  /* ---------- 对外 API ---------- */
  var API = {
    create: function (artifactId) {
      var art = findArtifact(artifactId) || {};
      var arr = items();
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].artifactId === artifactId) { openItem(arr[i]); return arr[i]; }
      }
      var sg = slug(), u = linkOf(sg);
      var item = {
        slug: sg,
        artifactId: artifactId || (art.id || uid()),
        content: (art.content !== undefined ? art.content : (art.text !== undefined ? art.text : (art.dataUrl || ""))),
        name: art.name || art.title || "未命名文件",
        createdAt: Date.now(),
        url: u
      };
      arr.push(item);
      persist(arr);
      setArtifactShare(item.artifactId, u);
      openItem(item);
      emit("share:create", { slug: sg, url: u, artifactId: item.artifactId });
      remoteCreate(item);
      toast("分享链接已生成", "ok");
      return item;
    },
    stop: function (sg) {
      var arr = items(), hit = null, rest = [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].slug === sg) hit = arr[i]; else rest.push(arr[i]);
      }
      if (!hit) { toast("未找到该分享链接", "error"); return false; }
      if (hit.remote) remoteStop(sg);
      persist(rest);
      setArtifactShare(hit.artifactId, "");
      emit("share:stop", { slug: sg });
      toast("已停止分享，链接立即失效", "ok");
      if (cur && cur.slug === sg) { if (badge) { badge.className = "ov-badge ov-dead"; badge.textContent = "已失效"; } close(); }
      return true;
    },
    list: function () { return items(); },
    fetch: function (sg) { return remoteFetch(sg); },
    resolve: function (sg) {
      var arr = items();
      for (var i = 0; i < arr.length; i++) if (arr[i].slug === sg) return arr[i];
      return null;
    }
  };
  A.share = API;

  on("artifact:share", function (p) {
    var id = p && (p.id || p.artifactId);
    if (!id) return;
    API.create(id);
  });
  on("artifact:unshare", function (p) {
    var id = p && (p.id || p.artifactId), arr = items();
    for (var i = 0; i < arr.length; i++) if (arr[i].artifactId === id) { API.stop(arr[i].slug); return; }
  });
  on("share:create", function (p) { if (p && p.slug && !cur) API.create(p.artifactId || p.id); });
  on("share:stop", function (p) { if (p && p.slug) API.stop(p.slug); });
})();
