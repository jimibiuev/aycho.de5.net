/* AYCHO module: js/st-memory | owner: C | contract: v1 */
/* 记忆：列表 / 搜索 / 自动记忆开关 / 清空 / 从当前对话生成 */
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
  function uid() {
    if (A.util && typeof A.util.uid === "function") { try { return A.util.uid(); } catch (e) {} }
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
  function fmt(t) {
    if (!t) return "—";
    if (A.util && typeof A.util.fmtTime === "function") { try { return A.util.fmtTime(t); } catch (e) {} }
    var d = new Date(t);
    if (isNaN(d.getTime())) return String(t);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function convTitle(id) {
    var cs = get("conversations", []) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i] && cs[i].id === id) return cs[i].title || cs[i].name || "未命名对话";
    return id ? "对话 " + String(id).slice(0, 6) : "未知来源";
  }
  function save(list) { set("memories", list); }

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

  function memoryPanel(root) {
    var list = (get("memories", []) || []).slice();
    var q = "";
    var box = h("div", { class: "st-list" });

    function paint() {
      while (box.firstChild) box.removeChild(box.firstChild);
      var arr = list.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      if (q) {
        var k = q.toLowerCase();
        arr = arr.filter(function (m) {
          return String(m.text || "").toLowerCase().indexOf(k) >= 0 ||
            (m.tags || []).join(" ").toLowerCase().indexOf(k) >= 0;
        });
      }
      if (!arr.length) {
        box.appendChild(h("div", { class: "st-empty" },
          h("div", { class: "st-empty-title", text: q ? "没有匹配的记忆" : "还没有记忆" }),
          h("div", { text: q ? "换个关键词试试，或清空搜索框" : "开启「自动记忆」后，对话中的关键事件会沉淀到这里" })));
        return;
      }
      arr.forEach(function (m) {
        var tags = h("div", { class: "st-tags" });
        (m.tags || []).forEach(function (t) { tags.appendChild(h("span", { class: "st-tag", text: String(t) })); });
        box.appendChild(h("div", { class: "st-item" },
          h("div", { class: "st-item-main" },
            h("div", { class: "st-memo-text", text: m.text || "（空记忆）" }),
            h("div", { class: "st-row st-row-wrap st-meta" },
              h("span", { class: "st-tag", text: convTitle(m.convId) }),
              h("span", { class: "st-hint", text: fmt(m.createdAt) })),
            tags),
          h("div", { class: "st-item-actions" },
            h("button", {
              class: "st-icon-btn", type: "button", "aria-label": "删除记忆", title: "删除记忆",
              onclick: function () {
                var i = list.indexOf(m);
                if (i >= 0) { list.splice(i, 1); save(list); paint(); toast("已删除该条记忆", "ok"); }
              }
            }, txt("×")))
        ));
      });
    }

    var search = h("input", { class: "st-input", type: "search", placeholder: "搜索记忆内容或标签" });
    search.addEventListener("input", function () { q = search.value.trim(); paint(); });

    var auto = get("settings.general.autoMemory", true) !== false;
    var autoSw = h("button", { class: "st-switch" + (auto ? " st-on" : ""), type: "button", role: "switch", "aria-checked": auto ? "true" : "false", "aria-label": "自动记忆" });
    autoSw.addEventListener("click", function () {
      var v = !autoSw.classList.contains("st-on");
      autoSw.classList.toggle("st-on", v);
      autoSw.setAttribute("aria-checked", v ? "true" : "false");
      set("settings.general.autoMemory", v);
      toast(v ? "已开启自动记忆" : "已关闭自动记忆", "info");
    });

    var genBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("从当前对话生成记忆"));
    genBtn.addEventListener("click", function () {
      var convId = get("activeConversationId", "");
      var all = get("messages", {}) || {};
      var msgs = convId && all[convId] ? all[convId] : null;
      if (!msgs || !msgs.length) {
        var keys = Object.keys(all);
        if (keys.length) { convId = keys[keys.length - 1]; msgs = all[convId]; }
      }
      if (!msgs || !msgs.length) { toast("当前没有可用对话内容", "error"); return; }
      var picked = msgs.slice(-4).map(function (m) {
        var c = typeof m === "string" ? m : (m && (m.content || m.text)) || "";
        return String(c).replace(/\s+/g, " ").trim();
      }).filter(Boolean);
      var text = picked.join(" ／ ");
      if (text.length > 140) text = text.slice(0, 140) + "…";
      if (!text) { toast("对话内容为空，无法生成", "error"); return; }
      var memo = { id: uid(), text: text, tags: ["自动", "对话摘要"], createdAt: Date.now(), convId: convId };
      list.push(memo);
      save(list);
      paint();
      toast("已生成 1 条记忆", "ok");
    });

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" },
        h("h3", { class: "st-card-title", text: "记忆库" }),
        h("span", { class: "st-tag", text: list.length + " 条" })),
      h("div", { class: "st-row st-row-wrap" }, h("div", { class: "st-grow" }, search), genBtn),
      h("div", { class: "st-row" },
        h("div", { class: "st-grow" }, h("div", { class: "st-label", text: "自动记忆" }), h("div", { class: "st-hint", text: "开启后，每次对话事件会被精简成一条记忆写入这里" })),
        autoSw,
        h("button", {
          class: "st-btn st-danger", type: "button", onclick: function () {
            if (!list.length) { toast("记忆库已是空的", "info"); return; }
            var host = (root.closest && root.closest(".st-panel")) || document.body;
            confirmBox(host, "清空全部记忆？", "将永久删除全部 " + list.length + " 条记忆，此操作不可撤销。", "确认清空", function () {
              list = [];
              save(list);
              paint();
              toast("已清空全部记忆", "ok");
            });
          }
        }, txt("清空全部")))));
    root.appendChild(box);
    paint();
  }

  registerPanel("memory", { title: "记忆", icon: "brain", order: 50, mount: memoryPanel, unmount: function () {} });
})();
