/* AYCHO module: js/st-settings | owner: C | contract: v1 */
/* 设置中心容器 + 7 页签路由 + 用户设置面板 */
(function () {
  "use strict";

  var A = window.AYCHO = window.AYCHO || {};

  /* ---------------- 基础适配层（A/B 未加载时不报错） ---------------- */
  function BUS() { return A.bus || { on: function () {}, off: function () {}, once: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {}, subscribe: function () { return function () {}; } }; }
  function get(p, d) { try { var v = ST().get(p); return v === undefined || v === null ? d : v; } catch (e) { return d; } }
  function set(p, v) { try { ST().set(p, v); if (typeof ST().save === "function") ST().save(); emit("state:change", { path: p }); } catch (e) {} }
  function emit(ev, pl) { try { BUS().emit(ev, pl); } catch (e) {} }
  function toast(text, type) {
    if (typeof A.toast === "function") { try { A.toast(text, type || "info"); return; } catch (e) {} }
    emit("toast", { text: text, type: type || "info" });
  }
  function onceBus(fn) {
    var n = 0;
    (function chk() {
      if (A.bus && typeof A.bus.on === "function") { try { fn(A.bus); } catch (e) {} return; }
      if (++n > 100) return;
      setTimeout(chk, 50);
    })();
  }

  /* ---------------- DOM 小工具 ---------------- */
  function h(tag, attrs) {
    var e = document.createElement(tag), k, v, i, c;
    attrs = attrs || {};
    for (k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class" || k === "className") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "style" && typeof v === "object") { for (var s in v) if (Object.prototype.hasOwnProperty.call(v, s)) e.style[s] = v[s]; }
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "value") e.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected" || k === "readOnly") e[k] = !!v;
      else e.setAttribute(k, v);
    }
    for (i = 2; i < arguments.length; i++) {
      c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) { for (var j = 0; j < c.length; j++) { var x = c[j]; if (x === null || x === undefined || x === false) continue; e.appendChild(typeof x === "object" ? x : document.createTextNode(String(x))); } }
      else e.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  function txt(s) { return document.createTextNode(s === null || s === undefined ? "" : String(s)); }

  var ICONS = {
    user: ["M4 20c0-3.4 3.6-5.2 8-5.2s8 1.8 8 5.2", "M12 11.2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
    key: ["M14.5 9.5a4.5 4.5 0 1 0-3.6 4.4L9 15.8H6.6v2.4H4.2v2.4H1.8"],
    sparkles: ["M12 3.2l1.7 4.4 4.4 1.7-4.4 1.7L12 15.4l-1.7-4.4L5.9 9.3l4.4-1.7z", "M18.4 15.2l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"],
    plug: ["M9 3v6M15 3v6", "M6 9h12v3.2a6 6 0 0 1-12 0z", "M12 18.2V21"],
    brain: ["M9.2 4a3.2 3.2 0 0 0-3.2 3.2 3 3 0 0 0-1 5.6v2.4A3.2 3.2 0 0 0 8.2 18.4h1z", "M14.8 4a3.2 3.2 0 0 1 3.2 3.2 3 3 0 0 1 1 5.6v2.4a3.2 3.2 0 0 1-3.2 3.2h-1z", "M12 4v14.4"],
    sliders: ["M4 7.5h9M17.5 7.5H20M4 16.5h4M12.5 16.5H20", "M15.5 5.4v4.2M10.5 14.4v4.2"],
    wrench: ["M15.2 3a5 5 0 0 0-4.4 7.2L4 17v3.2h3.2l6.8-6.8A5 5 0 0 0 21.2 9l-3 3-3.2-3.2 3-3A5 5 0 0 0 15.2 3z"],
    x: ["M6 6l12 12M18 6L6 18"],
    chevronLeft: ["M14.6 5.4L8 12l6.6 6.6"],
    chevronRight: ["M9.4 5.4L16 12l-6.6 6.6"],
    plus: ["M12 5v14M5 12h14"],
    trash: ["M4 7h16M9.5 7V4.6h5V7M6.4 7l1 13.4h9.2l1-13.4"],
    check: ["M4.5 12.6l5 5L19.6 7.4"],
    eye: ["M2.4 12S6 6.2 12 6.2 21.6 12 21.6 12 18 17.8 12 17.8 2.4 12 2.4 12z", "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"],
    eyeOff: ["M3 3l18 18", "M10.6 6.4A10 10 0 0 1 12 6.2c6 0 9.6 5.8 9.6 5.8a17.4 17.4 0 0 1-3.3 3.9M6.2 7.2A17 17 0 0 0 2.4 12s3.6 5.8 9.6 5.8a10 10 0 0 0 3.6-.7"],
    copy: ["M9 9h10.4v10.4H9z", "M4.6 15V4.6H15"],
    download: ["M12 3.4v11.6M7.4 10.6L12 15.2l4.6-4.6", "M4.6 20h14.8"],
    share: ["M4 12.4V20h16v-7.6", "M12 3v12.4", "M8 7l4-4 4 4"],
    external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
    link: ["M10 13.2a4.6 4.6 0 0 0 6.6 0l2-2a4.6 4.6 0 0 0-6.6-6.6l-1 1", "M14 10.8a4.6 4.6 0 0 0-6.6 0l-2 2a4.6 4.6 0 0 0 6.6 6.6l1-1"],
    upload: ["M12 20.4V8.8", "M7.4 13.4L12 8.8l4.6 4.6", "M4.6 4h14.8"],
    lock: ["M6.4 10.6V8a5.6 5.6 0 0 1 11.2 0v2.6", "M4.4 10.6h15.2v9.6H4.4z"],
    mail: ["M3.4 6h17.2v12H3.4z", "M3.4 6.8L12 13l8.6-6.2"],
    folder: ["M3.4 6.4h5.6l2 2h9.6v11H3.4z"],
    search: ["M10.6 4.2a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8z", "M15.4 15.4L20.4 20.4"],
    refresh: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 4v5h-5"],
    code: ["M9 8l-4 4 4 4M15 8l4 4-4 4"]
  };
  /* 始终返回 DOM 节点：A.icons.get 可能返回 HTML 字符串或节点，字符串仅经解析后取其首个元素，
     绝不把字符串当文本节点插入，避免图标被转义成源码显示 */
  function adoptIcon(node, size) {
    if (!node || node.nodeType !== 1) return null;
    if (!node.getAttribute("width")) node.setAttribute("width", size || 16);
    if (!node.getAttribute("height")) node.setAttribute("height", size || 16);
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("focusable", "false");
    return node;
  }
  function icon(name, size) {
    if (A.icons && typeof A.icons.get === "function") {
      try {
        var r = A.icons.get(name);
        if (r && r.nodeType === 1 && adoptIcon(r, size)) return r;
        if (typeof r === "string" && r) {
          var wrap = document.createElement("span");
          wrap.innerHTML = r;
          var got = adoptIcon(wrap.firstElementChild, size);
          if (got) return got;
        }
      } catch (e) {}
    }
    var d = ICONS[name] || ICONS.sparkles;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size || 16);
    svg.setAttribute("height", size || 16);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (var i = 0; i < d.length; i++) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", d[i]);
      svg.appendChild(p);
    }
    return svg;
  }

  /* ---------------- 面板注册 ---------------- */
  function registerPanel(id, def) {
    var list = A.__panels = A.__panels || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return;
    var p = { id: id, title: def.title, icon: def.icon, order: def.order || 100, mount: def.mount, unmount: def.unmount };
    list.push(p);
    if (typeof A.register === "function") { try { A.register("settings-panel", id, def); } catch (e) {} }
  }
  function panels() {
    var list = (A.__panels || []).slice();
    list.sort(function (a, b) { return (a.order || 100) - (b.order || 100); });
    return list;
  }

  /* ---------------- 容器 ---------------- */
  var layer = null, navEl = null, bodyEl = null, panelEl = null, titleEl = null, subEl = null;
  var activeId = null, activeInstance = null, lastFocus = null, keyHandler = null;

  function ensure() {
    if (layer) return true;
    var host = document.getElementById("ax-settings-host");
    if (!host) return false;

    layer = h("div", { class: "st-layer", role: "presentation" });
    var scrim = h("div", { class: "st-scrim", onclick: close });
    panelEl = h("section", {
      class: "st-panel", role: "dialog", "aria-modal": "true", "aria-label": "设置中心"
    });
    titleEl = h("h2", { class: "st-title", text: "设置" });
    subEl = h("span", { class: "st-head-sub", text: "AYCHO" });
    var head = h("header", { class: "st-head" },
      h("button", { class: "st-icon-btn st-back", type: "button", "aria-label": "返回主界面", title: "返回", onclick: close }, icon("chevronLeft", 18)),
      titleEl,
      subEl,
      h("button", { class: "st-icon-btn", type: "button", "aria-label": "关闭设置", title: "关闭", onclick: close }, icon("x", 18))
    );
    navEl = h("nav", { class: "st-nav", role: "tablist", "aria-label": "设置分类" });
    bodyEl = h("div", { class: "st-body", role: "tabpanel" });
    layer.appendChild(scrim);
    panelEl.appendChild(head);
    panelEl.appendChild(h("div", { class: "st-main" }, navEl, bodyEl));
    layer.appendChild(panelEl);
    host.appendChild(layer);
    return true;
  }

  function renderNav() {
    if (!navEl) return;
    while (navEl.firstChild) navEl.removeChild(navEl.firstChild);
    var list = panels();
    for (var i = 0; i < list.length; i++) {
      (function (p) {
        var btn = h("button", {
          class: "st-nav-item" + (p.id === activeId ? " st-active" : ""),
          type: "button", role: "tab", "data-id": p.id,
          "aria-selected": p.id === activeId ? "true" : "false",
          onclick: function () { show(p.id); }
        }, h("span", { class: "st-nav-ico" }, icon(p.icon, 16)), h("span", { class: "st-nav-label", text: p.title }));
        btn.setAttribute("tabindex", p.id === activeId ? "0" : "-1");
        navEl.appendChild(btn);
      })(list[i]);
    }
    if (!list.length) navEl.appendChild(h("div", { class: "st-hint", text: "暂无设置页" }));
  }

  function show(id) {
    var list = panels();
    if (!list.length) return;
    var def = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) def = list[i];
    if (!def) def = list[0];
    if (activeId === def.id && bodyEl.firstChild) { renderNav(); return; }
    if (activeInstance && typeof activeInstance.unmount === "function") { try { activeInstance.unmount(); } catch (e) {} }
    activeId = def.id;
    // 每个子页用独立标题（不再共用“设置中心”主标题）
    if (titleEl) titleEl.textContent = def.title || "设置";
    if (subEl) subEl.textContent = "AYCHO 设置";
    if (bodyEl) bodyEl.setAttribute("aria-label", def.title || "设置");
    if (panelEl) panelEl.setAttribute("aria-label", (def.title || "设置") + " · AYCHO");
    while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
    bodyEl.scrollTop = 0;
    var page = h("div", { class: "st-page" });
    page.setAttribute("data-panel", def.id);
    bodyEl.appendChild(page);
    activeInstance = def;
    renderNav();
    if (typeof def.mount === "function") { try { def.mount(page); } catch (e) { page.appendChild(h("div", { class: "st-error", text: "该页签渲染失败：" + (e && e.message || e) })); } }
  }

  function open(tab) {
    if (!ensure()) { toast("设置层挂载点不可用", "error"); return; }
    lastFocus = document.activeElement;
    renderNav();
    show(tab || activeId || (panels()[0] && panels()[0].id));
    layer.classList.add("st-open");
    if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
    keyHandler = function (e) {
      if (e.key === "Escape") {
        if (document.querySelector(".st-modal.st-open")) return;
        e.stopPropagation(); close(); return;
      }
      var t = e.target;
      if (!navEl || !t || !navEl.contains(t)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var items = navEl.querySelectorAll(".st-nav-item");
        var idx = Array.prototype.indexOf.call(items, t);
        if (idx < 0) { return; }
        var next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        if (items[next]) { items[next].focus(); }
      } else if (e.key === "Enter" || e.key === " ") {
        if (t.classList && t.classList.contains("st-nav-item")) { e.preventDefault(); t.click(); }
      }
    };
    document.addEventListener("keydown", keyHandler, true);
    setTimeout(function () {
      var first = navEl && navEl.querySelector(".st-nav-item.st-active");
      if (first) first.focus();
    }, 60);
  }

  var closing = false;   // 重入守卫：close() 会广播 settings:close，订阅者可能再次请求关闭 → 防递归爆栈
  function close() {
    if (!layer || closing) return;
    closing = true;
    try {
      if (activeInstance && typeof activeInstance.unmount === "function") { try { activeInstance.unmount(); } catch (e) {} }
      layer.classList.remove("st-open");
      activeInstance = null;
      activeId = null;
      if (bodyEl) while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
      if (keyHandler) { document.removeEventListener("keydown", keyHandler, true); keyHandler = null; }
      emit("settings:close", {});
      if (lastFocus && typeof lastFocus.focus === "function") { try { lastFocus.focus(); } catch (e) {} }
      lastFocus = null;
    } finally {
      closing = false;
    }
  }

  /* ---------------- 校验 / 强度 ---------------- */
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "")); }

  function strengthOf(pw) {
    pw = String(pw || "");
    if (typeof A.handlePasswordStrength === "function") {
      try {
        var r = A.handlePasswordStrength(pw);
        if (r && typeof r.score === "number") return r;
      } catch (e) {}
    }
    var checks = {
      length: pw.length >= 8,
      lower: /[a-z]/.test(pw),
      upper: /[A-Z]/.test(pw),
      digit: /[0-9]/.test(pw),
      symbol: /[^A-Za-z0-9]/.test(pw)
    };
    var base = (checks.length ? 1 : 0) + (checks.lower ? 1 : 0) + (checks.upper ? 1 : 0) + (checks.digit ? 1 : 0);
    var score = base;
    if (base >= 4 && checks.symbol && pw.length >= 10) score = 4;
    else if (base >= 4) score = 3;
    return { score: Math.max(0, Math.min(4, score)), checks: checks };
  }
  var LEVELS = [
    { name: "弱", color: "var(--ax-danger,#f87171)", w: 0.25 },
    { name: "弱", color: "var(--ax-danger,#f87171)", w: 0.32 },
    { name: "一般", color: "var(--ax-warn,#fbbf24)", w: 0.58 },
    { name: "强", color: "var(--ax-accent,#7c9cff)", w: 0.8 },
    { name: "极强", color: "var(--ax-ok,#34d399)", w: 1 }
  ];

  function buildStrength() {
    var fill = h("div", { class: "st-strength-fill" });
    var label = h("span", { class: "st-strength-label", text: "密码强度：—" });
    var track = h("div", { class: "st-strength-track" }, fill);
    var checks = h("div", { class: "st-strength-checks" });
    var box = h("div", { class: "st-strength" },
      h("div", { class: "st-strength-head" }, label, h("span", { class: "st-strength-label", text: "需含数字 + 大写 + 小写，≥8 位" })),
      track, checks
    );
    var names = [["length", "≥8 位"], ["lower", "小写"], ["upper", "大写"], ["digit", "数字"], ["symbol", "符号+"]];
    var dots = {};
    for (var i = 0; i < names.length; i++) {
      var d = h("span", { class: "st-check-dot" });
      var el = h("span", { class: "st-check" }, d, txt(names[i][1]));
      dots[names[i][0]] = el;
      checks.appendChild(el);
    }
    function update(pw) {
      var r = strengthOf(pw);
      var lv = LEVELS[Math.max(0, Math.min(4, r.score))];
      fill.style.transform = "scaleX(" + (pw ? lv.w : 0) + ")";
      fill.style.backgroundColor = lv.color;
      label.textContent = "密码强度：" + (pw ? lv.name : "—");
      label.style.color = pw ? lv.color : "";
      for (var k in dots) if (Object.prototype.hasOwnProperty.call(dots, k)) dots[k].classList.toggle("st-check", true), dots[k].classList.toggle("st-pass", !!r.checks[k]);
    }
    update("");
    return { el: box, update: update, valid: function (pw) { var c = strengthOf(pw).checks; return c.length && c.lower && c.upper && c.digit; } };
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove("st-shake");
    void el.offsetWidth;
    el.classList.add("st-shake");
  }

  function fieldErr(holder, msg) {
    holder.textContent = msg || "";
    if (msg) shake(holder);
  }

  /* ---------------- 计数按钮 ---------------- */
  function countdownBtn(btn, secs, base) {
    var left = secs, timer = null;
    btn.disabled = true;
    btn.textContent = base + "（" + left + "s）";
    timer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "重新发送"; return; }
      btn.textContent = base + "（" + left + "s）";
    }, 1000);
    return function stop() { clearInterval(timer); btn.disabled = false; btn.textContent = "重新发送"; };
  }

  /* ---------------- 后端网关 ---------------- */
  function apiBase() {
    var c = A.config || {};
    return String(c.apiBase || c.authEndpoint || "").replace(/\/+$/, "");
  }

  function post(path, body) {
    /* 已连接后端：走统一网关（自动带 Bearer 令牌、统一错误） */
    if (A.api && typeof A.api.available === "function" && A.api.available() && typeof A.api.request === "function") {
      return A.api.request("POST", path, body || {});
    }
    return fetch(apiBase() + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.message || ("请求失败 " + r.status));
        return j;
      });
    });
  }

  function sendCode(email, btn, base, scene) {
    if (A.api && typeof A.api.auth === "object" && A.api.auth.sendCode) {
      return A.api.auth.sendCode(email, scene || "change").then(function (j) {
        countdownBtn(btn, 60, base);
        return j;
      });
    }
    return post("/api/auth/send-code", { email: email, scene: scene || "change" }).then(function (j) { countdownBtn(btn, 60, base); return j; });
  }

  /* ---------------- 用户设置面板 ---------------- */
  function userPanel(root) {
    var user = get("user", {}) || {};

    /* --- 头像 --- */
    var file = h("input", { type: "file", accept: "image/*", style: { display: "none" } });
    var avImg = user.avatar ? h("img", { src: user.avatar, alt: "头像" }) : null;
    var av = h("div", { class: "st-avatar st-avatar-lg", role: "button", tabindex: "0", "aria-label": "更换头像" }, avImg || txt((user.name || "A").slice(0, 1).toUpperCase()));
    av.addEventListener("click", function () { file.click(); });
    av.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast("请选择图片文件", "error"); return; }
      if (f.size > 5 * 1024 * 1024) { toast("图片过大，请选择 5MB 以内的图片", "error"); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var url = String(fr.result || "");
        var img = new Image();
        img.onload = function () {
          var size = 256, cv = document.createElement("canvas");
          cv.width = size; cv.height = size;
          var ctx = cv.getContext("2d");
          var s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          var out = cv.toDataURL("image/jpeg", 0.86);
          set("user.avatar", out);
          renderAvatar(out);
          toast("头像已更新", "ok");
        };
        img.onerror = function () { set("user.avatar", url); renderAvatar(url); toast("头像已更新", "ok"); };
        img.src = url;
      };
      fr.onerror = function () { toast("读取图片失败", "error"); };
      fr.readAsDataURL(f);
      file.value = "";
    });
    function renderAvatar(src) {
      while (av.firstChild) av.removeChild(av.firstChild);
      if (src) av.appendChild(h("img", { src: src, alt: "头像" }));
      else av.appendChild(txt((get("user.name", "A") || "A").slice(0, 1).toUpperCase()));
    }

    var nameInput = h("input", { class: "st-input", type: "text", maxlength: "32", value: user.name || "", placeholder: "1–32 个字符" });
    var nameErr = h("div", { class: "st-error" });
    var nameCard = h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "头像与昵称" })),
      h("div", { class: "st-row" },
        av,
        h("div", { class: "st-grow" },
          h("div", { class: "st-field" },
            h("label", { class: "st-label", text: "用户名" }),
            nameInput,
            h("div", { class: "st-hint", text: "用于对话与分享页署名；空白或超长都会被拒绝" }),
            nameErr
          )
        )
      ),
      h("div", { class: "st-row st-row-wrap" },
        h("button", {
          class: "st-btn st-primary", type: "button", onclick: function () {
            var v = nameInput.value.trim();
            if (!v) { fieldErr(nameErr, "用户名不能为空"); nameInput.classList.add("st-invalid"); return; }
            if (v.length > 32) { fieldErr(nameErr, "用户名不能超过 32 个字符"); nameInput.classList.add("st-invalid"); return; }
            nameInput.classList.remove("st-invalid"); fieldErr(nameErr, "");
            set("user.name", v);
            toast("用户名已保存", "ok");
          }
        }, icon("check", 15), txt("保存用户名")),
        h("button", {
          class: "st-btn st-ghost", type: "button", onclick: function () {
            set("user.avatar", "");
            renderAvatar("");
            toast("头像已移除", "ok");
          }
        }, icon("trash", 15), txt("移除头像"))
      ),
      file
    );

    /* --- 邮箱 --- */
    var curEmail = user.email || "未绑定邮箱";
    var newEmail = h("input", { class: "st-input", type: "email", placeholder: "新邮箱地址", autocomplete: "off" });
    var codeInput = h("input", { class: "st-input", type: "text", inputmode: "numeric", maxlength: "6", placeholder: "6 位验证码" });
    var mailErr = h("div", { class: "st-error" });
    var sendBtn = h("button", { class: "st-btn", type: "button" }, txt("发送验证码"));
    var verifyBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("校验并修改"));
    var mailForm = h("div", { class: "st-card", hidden: true },
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "新邮箱" }), newEmail),
      h("div", { class: "st-field" },
        h("label", { class: "st-label", text: "验证码" }),
        h("div", { class: "st-row" }, h("div", { class: "st-grow" }, codeInput), sendBtn)
      ),
      mailErr,
      h("div", { class: "st-row" }, verifyBtn,
        h("button", { class: "st-btn st-ghost", type: "button", onclick: function () { mailForm.hidden = true; fieldErr(mailErr, ""); } }, txt("取消")))
    );
    var mailCard = h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "邮箱" })),
      h("div", { class: "st-field" },
        h("label", { class: "st-label", text: "当前邮箱" }),
        h("div", { class: "st-val", text: curEmail }),
        h("div", { class: "st-hint", text: "验证码将发送至新邮箱" })
      ),
      h("button", { class: "st-btn", type: "button", onclick: function () { mailForm.hidden = !mailForm.hidden; if (!mailForm.hidden) newEmail.focus(); } }, icon("mail", 15), txt("修改邮箱")),
      mailForm
    );
    sendBtn.addEventListener("click", function () {
      var v = newEmail.value.trim();
      if (!isEmail(v)) { fieldErr(mailErr, "请输入合法的邮箱地址"); newEmail.classList.add("st-invalid"); return; }
      newEmail.classList.remove("st-invalid"); fieldErr(mailErr, "验证码已发送（60 秒内有效）");
      sendCode(v, sendBtn, "重新发送", "change").catch(function (e) { fieldErr(mailErr, "发送失败：" + (e && e.message || e)); });
    });
    verifyBtn.addEventListener("click", function () {
      var v = newEmail.value.trim(), c = codeInput.value.trim();
      if (!isEmail(v)) { fieldErr(mailErr, "请输入合法的邮箱地址"); return; }
      if (!/^\d{6}$/.test(c)) { fieldErr(mailErr, "验证码为 6 位数字"); shake(codeInput); return; }
      function done() {
        set("user.email", v);
        toast("邮箱已更新为 " + v, "ok");
        mailForm.hidden = true;
        var badge = mailCard.querySelector(".st-val");
        if (badge) badge.textContent = v;
      }
      verifyBtn.disabled = true;
      post("/api/auth/change-email", { email: v, code: c }).then(function (j) {
        if (j && j.user && j.user.email) set("user.email", j.user.email);
        done();
      })
        .catch(function (e) { fieldErr(mailErr, "校验失败：" + (e && e.message || e)); })
        .then(function () { verifyBtn.disabled = false; });
    });

    /* --- 密码 --- */
    var oldPw = h("input", { class: "st-input", type: "password", placeholder: "当前密码", autocomplete: "current-password" });
    var newPw = h("input", { class: "st-input", type: "password", placeholder: "新密码", autocomplete: "new-password" });
    var newPw2 = h("input", { class: "st-input", type: "password", placeholder: "确认新密码", autocomplete: "new-password" });
    var pwErr = h("div", { class: "st-error" });
    var str = buildStrength();
    function eyeWrap(input) {
      var btn = h("button", { class: "st-suffix", type: "button", "aria-label": "显示/隐藏密码", title: "显示/隐藏" }, icon("eye", 16));
      btn.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        btn.appendChild(icon(show ? "eyeOff" : "eye", 16));
      });
      return h("div", { class: "st-input-wrap" }, input, btn);
    }
    newPw.addEventListener("input", function () { str.update(newPw.value); });

    var pwMailNew = h("input", { class: "st-input", type: "password", placeholder: "新密码", autocomplete: "new-password" });
    var pwMailCode = h("input", { class: "st-input", type: "text", inputmode: "numeric", maxlength: "6", placeholder: "邮箱验证码" });
    var pwMailSend = h("button", { class: "st-btn", type: "button" }, txt("发送验证码"));
    var pwMailErr = h("div", { class: "st-error" });
    var str2 = buildStrength();
    pwMailNew.addEventListener("input", function () { str2.update(pwMailNew.value); });

    var paneOld = h("div", {},
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "当前密码" }), eyeWrap(oldPw)),
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "新密码" }), eyeWrap(newPw), str.el),
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "确认新密码" }), eyeWrap(newPw2)),
      pwErr,
      h("button", {
        class: "st-btn st-primary", type: "button", onclick: function () {
          if (!oldPw.value) { fieldErr(pwErr, "请输入当前密码"); return; }
          if (!str.valid(newPw.value)) { fieldErr(pwErr, "新密码需 ≥8 位且同时包含数字、大写、小写"); shake(newPw); return; }
          if (newPw.value !== newPw2.value) { fieldErr(pwErr, "两次输入的新密码不一致"); shake(newPw2); return; }
          fieldErr(pwErr, "");
          post("/api/auth/change-password", { oldPassword: oldPw.value, newPassword: newPw.value })
            .then(function () { toast("密码已修改", "ok"); oldPw.value = newPw.value = newPw2.value = ""; str.update(""); })
            .catch(function (e) { fieldErr(pwErr, e && e.message || "修改失败"); });
        }
      }, txt("保存新密码"))
    );
    var paneMail = h("div", { hidden: true },
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "验证码" }),
        h("div", { class: "st-row" }, h("div", { class: "st-grow" }, pwMailCode), pwMailSend)),
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "新密码" }), eyeWrap(pwMailNew), str2.el),
      pwMailErr,
      h("button", {
        class: "st-btn st-primary", type: "button", onclick: function () {
          if (!/^\d{6}$/.test(pwMailCode.value.trim())) { fieldErr(pwMailErr, "验证码为 6 位数字"); shake(pwMailCode); return; }
          if (!str2.valid(pwMailNew.value)) { fieldErr(pwMailErr, "新密码需 ≥8 位且同时包含数字、大写、小写"); shake(pwMailNew); return; }
          fieldErr(pwMailErr, "");
          post("/api/auth/reset-password", { email: get("user.email", ""), code: pwMailCode.value.trim(), password: pwMailNew.value })
            .then(function (j) {
              if (j && j.token && A.api && A.api.setToken) A.api.setToken(j.token);   // 重置会踢下线，用新令牌续期
              toast("密码已重置", "ok"); pwMailCode.value = pwMailNew.value = ""; str2.update("");
            })
            .catch(function (e) { fieldErr(pwMailErr, e && e.message || "重置失败"); });
        }
      }, txt("保存新密码"))
    );
    pwMailSend.addEventListener("click", function () {
      var em = get("user.email", "");
      if (!isEmail(em)) { fieldErr(pwMailErr, "账号邮箱不可用，请先在「邮箱」卡片中绑定"); return; }
      sendCode(em, pwMailSend, "重新发送", "reset").catch(function (e) { fieldErr(pwMailErr, "发送失败：" + (e && e.message || e)); });
    });

    var mode = "old";
    var bOld = h("button", { class: "st-seg-btn st-on", type: "button" }, txt("当前密码"));
    var bMail = h("button", { class: "st-seg-btn", type: "button" }, txt("邮箱验证"));
    function setMode(m) {
      mode = m;
      bOld.classList.toggle("st-on", m === "old");
      bMail.classList.toggle("st-on", m === "mail");
      paneOld.hidden = m !== "old";
      paneMail.hidden = m !== "mail";
    }
    bOld.addEventListener("click", function () { setMode("old"); });
    bMail.addEventListener("click", function () { setMode("mail"); });

    var pwCard = h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "密码" }),
        h("div", { class: "st-seg" }, bOld, bMail)),
      h("div", { class: "st-card-desc", text: "两条路径：① 校验当前密码后直接设置；② 邮箱验证码校验通过后设置。强度实时计算。" }),
      paneOld, paneMail
    );

    root.appendChild(nameCard);
    root.appendChild(mailCard);
    root.appendChild(pwCard);
  }

  /* ---------------- 设置总览（/settings/ 直达的大入口页） ---------------- */
  function overviewPanel(page) {
    page.appendChild(h("div", { class: "st-card", style: { marginBottom: "12px" } },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "设置中心" })),
      h("div", { class: "st-card-desc", text: "AYCHO 的全部设置分区。点任意一项进入对应分区，各分区都是独立可直达的地址。" })
    ));
    var grid = h("div", { class: "st-ov-grid" });
    var list = panels();
    for (var i = 0; i < list.length; i++) {
      (function (p) {
        if (p.id === "home") return;
        var item = h("button", { class: "st-ov-item", type: "button", "aria-label": p.title, onclick: function () { show(p.id); } },
          h("span", { class: "st-ov-ico" }, icon(p.icon || "box", 17)),
          h("span", { class: "st-ov-txt" }, h("b", { text: p.title || p.id }), h("span", { class: "st-ov-sub", text: "设置 · AYCHO" })),
          h("span", { class: "st-ov-arrow", text: "›" })
        );
        grid.appendChild(item);
      })(list[i]);
    }
    page.appendChild(grid);
  }

  /* ---------------- 注册 ---------------- */
  registerPanel("home", { title: "设置中心", icon: "settings", order: 1, mount: overviewPanel, unmount: function () {} });
  registerPanel("user", { title: "用户设置", icon: "user", order: 10, mount: userPanel, unmount: function () {} });

  /* ---------------- 对外接口 + 事件 ---------------- */
  A.settings = { open: open, close: close, show: show, panels: panels };

  onceBus(function (b) {
    b.on("settings:open", function (p) { open(p && p.tab); });
    b.on("settings:close", function () { close(); });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { ensure(); });
  else ensure();
})();
