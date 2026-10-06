/* AYCHO module: js/st-advanced | owner: C | contract: v1 */
/* 高级设置：数值参数 / 开关 / 数据导出导入清除 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {}, export: null }; }
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
  function download(name, content, mime) {
    if (A.util && typeof A.util.download === "function") {
      try { A.util.download(name, content, mime || "application/json"); return true; } catch (e) {}
    }
    try {
      var blob = new Blob([content], { type: mime || "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return true;
    } catch (e) { return false; }
  }
  function confirmBox(host, title, desc, okText, onOk) {
    var modal = h("div", { class: "st-modal" },
      h("div", { class: "st-modal-card st-modal-sm", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "st-modal-head" }, h("h4", { class: "st-modal-title", text: title })),
        h("div", { class: "st-modal-body" }, h("div", { class: "st-card-desc", text: desc })),
        h("div", { class: "st-modal-foot" }, h("div", { class: "st-grow" }),
          h("button", { class: "st-btn st-ghost", type: "button", onclick: function () { close(); } }, txt("取消")),
          h("button", { class: "st-btn st-danger", type: "button", onclick: function () { close(); onOk(); } }, txt(okText))))
    );
    host.appendChild(modal);
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } }
    function close() {
      document.removeEventListener("keydown", onKey, true);
      modal.classList.remove("st-open");
      setTimeout(function () { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 220);
    }
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(function () { modal.classList.add("st-open"); });
  }

  function numberRow(label, desc, path, min, max, step, unit) {
    var cur = Number(get(path, min));
    if (isNaN(cur)) cur = min;
    var out = h("span", { class: "st-tag", text: cur + (unit || "") });
    var range = h("input", { class: "st-range", type: "range", min: String(min), max: String(max), step: String(step), value: String(cur), "aria-label": label });
    var num = h("input", { class: "st-input st-input-num", type: "number", min: String(min), max: String(max), step: String(step), value: String(cur), "aria-label": label + " 数值" });
    function apply(v, commit) {
      v = Number(v);
      if (isNaN(v)) return;
      v = Math.min(max, Math.max(min, v));
      range.value = String(v);
      num.value = String(v);
      out.textContent = v + (unit || "");
      if (commit) set(path, v);
    }
    range.addEventListener("input", function () { apply(range.value, false); });
    range.addEventListener("change", function () { var v = get(path, cur); apply(range.value, true); if (v !== Number(range.value)) emit(path + ":change", { value: Number(range.value) }); });
    num.addEventListener("change", function () { apply(num.value, true); });
    return h("div", { class: "st-item" },
      h("div", { class: "st-item-main" },
        h("div", { class: "st-row" }, h("strong", { class: "st-item-title", text: label }), out),
        h("div", { class: "st-item-desc", text: desc }),
        h("div", { class: "st-row", style: { marginTop: "8px" } }, h("div", { class: "st-grow" }, range), num)),
      h("div", { class: "st-item-actions" }));
  }

  function advancedPanel(root) {
    var a = get("settings.advanced", {}) || {};
    var box = h("div", { class: "st-list" });

    box.appendChild(numberRow("最大轮次", "单次任务最多允许的推理/工具调用轮数，过高会显著增加耗时与费用", "settings.advanced.maxTurns", 1, 50, 1));
    box.appendChild(numberRow("Temperature", "0 更确定、2 更发散；日常问答建议 0.2–0.7", "settings.advanced.temperature", 0, 2, 0.1));
    box.appendChild(numberRow("Top P", "概率质量采样阈值，与 Temperature 二选一调整即可", "settings.advanced.topP", 0, 1, 0.05));
    box.appendChild(numberRow("流式速度倍率", "仅影响本地渲染节奏，不改变模型真实速度", "settings.advanced.streamSpeed", 0.5, 4, 0.1, "×"));
    box.appendChild(numberRow("并发数", "同时执行的任务数量上限，过高可能导致内存与网络拥塞", "settings.advanced.concurrency", 1, 8, 1));

    box.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "沙箱模式" }), h("div", { class: "st-item-desc", text: "限制文件与网络访问范围，仅允许在会话工作目录内读写" })),
      h("div", { class: "st-item-actions" }, sw(a.sandbox !== false, "沙箱模式", function (v) { set("settings.advanced.sandbox", v); toast(v ? "已开启沙箱" : "已关闭沙箱，请谨慎操作", v ? "ok" : "error"); }))));
    box.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "允许 shell" }), h("div", { class: "st-item-desc", text: "允许执行系统命令。关闭后只能读写文件，无法执行不可逆的破坏性命令" })),
      h("div", { class: "st-item-actions" }, sw(a.allowShell === true, "允许 shell", function (v) { set("settings.advanced.allowShell", v); toast(v ? "已允许 shell（风险提升）" : "已禁用 shell", v ? "error" : "ok"); }))));
    box.appendChild(h("div", { class: "st-item" },
      h("div", { class: "st-item-main" }, h("strong", { class: "st-item-title", text: "遥测" }), h("div", { class: "st-item-desc", text: "匿名上报崩溃与性能数据，不含对话内容" })),
      h("div", { class: "st-item-actions" }, sw(a.telemetry !== false, "遥测", function (v) { set("settings.advanced.telemetry", v); }))));

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "运行参数" }),
        h("span", { class: "st-tag", text: "即时生效" })),
      h("div", { class: "st-card-desc", text: "以下参数直接作用于下一次请求；每个数值项均显示当前值与作用说明。" })));
    root.appendChild(box);

    /* 数据管理 */
    var fileI = h("input", { type: "file", accept: ".json,application/json", style: { display: "none" } });
    fileI.addEventListener("change", function () {
      var f = fileI.files && fileI.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var data;
        try { data = JSON.parse(String(fr.result || "")); } catch (e) { toast("导入失败：不是合法的 JSON", "error"); return; }
        if (!data || typeof data !== "object") { toast("导入失败：内容结构不正确", "error"); return; }
        if (typeof ST().set === "function") { ST().set(data); if (typeof ST().save === "function") ST().save(); }
        else { for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) set(k, data[k]); }
        emit("state:change", { path: "*" });
        toast("数据已导入，请刷新页面查看", "ok");
      };
      fr.onerror = function () { toast("读取文件失败", "error"); };
      fr.readAsText(f);
      fileI.value = "";
    });

    var host = (root.closest && root.closest(".st-panel")) || document.body;

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "数据" })),
      h("div", { class: "st-card-desc", text: "全部数据存放在浏览器 localStorage（key: aycho.state.v1），不上传服务器。" }),
      h("div", { class: "st-row st-row-wrap" },
        h("button", {
          class: "st-btn", type: "button", onclick: function () {
            var data;
            if (typeof ST().export === "function") { try { data = ST().export(); } catch (e) {} }
            if (!data) {
              data = {};
              ["authed", "user", "conversations", "activeConversationId", "messages", "providers", "activeModelId", "reasoning", "thinking", "agents", "activeAgentIds", "skills", "mcps", "memories", "artifacts", "projectFiles", "share", "ui", "settings"].forEach(function (k) { data[k] = get(k, null); });
            }
            var ok = download("aycho-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(data, null, 2), "application/json");
            toast(ok ? "已导出全部数据" : "导出失败", ok ? "ok" : "error");
          }
        }, txt("导出全部数据（JSON）")),
        h("button", { class: "st-btn", type: "button", onclick: function () { fileI.click(); } }, txt("导入数据")),
        fileI,
        h("div", { class: "st-grow" }),
        h("button", {
          class: "st-btn st-danger", type: "button", onclick: function () {
            confirmBox(host, "清除所有数据？", "将清空账号、对话、服务商、技能、MCP、记忆、分享链接等全部本地数据，并恢复初始状态。此操作不可撤销。", "确认清除", function () {
              confirmBox(host, "再次确认", "最后一次确认：清除后所有本地内容不可恢复。", "确认清除全部数据", function () {
                try {
                  if (typeof ST().reset === "function") ST().reset();
                  else {
                    ["authed", "user", "conversations", "activeConversationId", "messages", "providers", "agents", "skills", "mcps", "memories", "artifacts", "projectFiles", "share"].forEach(function (k) { set(k, null); });
                  }
                  if (typeof ST().save === "function") ST().save();
                } catch (e) {}
                try { localStorage.removeItem("aycho.state.v1"); } catch (e) {}
                toast("已清除全部数据", "ok");
              });
            });
          }
        }, txt("清除所有数据")))));
  }

  registerPanel("advanced", { title: "高级设置", icon: "wrench", order: 70, mount: advancedPanel, unmount: function () {} });
})();
