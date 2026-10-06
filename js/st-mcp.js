/* AYCHO module: js/st-mcp | owner: C | contract: v1 */
/* MCP：服务增删、启停、连接状态与测试连接 */
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
  function parseHeaders(text) {
    var out = {}, lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var m = /^\s*([^:]+):\s*(.*)$/.exec(lines[i]);
      if (m) out[m[1].trim()] = m[2].trim();
    }
    return out;
  }
  function headersToText(o) {
    if (!o || typeof o !== "object") return "";
    var out = [];
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push(k + ": " + o[k]);
    return out.join("\n");
  }
  function norm(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (m) {
      return {
        id: (m && m.id) || uid(),
        name: (m && m.name) || "",
        desc: (m && m.desc) || "",
        enabled: !(m && m.enabled === false),
        tools: Array.isArray(m && m.tools) ? m.tools.slice() : [],
        transport: (m && m.transport) || "http",
        url: (m && m.url) || "",
        command: (m && m.command) || "",
        headers: (m && m.headers) || {},
        status: (m && m.status) || "idle"
      };
    });
  }
  function seed() {
    var cur = norm(get("mcps", []));
    return cur;
  }
  function save(list) { set("mcps", list); emit("mcps:change", { mcps: list }); }

  var STATUS = {
    idle: { text: "未连接", cls: "st-tag" },
    ok: { text: "已连接", cls: "st-tag st-tag-ok" },
    fail: { text: "失败", cls: "st-tag st-tag-danger" },
    testing: { text: "测试中…", cls: "st-tag st-tag-warn" }
  };

  function testConnection(m) {
    if (m.transport === "stdio") {
      return Promise.reject(new Error("stdio 传输需要在本地/后端启动子进程，网页端无法直连。请改用 http 或 sse，或把 MCP 部署为可访问的 URL。"));
    }
    var url = String(m.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error("请填写以 http(s):// 开头的服务地址"));
    var headers = parseHeaders(headersToText(m.headers));
    headers["Accept"] = headers["Accept"] || (m.transport === "sse" ? "text/event-stream" : "application/json");
    return fetch(url, { method: m.transport === "sse" ? "GET" : "POST", headers: headers, body: m.transport === "sse" ? undefined : JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error(r.status + "：鉴权失败，请检查鉴权头（Authorization / X-Api-Key 等）");
        if (r.status === 404) throw new Error("404：地址不存在，请确认 MCP 的完整路径（通常以 /mcp 或 /sse 结尾）");
        if (r.status === 405) throw new Error("405：该地址不接受当前请求方式，若为 SSE 请把传输方式切到 sse");
        if (!r.ok) throw new Error("服务返回 " + r.status + " " + (r.statusText || ""));
        return r.text();
      })
      .then(function (body) {
        var tools = [];
        try {
          var j = JSON.parse(body);
          var arr = (j && j.result && j.result.tools) || (j && j.tools) || [];
          tools = arr.map(function (t) { return (t && (t.name || t.id)) || ""; }).filter(Boolean);
        } catch (e) { /* SSE 或非 JSON 响应，视为可达 */ }
        return { tools: tools };
      })
      .catch(function (e) {
        if (e instanceof TypeError) throw new Error("网络错误 / CORS 被拦截：无法访问 " + url + "。请确认地址公网可达，且服务端允许浏览器跨域。");
        throw e;
      });
  }

  function mcpPanel(root) {
    var list = seed();
    var box = h("div", { class: "st-list" });

    function persist() { save(list); }
    function render() {
      while (box.firstChild) box.removeChild(box.firstChild);
      if (!list.length) {
        box.appendChild(h("div", { class: "st-empty" },
          h("div", { class: "st-empty-title", text: "还没有 MCP 服务" }),
          h("div", { text: "添加后可扩展工具能力；http / sse 需要公网可达地址，stdio 需本地运行时" })));
        return;
      }
      list.forEach(function (m) { box.appendChild(card(m)); });
    }

    function card(m) {
      var nameI = h("input", { class: "st-input", type: "text", value: m.name, placeholder: "服务名称，如 filesystem" });
      var descI = h("input", { class: "st-input", type: "text", value: m.desc, placeholder: "描述（可选）" });
      var urlI = h("input", { class: "st-input", type: "url", value: m.url, placeholder: "https://example.com/mcp", spellcheck: "false" });
      var cmdI = h("input", { class: "st-input", type: "text", value: m.command, placeholder: "npx -y @modelcontextprotocol/server-filesystem /path", spellcheck: "false" });
      var hdrI = h("textarea", { class: "st-input st-textarea", rows: "2", placeholder: "Authorization: Bearer xxx\nX-Api-Key: yyy" });
      hdrI.value = headersToText(m.headers);
      var statusTag = h("span", { class: STATUS[m.status] ? STATUS[m.status].cls : "st-tag", text: STATUS[m.status] ? STATUS[m.status].text : "未连接" });
      var errBox = h("div", { class: "st-error" });

      var sel = h("select", { class: "st-input st-select" });
      [["http", "http（流式 HTTP）"], ["sse", "sse（Server-Sent Events）"], ["stdio", "stdio（本地子进程）"]].forEach(function (o) {
        var op = h("option", { value: o[0], text: o[1] });
        if (m.transport === o[0]) op.selected = true;
        sel.appendChild(op);
      });
      var urlField = h("div", { class: "st-field", hidden: m.transport === "stdio" }, h("label", { class: "st-label", text: "服务 URL" }), urlI);
      var cmdField = h("div", { class: "st-field", hidden: m.transport !== "stdio" }, h("label", { class: "st-label", text: "启动命令" }), cmdI,
        h("div", { class: "st-hint", text: "stdio 需在能启动子进程的运行环境中使用；纯网页端无法执行" }));

      function setStatus(k) {
        m.status = k;
        statusTag.className = STATUS[k].cls;
        statusTag.textContent = STATUS[k].text;
        persist();
      }

      nameI.addEventListener("input", function () { m.name = nameI.value; persist(); });
      descI.addEventListener("input", function () { m.desc = descI.value; persist(); });
      urlI.addEventListener("input", function () { m.url = urlI.value.trim(); persist(); });
      cmdI.addEventListener("input", function () { m.command = cmdI.value; persist(); });
      hdrI.addEventListener("input", function () { m.headers = parseHeaders(hdrI.value); persist(); });
      sel.addEventListener("change", function () {
        m.transport = sel.value;
        urlField.hidden = m.transport === "stdio";
        cmdField.hidden = m.transport !== "stdio";
        persist();
      });

      var testBtn = h("button", { class: "st-btn", type: "button" }, txt("测试连接"));
      testBtn.addEventListener("click", function () {
        errBox.textContent = "";
        setStatus("testing");
        testBtn.disabled = true;
        testConnection(m).then(function (r) {
          testBtn.disabled = false;
          if (r.tools && r.tools.length) { m.tools = r.tools; }
          setStatus("ok");
          render();
          toast("连接成功" + (r.tools && r.tools.length ? "，发现 " + r.tools.length + " 个工具" : ""), "ok");
        }).catch(function (e) {
          testBtn.disabled = false;
          setStatus("fail");
          errBox.textContent = "";
          errBox.appendChild(txt(String(e && e.message || e)));
          errBox.classList.remove("st-shake"); void errBox.offsetWidth; errBox.classList.add("st-shake");
        });
      });

      var sw = h("button", { class: "st-switch" + (m.enabled ? " st-on" : ""), type: "button", role: "switch", "aria-checked": m.enabled ? "true" : "false", "aria-label": "启用 MCP" });
      sw.addEventListener("click", function () {
        m.enabled = !m.enabled;
        sw.classList.toggle("st-on", m.enabled);
        sw.setAttribute("aria-checked", m.enabled ? "true" : "false");
        persist();
      });

      return h("div", { class: "st-card" },
        h("div", { class: "st-card-head" },
          h("h3", { class: "st-card-title", text: m.name || "未命名 MCP" }),
          statusTag,
          h("span", { class: "st-tag", text: (m.tools || []).length + " 个工具" })),
        h("div", { class: "st-row st-row-wrap" },
          h("div", { class: "st-grow", style: { minWidth: "190px" } }, h("div", { class: "st-field" }, h("label", { class: "st-label", text: "名称" }), nameI)),
          h("div", { class: "st-grow", style: { minWidth: "160px" } }, h("div", { class: "st-field" }, h("label", { class: "st-label", text: "传输方式" }), sel)),
          h("div", { class: "st-grow", style: { minWidth: "190px" } }, h("div", { class: "st-field" }, h("label", { class: "st-label", text: "描述" }), descI))
        ),
        urlField, cmdField,
        h("div", { class: "st-field" }, h("label", { class: "st-label", text: "鉴权头（每行一个 Header: value）" }), hdrI),
        h("div", { class: "st-row st-row-wrap" }, testBtn,
          h("div", { class: "st-grow" }),
          sw,
          h("button", {
            class: "st-btn st-danger", type: "button", onclick: function () {
              var i = list.indexOf(m);
              if (i >= 0) { list.splice(i, 1); persist(); render(); toast("已删除 MCP 服务", "ok"); }
            }
          }, txt("删除"))),
        errBox
      );
    }

    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" },
        h("h3", { class: "st-card-title", text: "MCP 服务" }),
        h("button", {
          class: "st-btn st-primary", type: "button", onclick: function () {
            list.unshift({ id: uid(), name: "", desc: "", enabled: true, tools: [], transport: "http", url: "", command: "", headers: {}, status: "idle" });
            persist(); render();
          }
        }, txt("添加服务"))),
      h("div", { class: "st-card-desc", text: "连接状态分为 未连接 / 已连接 / 失败。测试连接会真实请求 {url} 的 tools/list（stdio 除外）。" })));
    root.appendChild(box);
    render();
  }

  registerPanel("mcp", { title: "MCP", icon: "plug", order: 40, mount: mcpPanel, unmount: function () {} });
})();
