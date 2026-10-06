/* AYCHO module: js/st-api | owner: C | contract: v1 */
/* API 配置：服务商 / 模型 / 从 API 拉取可用模型 */
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
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; } }
  function registerPanel(id, def) {
    var list = A.__panels = A.__panels || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return;
    list.push({ id: id, title: def.title, icon: def.icon, order: def.order || 100, mount: def.mount, unmount: def.unmount });
    if (typeof A.register === "function") { try { A.register("settings-panel", id, def); } catch (e) {} }
  }

  /* ---------- 数据 ---------- */
  function blankProvider() { return { id: uid(), name: "新服务商", baseUrl: "", keyRef: "", note: "", models: [] }; }
  function norm(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (p) {
      return {
        id: p && p.id || uid(),
        name: (p && p.name) || "",
        baseUrl: (p && p.baseUrl) || "",
        keyRef: (p && p.keyRef) || "",
        note: (p && p.note) || "",
        models: Array.isArray(p && p.models) ? p.models.map(function (m) {
          return { id: (m && m.id) || "", label: (m && m.label) || "", enabled: !(m && m.enabled === false) };
        }) : []
      };
    });
  }
  function modelsUrl(base) {
    var b = String(base || "").trim().replace(/\/+$/, "");
    if (!b) return "";
    if (/\/models$/.test(b)) return b;
    return b + "/models";
  }

  function fetchModels(p) {
    var url = modelsUrl(p.baseUrl);
    if (!url) return Promise.reject(new Error("请先填写 Base URL"));
    if (!p.keyRef) return Promise.reject(new Error("请先填写 API Key"));
    return fetch(url, { headers: { Authorization: "Bearer " + p.keyRef, Accept: "application/json" } })
      .then(function (r) {
        if (r.status === 401) throw new Error("401：API Key 无效或未授权，请检查 Key 是否完整、是否已过期");
        if (r.status === 403) throw new Error("403：Key 无权访问该资源（可能未开通对应权限或额度耗尽）");
        if (r.status === 404) throw new Error("404：接口不存在，请确认 Base URL 是否为 https://<host>/v1");
        if (r.status === 429) throw new Error("429：请求过于频繁，已被限流，请稍后重试");
        if (!r.ok) throw new Error("请求失败 " + r.status + " " + (r.statusText || ""));
        return r.json();
      })
      .then(function (j) {
        var raw = [];
        if (Array.isArray(j)) raw = j;
        else if (j && Array.isArray(j.data)) raw = j.data;
        else if (j && Array.isArray(j.models)) raw = j.models;
        var out = [];
        for (var i = 0; i < raw.length; i++) {
          var m = raw[i];
          var id = typeof m === "string" ? m : (m && (m.id || m.name || m.model));
          if (id) out.push({ id: String(id), label: String((m && (m.label || m.display_name)) || id) });
        }
        if (!out.length) throw new Error("接口返回成功但未解析到任何模型（期望 { data: [{ id }] }）");
        return out;
      })
      .catch(function (e) {
        if (e instanceof TypeError) {
          throw new Error("网络错误 / CORS 被拦截：无法访问 " + url + "。请确认地址可达，且该服务商允许浏览器直连（多数国内服务默认禁止跨域）。");
        }
        throw e;
      });
  }

  /* ---------- 面板 ---------- */
  function apiPanel(root) {
    var draft = norm(get("providers", []));
    var dirty = false;

    var listBox = h("div", { class: "st-list" });
    var errBox = h("div", { class: "st-error" });

    function markDirty() { dirty = true; }

    function render() {
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      if (!draft.length) {
        listBox.appendChild(h("div", { class: "st-empty" },
          h("div", { class: "st-empty-title", text: "还没有服务商" }),
          h("div", { text: "点击下方「添加服务商」，填入 Base URL 与 API Key 即可接入" })));
        return;
      }
      draft.forEach(function (p, idx) { listBox.appendChild(card(p, idx)); });
    }

    function card(p) {
      var nameI = h("input", { class: "st-input", type: "text", value: p.name, placeholder: "服务商名称，如 智谱 / OpenAI" });
      var urlI = h("input", { class: "st-input", type: "url", value: p.baseUrl, placeholder: "https://api.openai.com/v1", spellcheck: "false" });
      var keyI = h("input", { class: "st-input", type: "password", value: p.keyRef, placeholder: "sk-...", spellcheck: "false", autocomplete: "off" });
      var noteI = h("input", { class: "st-input", type: "text", value: p.note, placeholder: "备注（可选）" });
      var eye = h("button", { class: "st-suffix", type: "button", "aria-label": "显示/隐藏 Key", title: "显示 / 隐藏" }, txt("显示"));
      eye.addEventListener("click", function () {
        var show = keyI.type === "password";
        keyI.type = show ? "text" : "password";
        eye.textContent = show ? "隐藏" : "显示";
      });
      nameI.addEventListener("input", function () { p.name = nameI.value; markDirty(); });
      urlI.addEventListener("input", function () { p.baseUrl = urlI.value.trim(); markDirty(); });
      keyI.addEventListener("input", function () { p.keyRef = keyI.value; markDirty(); });
      noteI.addEventListener("input", function () { p.note = noteI.value; markDirty(); });

      var modelBox = h("div", { class: "st-list" });
      function renderModels() {
        while (modelBox.firstChild) modelBox.removeChild(modelBox.firstChild);
        if (!p.models.length) {
          modelBox.appendChild(h("div", { class: "st-hint", text: "尚未添加模型，可手动添加或从 API 拉取" }));
          return;
        }
        p.models.forEach(function (m, i) {
          var idI = h("input", { class: "st-input", type: "text", value: m.id, placeholder: "模型 ID，如 gpt-4o-mini" });
          var lbI = h("input", { class: "st-input", type: "text", value: m.label, placeholder: "显示名" });
          idI.addEventListener("input", function () { m.id = idI.value.trim(); markDirty(); });
          lbI.addEventListener("input", function () { m.label = lbI.value; markDirty(); });
          var sw = h("button", { class: "st-switch" + (m.enabled ? " st-on" : ""), type: "button", role: "switch", "aria-checked": m.enabled ? "true" : "false", "aria-label": "启用模型" });
          sw.addEventListener("click", function () {
            m.enabled = !m.enabled;
            sw.classList.toggle("st-on", m.enabled);
            sw.setAttribute("aria-checked", m.enabled ? "true" : "false");
            markDirty();
          });
          modelBox.appendChild(h("div", { class: "st-item" },
            h("div", { class: "st-item-main" },
              h("div", { class: "st-row" }, h("div", { class: "st-grow" }, idI), h("div", { class: "st-grow" }, lbI)),
              h("div", { class: "st-hint", text: m.enabled ? "已启用" : "已停用" })
            ),
            h("div", { class: "st-item-actions" },
              sw,
              h("button", {
                class: "st-icon-btn", type: "button", "aria-label": "删除模型", title: "删除模型", onclick: function () { p.models.splice(i, 1); markDirty(); renderModels(); }
              }, txt("×")))
          ));
        });
      }
      renderModels();

      var fetchBtn = h("button", { class: "st-btn", type: "button" }, txt("从 API 中获取可用模型"));

      function openPicker(models, fromDemo) {
        var chosen = {};
        var selectedCount = h("span", { class: "st-hint" });
        var search = h("input", { class: "st-input", type: "search", placeholder: "搜索模型 ID" });
        var rows = h("div", { class: "st-picklist" });
        var boxes = [];
        function paint() {
          var q = search.value.trim().toLowerCase();
          for (var i = 0; i < boxes.length; i++) {
            var b = boxes[i];
            b.row.hidden = q ? b.name.toLowerCase().indexOf(q) < 0 : false;
          }
          var n = 0;
          for (var k in chosen) if (Object.prototype.hasOwnProperty.call(chosen, k) && chosen[k]) n++;
          selectedCount.textContent = "已选 " + n + " / " + models.length;
        }
        models.forEach(function (m) {
          var cb = h("input", { type: "checkbox" });
          cb.addEventListener("change", function () { chosen[m.id] = cb.checked; paint(); });
          var row = h("label", { class: "st-pick" }, cb, h("span", { class: "st-pick-label", text: m.id }), h("span", { class: "st-hint", text: m.label === m.id ? "" : m.label }));
          rows.appendChild(row);
          boxes.push({ row: row, name: m.id });
        });
        search.addEventListener("input", paint);

        var modal = h("div", { class: "st-modal" },
          h("div", { class: "st-modal-card", role: "dialog", "aria-modal": "true", "aria-label": "选择模型" },
            h("div", { class: "st-modal-head" },
              h("h4", { class: "st-modal-title", text: "选择要导入的模型" }),
              selectedCount,
              h("button", { class: "st-icon-btn", type: "button", "aria-label": "关闭", onclick: function () { closeM(); } }, txt("×"))),
            h("div", { class: "st-modal-body" },
              h("div", { class: "st-row" }, h("div", { class: "st-grow" }, search),
                h("button", {
                  class: "st-btn", type: "button", onclick: function () {
                    var q = search.value.trim().toLowerCase();
                    boxes.forEach(function (b) {
                      if (q && b.name.toLowerCase().indexOf(q) < 0) return;
                      chosen[b.name] = true;
                      var cb = b.row.querySelector("input"); if (cb) cb.checked = true;
                    });
                    paint();
                  }
                }, txt("全选")),
                h("button", {
                  class: "st-btn", type: "button", onclick: function () {
                    var q = search.value.trim().toLowerCase();
                    boxes.forEach(function (b) {
                      if (q && b.name.toLowerCase().indexOf(q) < 0) return;
                      chosen[b.name] = false;
                      var cb = b.row.querySelector("input"); if (cb) cb.checked = false;
                    });
                    paint();
                  }
                }, txt("取消全选"))),
              rows),
            h("div", { class: "st-modal-foot" },
              h("div", { class: "st-grow" }),
              h("button", { class: "st-btn st-ghost", type: "button", onclick: function () { closeM(); } }, txt("取消")),
              h("button", {
                class: "st-btn st-primary", type: "button", onclick: function () {
                  var added = 0;
                  var exists = {};
                  p.models.forEach(function (m) { exists[m.id] = true; });
                  for (var k in chosen) {
                    if (!Object.prototype.hasOwnProperty.call(chosen, k) || !chosen[k]) continue;
                    if (exists[k]) continue;
                    p.models.push({ id: k, label: k, enabled: true });
                    added++;
                  }
                  markDirty();
                  renderModels();
                  closeM();
                  toast("已添加 " + added + " 个模型", "ok");
                }
              }, txt("确认添加")))
          )
        );
        var host = (root.closest && root.closest(".st-panel")) || document.body;
        host.appendChild(modal);
        function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeM(); } }
        function closeM() {
          document.removeEventListener("keydown", onKey, true);
          modal.classList.remove("st-open");
          setTimeout(function () { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 220);
        }
        document.addEventListener("keydown", onKey, true);
        requestAnimationFrame(function () { modal.classList.add("st-open"); });
        setTimeout(function () { search.focus(); }, 40);
        paint();
      }

      fetchBtn.addEventListener("click", function () {
        if (!p.baseUrl) { showErr("请先填写该服务商的 Base URL"); urlI.focus(); return; }
        if (!p.keyRef) { showErr("请先填写该服务商的 API Key"); keyI.focus(); return; }
        showErr("");
        fetchBtn.disabled = true;
        fetchBtn.textContent = "拉取中…";
        fetchModels(p).then(function (models) {
          fetchBtn.disabled = false; fetchBtn.textContent = "从 API 中获取可用模型";
          openPicker(models, false);
        }).catch(function (e) {
          fetchBtn.disabled = false; fetchBtn.textContent = "从 API 中获取可用模型";
          showErr(String(e && e.message || e));
        });
      });

      function showErr(msg) {
        errBox.textContent = "";
        if (!msg) return;
        errBox.appendChild(txt(msg));
        errBox.classList.remove("st-shake"); void errBox.offsetWidth; errBox.classList.add("st-shake");
      }

      return h("div", { class: "st-card" },
        h("div", { class: "st-card-head" },
          h("h3", { class: "st-card-title", text: p.name || "未命名服务商" }),
          h("button", {
            class: "st-btn st-danger", type: "button", onclick: function () {
              var i = draft.indexOf(p);
              if (i >= 0) { draft.splice(i, 1); markDirty(); render(); }
            }
          }, txt("删除服务商"))),
        h("div", { class: "st-row st-row-wrap" },
          h("div", { class: "st-grow", style: { minWidth: "200px" } }, h("div", { class: "st-field" }, h("label", { class: "st-label", text: "名称" }), nameI)),
          h("div", { class: "st-grow", style: { minWidth: "200px" } }, h("div", { class: "st-field" }, h("label", { class: "st-label", text: "备注" }), noteI))
        ),
        h("div", { class: "st-field" }, h("label", { class: "st-label", text: "Base URL" }), urlI,
          h("div", { class: "st-hint", text: "OpenAI 兼容地址，通常以 /v1 结尾；将请求 {Base URL}/models" })),
        h("div", { class: "st-field" }, h("label", { class: "st-label", text: "API Key" }),
          h("div", { class: "st-input-wrap" }, keyI, eye),
          h("div", { class: "st-hint", text: "Key 仅存本地（localStorage），不会上传到任何服务器" })),
        h("div", { class: "st-card-head", style: { marginTop: "6px" } },
          h("h3", { class: "st-card-title", text: "模型" }),
          h("span", { class: "st-tag", text: p.models.length + " 个" })),
        modelBox,
        h("div", { class: "st-row st-row-wrap", style: { marginTop: "10px" } },
          h("button", {
            class: "st-btn", type: "button", onclick: function () { p.models.push({ id: "", label: "", enabled: true }); markDirty(); renderModels(); }
          }, txt("手动添加模型")),
          fetchBtn),
        errBox
      );
    }

    var addBtn = h("button", {
      class: "st-btn st-primary", type: "button", onclick: function () { draft.unshift(blankProvider()); markDirty(); render(); }
    }, txt("添加服务商"));

    var saveBtn = h("button", {
      class: "st-btn st-primary", type: "button", onclick: function () {
        var clean = [];
        for (var i = 0; i < draft.length; i++) {
          var p = draft[i];
          if (!p.name && !p.baseUrl && !p.keyRef && !p.models.length) continue;
          var ms = [];
          for (var j = 0; j < p.models.length; j++) if (p.models[j].id) ms.push(p.models[j]);
          clean.push({ id: p.id, name: p.name || "未命名服务商", baseUrl: p.baseUrl, keyRef: p.keyRef, note: p.note, models: ms });
        }
        set("providers", clean);
        draft = norm(clean);
        dirty = false;
        emit("providers:change", { providers: clean });
        render();
        toast("已保存 " + clean.length + " 个服务商（Key 仅存本地）", "ok");
      }
    }, txt("保存"));
    var cancelBtn = h("button", {
      class: "st-btn st-ghost", type: "button", onclick: function () {
        draft = norm(get("providers", []));
        dirty = false;
        render();
        toast("已丢弃本次编辑", "info");
      }
    }, txt("取消"));

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" },
        h("h3", { class: "st-card-title", text: "服务商与模型" }),
        addBtn),
      h("div", { class: "st-card-desc", text: "支持任意 OpenAI 兼容服务商。可手动填写模型 ID，也可一键从 API 拉取后勾选批量导入。" })));
    root.appendChild(listBox);
    root.appendChild(h("div", { class: "st-foot" }, h("span", { class: "st-foot-note", text: "Key 仅存本地 localStorage，不会上传" }), cancelBtn, saveBtn));

    render();
  }

  registerPanel("api", { title: "API 配置", icon: "key", order: 20, mount: apiPanel, unmount: function () {} });
})();
