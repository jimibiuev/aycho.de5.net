/* AYCHO module: js/st-general | owner: C | contract: v1 */
/* 通用设置：语言 / 标题 / Enter 行为 / 字号 / 密度 / 行号 / 侧边栏 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {} }; }
  function get(p, d) { try { var v = ST().get(p); return v === undefined || v === null ? d : v; } catch (e) { return d; } }
  function set(p, v) { try { ST().set(p, v); if (typeof ST().save === "function") ST().save(); emit("state:change", { path: p }); } catch (e) {} }
  function emit(ev, pl) { try { BUS().emit(ev, pl); } catch (e) {} }
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
  function registerPanel(id, def) {
    var list = A.__panels = A.__panels || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return;
    list.push({ id: id, title: def.title, icon: def.icon, order: def.order || 100, mount: def.mount, unmount: def.unmount });
    if (typeof A.register === "function") { try { A.register("settings-panel", id, def); } catch (e) {} }
  }
  function sw(on, label, onToggle) {
    var b = h("button", { class: "st-switch" + (on ? " st-on" : ""), type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label });
    b.addEventListener("click", function () {
      var v = !b.classList.contains("st-on");
      b.classList.toggle("st-on", v);
      b.setAttribute("aria-checked", v ? "true" : "false");
      onToggle(v);
    });
    return b;
  }
  function applyLive() {
    try {
      var r = document.documentElement;
      r.style.setProperty("--ax-font-size", get("settings.general.fontSize", 14) + "px");
      r.setAttribute("data-ax-density", get("settings.general.density", "normal"));
    } catch (e) {}
  }

  function generalPanel(root) {
    var g = get("settings.general", {}) || {};
    var ui = get("ui", {}) || {};

    /* 语言 */
    var lang = h("select", { class: "st-input st-select" });
    [["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["en-US", "English"]].forEach(function (o) {
      var op = h("option", { value: o[0], text: o[1] });
      if ((g.language || "zh-CN") === o[0]) op.selected = true;
      lang.appendChild(op);
    });
    lang.addEventListener("change", function () { set("settings.general.language", lang.value); toast("语言已切换", "ok"); });

    /* 密度 */
    var density = g.density || "normal";
    var dBtns = {};
    var dSeg = h("div", { class: "st-seg" });
    [["compact", "紧凑"], ["normal", "标准"], ["cozy", "宽松"]].forEach(function (o) {
      var b = h("button", { class: "st-seg-btn" + (density === o[0] ? " st-on" : ""), type: "button" }, txt(o[1]));
      b.addEventListener("click", function () {
        density = o[0];
        for (var k in dBtns) if (Object.prototype.hasOwnProperty.call(dBtns, k)) dBtns[k].classList.toggle("st-on", k === density);
        set("settings.general.density", density);
        applyLive();
      });
      dBtns[o[0]] = b;
      dSeg.appendChild(b);
    });

    /* 字号 */
    var sizeVal = g.fontSize || 14;
    var sizeOut = h("span", { class: "st-tag", text: sizeVal + "px" });
    var range = h("input", { class: "st-range", type: "range", min: "12", max: "18", step: "1", value: String(sizeVal), "aria-label": "界面字号" });
    var preview = h("div", { class: "st-preview", text: "预览：AYCHO 让自动化触手可及。" });
    function paintSize(v) {
      sizeOut.textContent = v + "px";
      preview.style.fontSize = v + "px";
      document.documentElement.style.setProperty("--ax-font-size", v + "px");
    }
    range.addEventListener("input", function () { paintSize(Number(range.value)); });
    range.addEventListener("change", function () { set("settings.general.fontSize", Number(range.value)); applyLive(); });
    paintSize(sizeVal);

    var rows = h("div", { class: "st-list" });
    rows.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "自动生成对话标题" }), h("div", { class: "st-item-desc", text: "每轮对话后自动用一句话概括并命名当前会话" })),
      h("div", { class: "st-item-actions" }, sw(g.autoTitle !== false, "自动生成对话标题", function (v) { set("settings.general.autoTitle", v); }))));
    rows.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "Enter 发送 / Shift+Enter 换行" }), h("div", { class: "st-item-desc", text: "关闭后 Enter 换行，需用 Ctrl/Cmd + Enter 发送" })),
      h("div", { class: "st-item-actions" }, sw(g.enterToSend !== false, "Enter 发送", function (v) { set("settings.general.enterToSend", v); }))));
    rows.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "显示行号" }), h("div", { class: "st-item-desc", text: "代码块与源码态预览显示行号" })),
      h("div", { class: "st-item-actions" }, sw(g.showLineNumbers !== false, "显示行号", function (v) { set("settings.general.showLineNumbers", v); }))));
    rows.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "默认展开右侧边栏" }), h("div", { class: "st-item-desc", text: "进入对话时自动打开预览侧边栏" })),
      h("div", { class: "st-item-actions" }, sw(ui.rightOpen === true, "默认展开右侧边栏", function (v) { set("ui.rightOpen", v); }))));

    /* ---------------- 工作区（用户要求：选了就不再重复问，默认工作区固定） ---------------- */
    var ws = get("workspace", {}) || {};
    var wsDir = h("input", { class: "st-input", type: "text", value: ws.dir || "/sdcard", placeholder: "/sdcard 或 /sdcard/Download", spellcheck: "false", style: { width: "100%", marginTop: "6px" } });
    var wsAsk = sw(ws.ask !== false, "每次新对话都询问工作区", function (v) {
      ws.ask = v; set("workspace", ws); toast(v ? "已开启：每次新对话询问工作区" : "已关闭：直接沿用默认工作区，不再询问", "ok");
    });
    var wsApply = h("button", { class: "st-btn st-primary", type: "button", style: { whiteSpace: "nowrap" } }, txt("设为默认工作区"));
    wsApply.addEventListener("click", function () {
      ws.dir = String(wsDir.value || "/sdcard").trim() || "/sdcard";
      ws.ask = false;  /* 一旦设了默认就不再问 */
      set("workspace", ws);
      toast("默认工作区已设为 " + ws.dir + "，新对话将直接沿用", "ok");
      emit("workspace:change", ws);
    });
    wsDir.addEventListener("change", function () { ws.dir = wsDir.value; set("workspace", ws); });
    rows.appendChild(h("div", { class: "st-item st-item-col" },
      h("div", { class: "st-row st-row-top" },
        h("div", { class: "st-item-main" },
          h("strong", { class: "st-item-title", text: "工作区目录" }),
          h("div", { class: "st-item-desc", text: "只允许 /sdcard 及其子目录或你自己的目录；设了默认后新对话不再询问，并按工作区分组。" }),
          wsDir),
        h("div", { class: "st-item-actions" }, wsApply)),
      h("div", { class: "st-row" },
        h("div", { class: "st-item-main" },
          h("strong", { class: "st-item-title", text: "询问开关" }),
          h("div", { class: "st-item-desc", text: "关闭后，所有新对话直接使用上方默认工作区" })),
        wsAsk)));

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "界面与交互" })),
      h("div", { class: "st-row st-row-wrap" },
        h("div", { class: "st-grow", style: { minWidth: "180px" } },
          h("div", { class: "st-field" }, h("label", { class: "st-label", text: "语言" }), lang)),
        h("div", { class: "st-grow", style: { minWidth: "180px" } },
          h("div", { class: "st-field" }, h("label", { class: "st-label", text: "界面密度" }), dSeg))),
      h("div", { class: "st-field" },
        h("label", { class: "st-label", text: "界面字号（12–18px）" }), sizeOut,
        range, h("div", { class: "st-hint", text: "实时预览，松开后即刻生效并落库" }), preview)));
    root.appendChild(rows);

    /* ---------------- 后端网关（静态托管可手填公网后端） ---------------- */
    var gwState = h("span", { class: "st-tag", text: "检测中" });
    var gwInfo = h("div", { class: "st-hint", text: "同源打开时自动连接；部署在 GitHub Pages 等静态托管时，把网关公网地址填到这里即可启用真实登录 / 对话 / 终端 / 分享。" });
    var gwInput = h("input", { class: "st-input", type: "url", placeholder: "https://你的后端域名（留空则用当前站点同源）", spellcheck: "false", autocomplete: "off" });
    var gwSave = h("button", { class: "st-btn", type: "button" }, txt("保存并连接"));
    var gwClear = h("button", { class: "st-btn", type: "button" }, txt("清除地址"));

    function paintGw() {
      var online = !!(A.api && A.api.available && A.api.available());
      var base = "";
      try { base = (A.api && A.api.base) ? A.api.base() : ""; } catch (e) { base = ""; }
      gwState.textContent = online ? "已连接" : "未连接";
      gwState.className = "st-tag" + (online ? " st-ok" : "");
      if (base) gwInput.value = base;
      gwInfo.textContent = online
        ? "当前网关：" + base + "，登录 / 对话 / 终端 / 分享已启用。"
        : "填入公网网关地址即可启用云端功能。";
    }
    function connect(url) {
      if (!A.api || typeof A.api.setBase !== "function") { toast("当前版本不支持切换网关", "warn"); return; }
      gwSave.disabled = true;
      A.api.setBase(url).then(function (r) {
        gwSave.disabled = false;
        paintGw();
        var ok = !!(r && r.online);
        toast(ok ? "已连接后端" : ("连接失败：" + ((r && r.reason) || "不可达")), ok ? "ok" : "warn");
      }).catch(function (e) {
        gwSave.disabled = false;
        toast("连接失败：" + ((e && e.message) || ""), "warn");
      });
    }
    gwSave.addEventListener("click", function () { connect(String(gwInput.value || "").trim()); });
    gwClear.addEventListener("click", function () { gwInput.value = ""; connect(""); });

    var offGw = null;
    if (A.bus && A.bus.on) offGw = A.bus.on("api:ready", function () { paintGw(); });
    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "后端网关" }), gwState),
      h("div", { class: "st-field" }, h("label", { class: "st-label", text: "网关地址" }), gwInput, gwInfo),
      h("div", { class: "st-row" }, gwSave, gwClear)));
    paintGw();
    A.__generalGwOff = offGw;

    /* ---------------- 多端同步（真实后端快照） ---------------- */
    var syncState = h("span", { class: "st-tag", text: "未连接" });
    var syncInfo = h("div", { class: "st-hint", text: "登录同一账号后，会话 / 产出物 / 设置 / 记忆会自动同步到其它设备。" });
    var btnNow = h("button", { class: "st-btn", type: "button" }, txt("立即上传"));
    var btnPull = h("button", { class: "st-btn", type: "button" }, txt("从云端拉取"));

    function paintSync(s) {
      s = s || {};
      var map = { off: "同步未开启", idle: "云端暂无快照", syncing: "同步中…", ok: "已同步", error: "同步失败" };
      if (!(A.api && A.api.available && A.api.available())) s.status = "off";
      if (s.status === "idle" && !ready()) s.status = "off";
      syncState.textContent = map[s.status] || "未知";
      syncState.className = "st-tag" + (s.status === "ok" ? " st-ok" : (s.status === "error" ? " st-err" : ""));
      if (s.status === "off") syncInfo.textContent = "登录同一账号后即可开启同步。";
      else if (s.status === "error") syncInfo.textContent = "同步失败：" + (s.message || "请稍后重试");
      else if (s.at || s.rev) syncInfo.textContent = "最近同步：" + new Date(s.at || Date.now()).toLocaleString() + (s.rev ? "（版本 " + s.rev + "）" : "");
      else syncInfo.textContent = "登录同一账号后，会话 / 产出物 / 设置 / 记忆会自动同步到其它设备。";
    }
    function ready() { return !!(A.api && A.api.available && A.api.available() && A.api.token && A.api.token()); }
    function refresh() {
      if (!ready() || !A.sync) { paintSync({ status: "off" }); return; }
      A.sync.status().then(function (st) {
        paintSync(st && st.exists ? { status: "idle", rev: st.rev, at: st.updatedAt } : { status: "idle" });
      }).catch(function (e) { paintSync({ status: "error", message: (e && e.message) || "" }); });
    }
    btnNow.addEventListener("click", function () {
      if (!ready()) { toast("请先登录账号并连接后端", "warn"); return; }
      btnNow.disabled = true;
      (A.sync ? A.sync.now() : Promise.resolve(false)).then(function (ok) {
        btnNow.disabled = false;
        toast(ok === false ? "上传未完成，请检查后端连接" : "已上传到云端", ok === false ? "warn" : "ok");
        refresh();
      });
    });
    btnPull.addEventListener("click", function () {
      if (!ready()) { toast("请先登录账号并连接后端", "warn"); return; }
      btnPull.disabled = true;
      A.sync.pull().then(function (ok) {
        btnPull.disabled = false;
        toast(ok === false ? "云端暂无更新" : "已拉取云端工作台", ok === false ? "warn" : "ok");
        refresh();
      });
    });

    var offSync = null;
    if (A.bus && A.bus.on) {
      offSync = A.bus.on("sync:state", function (s) { paintSync(s || {}); });
    }
    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "多端同步" }), syncState),
      h("div", { class: "st-item" },
        h("div", { class: "st-item-main" },
          h("strong", { class: "st-item-title", text: "自动同步工作台" }),
          h("div", { class: "st-item-desc", text: "本地改动 2.5 秒后自动推送；模型密钥永不上传" })),
        h("div", { class: "st-item-actions" }, sw(g.syncEnabled !== false, "自动同步", function (v) {
          set("settings.general.syncEnabled", v);
          toast(v ? "已开启自动同步" : "已关闭自动同步", "ok");
        }))),
      syncInfo,
      h("div", { class: "st-row" }, btnNow, btnPull)));
    refresh();
    A.__generalSyncOff = offSync;

    applyLive();
  }

  registerPanel("general", { title: "通用设置", icon: "sliders", order: 60, mount: generalPanel, unmount: function () {
    if (typeof A.__generalSyncOff === "function") { try { A.__generalSyncOff(); } catch (e) {} A.__generalSyncOff = null; }
    if (typeof A.__generalGwOff === "function") { try { A.__generalGwOff(); } catch (e) {} A.__generalGwOff = null; }
  } });
})();
