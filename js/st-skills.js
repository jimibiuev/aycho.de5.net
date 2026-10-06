/* AYCHO module: js/st-skills | owner: C | contract: v1 */
/* Skills：内置 5 个 + 三种导入方式（直链 / 仓库 / 本地文件） */
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
  function switchEl(on, onToggle, label) {
    var b = h("button", { class: "st-switch" + (on ? " st-on" : ""), type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label || "切换" });
    b.addEventListener("click", function () { var nv = !b.classList.contains("st-on"); b.classList.toggle("st-on", nv); b.setAttribute("aria-checked", nv ? "true" : "false"); onToggle(nv); });
    return b;
  }

  /* ---------------- frontmatter / 校验 ---------------- */
  function parseFront(text) {
    var s = String(text || "").replace(/^\uFEFF/, "");
    if (s.slice(0, 3) !== "---") return null;
    var end = s.indexOf("\n---", 3);
    if (end < 0) return null;
    var head = s.slice(3, end);
    var out = {};
    head.split(/\r?\n/).forEach(function (line) {
      var m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (m) out[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
    });
    return out;
  }
  function validateMd(text) {
    var fm = parseFront(text);
    if (!fm) return { ok: false, reason: "缺少 frontmatter：文件必须以 --- 开头，并在其中声明 name 与 description" };
    if (!fm.name) return { ok: false, reason: "frontmatter 缺少 name 字段" };
    if (!fm.description) return { ok: false, reason: "frontmatter 缺少 description 字段" };
    return { ok: true, name: fm.name, description: fm.description };
  }
  function isMd(u) { return /\.(md|markdown)(\?.*)?$/i.test(String(u || "")); }

  var DEMO_MD = "---\nname: demo-skill\ndescription: 示例技能，用于体验技能导入流程\n---\n\n# 触发条件\n- 用户需要导入技能时\n\n# 步骤\n1. 读取上下文\n2. 输出结果\n\n# 禁忌\n- 不要联网";
  function demoSkill(base) {
    return { name: "demo-skill", description: "示例技能", raw: DEMO_MD, source: base || "直链" };
  }

  /* ---------------- zip 最小读取器（原生 DecompressionStream） ---------------- */
  function readZip(buf) {
    return new Promise(function (resolve, reject) {
      try {
        var dv = new DataView(buf);
        var eocd = -1, min = Math.max(0, buf.byteLength - 65558);
        for (var i = buf.byteLength - 22; i >= min; i--) {
          if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) return reject(new Error("不是有效的 zip 文件（未找到 EOCD 记录）"));
        var count = dv.getUint16(eocd + 10, true);
        var cdOff = dv.getUint32(eocd + 16, true);
        var entries = [], p = cdOff;
        for (var n = 0; n < count; n++) {
          if (dv.getUint32(p, true) !== 0x02014b50) break;
          var method = dv.getUint16(p + 10, true);
          var compSize = dv.getUint32(p + 20, true);
          var nameLen = dv.getUint16(p + 28, true);
          var extraLen = dv.getUint16(p + 30, true);
          var cmtLen = dv.getUint16(p + 32, true);
          var localOff = dv.getUint32(p + 42, true);
          var name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
          entries.push({ name: name, method: method, compSize: compSize, localOff: localOff });
          p += 46 + nameLen + extraLen + cmtLen;
        }
        var jobs = [], out = [];
        entries.forEach(function (f) {
          if (/\/$/.test(f.name)) return;
          var lo = f.localOff;
          if (dv.getUint32(lo, true) !== 0x04034b50) return;
          var ln = dv.getUint16(lo + 26, true), le = dv.getUint16(lo + 28, true);
          var start = lo + 30 + ln + le;
          var data = buf.slice(start, start + f.compSize);
          if (f.method === 0) { out.push({ name: f.name, text: new TextDecoder().decode(data) }); return; }
          if (f.method !== 8) return;
          jobs.push(extractDeflate(data).then(function (text) { return { name: f.name, text: text }; }));
        });
        Promise.all(jobs).then(function (arr) {
          for (var k = 0; k < arr.length; k++) if (arr[k]) out.push(arr[k]);
          resolve(out);
        }).catch(reject);
      } catch (e) { reject(e); }
    });
  }
  function extractDeflate(u8) {
    return new Promise(function (resolve, reject) {
      if (typeof DecompressionStream !== "function") return reject(new Error("当前浏览器不支持 DecompressionStream，无法解析 zip"));
      var stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      new Response(stream).arrayBuffer().then(function (ab) { resolve(new TextDecoder().decode(ab)); }).catch(reject);
    });
  }

  /* ---------------- 内置 SKILL.md 规范文本 ---------------- */
  var SKILL_SPEC = [
    "---",
    "name: my-skill",
    "description: 一句话说明这个技能解决什么问题、什么时候该用它",
    "---",
    "",
    "# 触发条件",
    "- 当用户请求 …… 时使用本技能",
    "- 当输入中包含 …… 关键词时使用",
    "",
    "# 步骤",
    "1. 先确认前置数据（路径 / 参数）是否齐全",
    "2. 执行核心动作，失败时给出明确原因",
    "3. 输出结果并说明产物落盘位置",
    "",
    "# 禁忌",
    "- 不要臆造数据或文件路径",
    "- 不要执行删除 / 覆盖等破坏性操作而不确认",
    "- 不要引入外部 CDN 或第三方库",
    "",
    "# 输出格式",
    "- 结果表格 + 一句话结论"
  ].join("\n");

  var BUILTINS = [
    {
      id: "subagents", name: "子 Agent", icon: "sparkles",
      desc: "可无限添加 Agent：改名、写描述、单独指定模型。子 Agent 会并行处理各自擅长的任务。"
    },
    {
      id: "browser", name: "浏览器", icon: "link",
      desc: "可真实打开任意网址：支持页面浏览、点击、表单填写、多页跳转与截图，遇到登录墙会提示接管。"
    },
    {
      id: "terminal", name: "终端", icon: "code",
      desc: "root 运行的 Ubuntu 环境，可 cd 到用户目录，直接在网页里编辑文件（保存即落盘）。"
    },
    {
      id: "makeskill", name: "制作 Skill", icon: "wrench",
      desc: "教你怎么写一个可被识别的 SKILL.md：frontmatter 必含 name / description，正文写触发条件、步骤、禁忌。",
      spec: SKILL_SPEC
    },
    {
      id: "memory", name: "记忆", icon: "brain",
      desc: "把每次对话中的关键事件精简成一条记忆，自动沉淀到「记忆」页签，可搜索、可删除。"
    }
  ];

  /* 把技能扩展层注册的「可改写页面」技能并入列表（例如语音输入） */
  function syncExt() {
    try {
      var ext = (A.skillExt && A.skillExt.list) ? A.skillExt.list() : [];
      ext.forEach(function (e) {
        if (!BUILTINS.filter(function (b) { return b.id === e.id; }).length) {
          BUILTINS.push({ id: e.id, name: e.name, desc: e.desc, ui: true, hasRun: typeof e.onClick === "function" });
        }
      });
    } catch (e) {}
  }

  function seedSkills() {
    syncExt();
    var cur = get("skills", null);
    if (Array.isArray(cur) && cur.length) {
      BUILTINS.forEach(function (b) {
        if (!cur.filter(function (s) { return s.id === b.id; }).length) {
          cur.push({ id: b.id, name: b.name, desc: b.desc, builtin: true, enabled: true, source: "内置" });
        }
      });
      return cur;
    }
    return BUILTINS.map(function (b) {
      return { id: b.id, name: b.name, desc: b.desc, builtin: true, enabled: true, source: "内置" };
    });
  }
  function saveSkills(list) { set("skills", list); emit("skills:change", { skills: list }); }

  function allModels() {
    var ps = get("providers", []) || [], out = [];
    ps.forEach(function (p) {
      (p.models || []).forEach(function (m) { if (m && m.id && m.enabled !== false) out.push({ id: m.id, label: m.label || m.id, provider: p.name }); });
    });
    return out;
  }
  function colorOf(s) {
    var palette = ["var(--ax-accent,#7c9cff)", "var(--ax-accent-2,#a78bfa)", "var(--ax-accent-3,#22d3ee)", "var(--ax-ok,#34d399)", "var(--ax-warn,#fbbf24)", "var(--ax-danger,#f87171)"];
    var sum = 0, str = String(s || "?");
    for (var i = 0; i < str.length; i++) sum += str.charCodeAt(i);
    return palette[sum % palette.length];
  }

  /* ---------------- 面板 ---------------- */
  function skillsPanel(root) {
    var skills = seedSkills();

    var listBox = h("div", { class: "st-list" });
    var status = h("div", { class: "st-error" });

    function persist() { saveSkills(skills); }

    function render() {
      while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
      if (!skills.length) {
        listBox.appendChild(h("div", { class: "st-empty" }, h("div", { class: "st-empty-title", text: "暂无技能" })));
        return;
      }
      skills.forEach(function (s) { listBox.appendChild(row(s)); });
      persist();
    }

    function row(s) {
      var builtin = !!s.builtin;
      var meta = BUILTINS.filter(function (b) { return b.id === s.id; })[0];
      var av = h("div", { class: "st-avatar", style: { background: colorOf(s.name) } }, txt((s.name || "?").slice(0, 1).toUpperCase()));
      var body = h("div", { class: "st-item-main" },
        h("div", { class: "st-row" },
          h("strong", { class: "st-item-title", text: s.name }),
          h("span", { class: "st-tag", text: s.source || (builtin ? "内置" : "直链") })),
        h("div", { class: "st-item-desc", text: s.desc || "" })
      );

      var extra = null;
      if (s.id === "subagents") extra = agentsBlock();
      else if (s.id === "makeskill") extra = h("pre", { class: "st-pre", text: SKILL_SPEC });

      var actions = h("div", { class: "st-item-actions" }, switchEl(s.enabled, function (v) {
        s.enabled = v; persist(); toast((v ? "已启用 " : "已停用 ") + s.name, "info");
      }, "启用 " + s.name));
      /* 能改写页面的技能：直接给一个「运行」入口，点了就走技能自己的注册流程 */
      if (meta && meta.hasRun && A.skillExt) {
        actions.insertBefore(h("button", {
          class: "st-btn st-primary st-btn-sm", type: "button", title: "运行 " + s.name,
          onclick: function () {
            var r = A.skillExt.run(s.id, null);
            if (r && typeof r.then === "function") r.then(function () { render(); });
          }
        }, txt("运行")), actions.firstChild);
      }
      if (!builtin) {
        actions.appendChild(h("button", {
          class: "st-icon-btn", type: "button", "aria-label": "删除技能", title: "删除技能",
          onclick: function () {
            var i = skills.indexOf(s);
            if (i >= 0) { skills.splice(i, 1); render(); toast("已删除 " + s.name, "ok"); }
          }
        }, txt("×")));
      }

      return h("div", { class: "st-item st-item-col" },
        h("div", { class: "st-row st-row-top" }, av, body, actions),
        extra ? h("div", { class: "st-item-extra" }, extra) : null
      );
    }

    function agentsBlock() {
      var agents = get("agents", []) || [];
      var box = h("div", { class: "st-sub" });
      var models = allModels();

      function paint() {
        while (box.firstChild) box.removeChild(box.firstChild);
        box.appendChild(h("div", { class: "st-hint", text: agents.length + " 个 Agent" + (models.length ? "" : "（尚未配置模型，可先到「API 配置」添加）") }));
        agents.forEach(function (ag, i) {
          var nameI = h("input", { class: "st-input", type: "text", value: ag.name || "", placeholder: "Agent 名称" });
          var descI = h("input", { class: "st-input", type: "text", value: ag.desc || "", placeholder: "描述：它负责什么" });
          var sel = h("select", { class: "st-input st-select" });
          sel.appendChild(h("option", { value: "", text: models.length ? "跟随默认模型" : "无可用模型" }));
          models.forEach(function (m) {
            var o = h("option", { value: m.id, text: m.label + "（" + m.provider + "）" });
            if (ag.modelId === m.id) o.selected = true;
            sel.appendChild(o);
          });
          nameI.addEventListener("input", function () { ag.name = nameI.value; persist(); });
          descI.addEventListener("input", function () { ag.desc = descI.value; persist(); });
          sel.addEventListener("change", function () { ag.modelId = sel.value; persist(); });
          box.appendChild(h("div", { class: "st-item" },
            h("div", { class: "st-avatar st-avatar-sm", style: { background: colorOf(ag.name || "A") } }, txt((ag.name || "A").slice(0, 1).toUpperCase())),
            h("div", { class: "st-item-main" }, h("div", { class: "st-row" }, h("div", { class: "st-grow" }, nameI), h("div", { class: "st-grow" }, sel)), h("div", { style: { marginTop: "6px" } }, descI)),
            h("div", { class: "st-item-actions" }, h("button", {
              class: "st-icon-btn", type: "button", "aria-label": "删除 Agent", title: "删除 Agent",
              onclick: function () { agents.splice(i, 1); set("agents", agents); emit("agents:change", { agents: agents }); paint(); }
            }, txt("×")))
          ));
        });
        box.appendChild(h("button", {
          class: "st-btn", type: "button", onclick: function () {
            agents.push({ id: uid(), name: "Agent " + (agents.length + 1), desc: "", modelId: "" });
            set("agents", agents); emit("agents:change", { agents: agents }); paint();
          }
        }, txt("添加 Agent")));
      }
      paint();
      return box;
    }

    /* ---- 添加区 ---- */
    var mode = "link";
    var mLink = h("button", { class: "st-seg-btn st-on", type: "button" }, txt("添加直链"));
    var mRepo = h("button", { class: "st-seg-btn", type: "button" }, txt("添加仓库"));
    var mFile = h("button", { class: "st-seg-btn", type: "button" }, txt("直接导入文件"));
    var paneLink = h("div", {});
    var paneRepo = h("div", { hidden: true });
    var paneFile = h("div", { hidden: true });
    function setMode(m) {
      mode = m;
      mLink.classList.toggle("st-on", m === "link");
      mRepo.classList.toggle("st-on", m === "repo");
      mFile.classList.toggle("st-on", m === "file");
      paneLink.hidden = m !== "link";
      paneRepo.hidden = m !== "repo";
      paneFile.hidden = m !== "file";
    }
    mLink.addEventListener("click", function () { setMode("link"); });
    mRepo.addEventListener("click", function () { setMode("repo"); });
    mFile.addEventListener("click", function () { setMode("file"); });

    function showStatus(msg, kind) {
      status.textContent = "";
      if (!msg) return;
      status.appendChild(txt(msg));
      if (kind !== "info") { status.classList.remove("st-shake"); void status.offsetWidth; status.classList.add("st-shake"); }
    }
    function addFromRaw(raw, sourceLabel) {
      var v = validateMd(raw);
      if (!v.ok) { showStatus("校验失败：" + v.reason); return false; }
      var dup = skills.filter(function (s) { return s.name === v.name; })[0];
      if (dup) { showStatus("已存在同名技能「" + v.name + "」，请先删除或改名"); return false; }
      /* ---- 三态导入流程（用户要求） ----
         ① 正常（无风险）：取消 / 加入
         ② 有风险（L1 flag 命中 或 后端审核 risk≥2）：取消 / 强制加入（需输登录密码）
         导入前先让 L1 规则跑一遍本地预判（不联网，毫秒级） */
      var l1 = localL1(raw);
      if (!l1.risky) {
        /* 正常态：简单确认即可加入 */
        if (!window.confirm("加入技能「" + v.name + "」？\n（本地预判未发现高危原语）")) return false;
        skills.push({ id: uid(), name: v.name, desc: v.description, builtin: false, enabled: true, source: sourceLabel || "直链", raw: raw, risk: 0 });
        showStatus("已导入（正常）：" + v.name, "info");
        render();
        toast("已导入技能 " + v.name, "ok");
        return true;
      }
      /* 风险态：强制加入需密码验证（走网关 /api/skill/audit/force） */
      showStatus("⚠ 检测到风险：「" + v.name + "」命中 " + l1.hits.length + " 条高危规则（" + l1.hits.join(", ") + "）。", "warn");
      var pw = prompt("强制加入需要输入你的登录密码（网关核验通过才真正放行）：");
      if (pw === null) { showStatus("已取消：技能未加入。", "warn"); return false; }
      if (!pw) { showStatus("密码不能为空，已取消。", "warn"); return false; }
      var api = A.api;
      if (!api || !api.request) {
        /* 网关不可达：只在前端登记（提权模式），但明确标注未过后端核验 */
        skills.push({ id: uid(), name: v.name, desc: v.description, builtin: false, enabled: true, source: sourceLabel || "直链", raw: raw, risk: l1.hits.length, forcedLocal: true });
        showStatus("网关不可达：「" + v.name + "」已在本地标记为高风险技能（未过后端核验）。", "warn");
        render();
        return true;
      }
      api.request("POST", "/api/skill/audit/force", {
        auditId: "pre_" + Date.now().toString(36),
        password: pw,
        skillId: v.name,
        action: "import",
        code: raw
      }).then(function (r) {
        if (!r || !r.ok) { showStatus("强制加入被拒：" + ((r && r.message) || "密码错误或未登录"), "err"); return; }
        skills.push({ id: uid(), name: v.name, desc: v.description, builtin: false, enabled: true, source: sourceLabel || "直链", raw: raw, risk: l1.hits.length, forced: true, forcedBy: r.user && r.user.email });
        showStatus("已强制加入（密码核验通过：" + ((r.user && r.user.email) || "?") + "）：" + v.name, "info");
        render();
        toast("高风险技能已强制加入 " + v.name, "warn");
      }).catch(function (e) {
        showStatus("强制加入请求失败：" + ((e && e.message) || e), "err");
      });
      return true;
    }

    /* L1 本地预判（与网关 skillaudit.js 的 RULES 对齐的精简版，不联网） */
    function localL1(raw) {
      var t = String(raw || "");
      var hits = [];
      if (/\beval\s*\(/.test(t)) hits.push("eval()");
      if (/new\s+(Async)?Function\s*\(/.test(t)) hits.push("new Function()");
      if (/document\s*\.\s*write\s*\(/.test(t)) hits.push("document.write");
      if (/(window|self)\s*\.\s*(top|parent)\b/.test(t)) hits.push("越出沙箱窗口");
      if (/document\s*\.\s*cookie/.test(t)) hits.push("读 Cookie");
      if (/localStorage|sessionStorage|indexedDB/.test(t)) hits.push("访问本地存储");
      if (/XMLHttpRequest|new\s+WebSocket|navigator\s*\.\s*sendBeacon/.test(t)) hits.push("非常规外发通道");
      if (/(fs\s*\.\s*)?(unlink|rmdir|rmSync|rm)\s*\(|removeItem\s*\(/.test(t)) hits.push("删除类操作");
      if (/\.\.\s*[\\/]|process\s*\.\s*env|cwd\s*\(\)/.test(t)) hits.push("路径越界");
      if (/\brequire\s*\(|child_process|execSync|spawn\s*\(/.test(t)) hits.push("模块加载/命令执行");
      if (/while\s*\(\s*(true|1)\s*\)/.test(t) || /setInterval\s*\(\s*[^,]{0,40},\s*0\s*\)/.test(t)) hits.push("死循环/0 间隔定时器");
      return { hits: hits, risky: hits.length > 0 };
    }

    /* 1) 直链 */
    var linkI = h("input", { class: "st-input", type: "url", placeholder: "https://raw.githubusercontent.com/user/repo/main/skills/foo/SKILL.md", spellcheck: "false" });
    var linkBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("抓取并导入"));
    linkBtn.addEventListener("click", function () {
      var u = linkI.value.trim();
      if (!/^https?:\/\//i.test(u)) { showStatus("请输入以 http(s):// 开头的完整直链"); return; }
      if (!isMd(u)) { showStatus("直链必须指向 .md 文件（当前地址不是 .md）"); return; }
      showStatus("");
      linkBtn.disabled = true; linkBtn.textContent = "抓取中…";
      fetch(u).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (t) {
        linkBtn.disabled = false; linkBtn.textContent = "抓取并导入";
        if (addFromRaw(t, "直链")) linkI.value = "";
      }).catch(function (e) {
        linkBtn.disabled = false; linkBtn.textContent = "抓取并导入";
        showStatus("抓取失败：" + (e && e.message || e) + "（可能是网络不可达或对方禁止跨域）");
        status.appendChild(h("button", {
          class: "st-btn", type: "button", style: { marginLeft: "8px" },
          onclick: function () { var d = demoSkill("直链"); if (addFromRaw(d.raw, "示例")) linkI.value = ""; }
        }, txt("导入示例技能")));
      });
    });
    paneLink.appendChild(h("div", { class: "st-field" }, h("label", { class: "st-label", text: "SKILL.md 直链" }), linkI,
      h("div", { class: "st-hint", text: "必须是可直接返回文件内容的地址（不是网页预览页）；校验通过后入库" })));
    paneLink.appendChild(h("div", { class: "st-row" }, linkBtn));

    /* 2) 仓库 */
    var repoI = h("input", { class: "st-input", type: "url", placeholder: "https://github.com/owner/repo 或 .../tree/main/skills", spellcheck: "false" });
    var repoBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("扫描仓库中的 SKILL.md"));
    var repoList = h("div", { class: "st-picklist" });
    var repoBar = h("div", { class: "st-row" }, h("div", { class: "st-grow" }));
    repoBar.hidden = true;

    function scanRepo() {
      var u = repoI.value.trim();
      var m = /^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s?#]+)(?:\/tree\/([^\/\s?#]+)(?:\/(.*))?)?/i.exec(u);
      if (!m) { showStatus("请填写 github.com/owner/repo 形式的仓库地址"); return; }
      var owner = m[1], repo = m[2].replace(/\.git$/, ""), branch = m[3] || "main", sub = (m[4] || "").replace(/\/$/, "");
      showStatus("");
      repoBtn.disabled = true; repoBtn.textContent = "扫描中…";
      function tryBranch(b) {
        return fetch("https://api.github.com/repos/" + owner + "/" + repo + "/git/trees/" + encodeURIComponent(b) + "?recursive=1", {
          headers: { Accept: "application/vnd.github+json" }
        }).then(function (r) {
          if (r.status === 404) throw new Error("__BRANCH__");
          if (r.status === 403) throw new Error("403：GitHub API 匿名调用次数已用尽，请稍后再试");
          if (!r.ok) throw new Error("GitHub API 返回 " + r.status);
          return r.json().then(function (j) { return { branch: b, tree: j.tree || [] }; });
        });
      }
      tryBranch(branch).catch(function (e) {
        if (String(e.message) === "__BRANCH__" && branch === "main") return tryBranch("master");
        throw e;
      }).then(function (res) {
        var files = res.tree.filter(function (n) {
          if (!n || n.type !== "blob" || !/\.(md|markdown)$/i.test(n.path || "")) return false;
          if (sub && n.path.indexOf(sub + "/") !== 0) return false;
          return true;
        });
        files.sort(function (a, b) { return (/SKILL\.md$/i.test(b.path) ? 1 : 0) - (/SKILL\.md$/i.test(a.path) ? 1 : 0); });
        repoBtn.disabled = false; repoBtn.textContent = "扫描仓库中的 SKILL.md";
        if (!files.length) { showStatus("该分支下没有找到 .md 文件（分支：" + res.branch + "）"); return; }
        while (repoList.firstChild) repoList.removeChild(repoList.firstChild);
        var picks = [];
        files.forEach(function (f) {
          var cb = h("input", { type: "checkbox" });
          var rowEl = h("label", { class: "st-pick" }, cb, h("span", { class: "st-pick-label", text: f.path }));
          picks.push({ path: f.path, cb: cb });
          repoList.appendChild(rowEl);
        });
        var importBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("导入选中"));
        importBtn.addEventListener("click", function () {
          var sel = picks.filter(function (p) { return p.cb.checked; });
          if (!sel.length) { showStatus("请先勾选要导入的文件"); return; }
          importBtn.disabled = true; importBtn.textContent = "导入中…";
          var ok = 0, fail = 0;
          Promise.all(sel.map(function (p) {
            var raw = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + res.branch + "/" + p.path;
            return fetch(raw).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
              .then(function (t) { if (addFromRaw(t, "仓库")) ok++; })
              .catch(function () { fail++; });
          })).then(function () {
            importBtn.disabled = false; importBtn.textContent = "导入选中";
            showStatus("导入完成：成功 " + ok + " 个" + (fail ? "，失败 " + fail + " 个（raw 地址不可达）" : ""), "info");
            if (!ok) {
              repoBar.appendChild(h("button", {
                class: "st-btn", type: "button",
                onclick: function () { var d = demoSkill("仓库"); addFromRaw(d.raw, "示例"); }
              }, txt("导入示例技能")));
              repoBar.hidden = false;
            }
          });
        });
        repoBar.hidden = false;
        while (repoBar.firstChild) repoBar.removeChild(repoBar.firstChild);
        repoBar.appendChild(h("span", { class: "st-hint", text: "分支 " + res.branch + " · 命中 " + files.length + " 个文件" }));
        repoBar.appendChild(importBtn);
      }).catch(function (e) {
        repoBtn.disabled = false; repoBtn.textContent = "扫描仓库中的 SKILL.md";
        showStatus("扫描失败：" + (e && e.message || e));
      });
    }
    repoBtn.addEventListener("click", scanRepo);
    paneRepo.appendChild(h("div", { class: "st-field" }, h("label", { class: "st-label", text: "仓库 / 目录链接" }), repoI,
      h("div", { class: "st-hint", text: "非直链也可以：自动调用 GitHub API 递归列出全部 .md 候选，再勾选导入" })));
    paneRepo.appendChild(h("div", { class: "st-row" }, repoBtn));
    paneRepo.appendChild(repoList);
    paneRepo.appendChild(repoBar);

    /* 3) 本地文件 */
    var fileI = h("input", { type: "file", accept: ".md,.markdown,.zip", style: { display: "none" } });
    var fileBtn = h("button", { class: "st-btn st-primary", type: "button" }, txt("选择 .md 或 .zip"));
    fileBtn.addEventListener("click", function () { fileI.click(); });
    fileI.addEventListener("change", function () {
      var f = fileI.files && fileI.files[0];
      if (!f) return;
      var name = f.name.toLowerCase();
      showStatus("");
      if (/\.(md|markdown)$/.test(name)) {
        var fr = new FileReader();
        fr.onload = function () { addFromRaw(String(fr.result || ""), "导入"); };
        fr.onerror = function () { showStatus("读取文件失败"); };
        fr.readAsText(f);
      } else if (/\.zip$/.test(name)) {
        var fr2 = new FileReader();
        fr2.onload = function () {
          readZip(fr2.result).then(function (entries) {
            if (!entries.length) { showStatus("压缩包内没有任何文件"); return; }
            var skillFiles = entries.filter(function (e) { return /(^|\/)SKILL\.md$/i.test(e.name); });
            if (!skillFiles.length) { showStatus("压缩包内缺少 SKILL.md"); return; }
            var ok = 0;
            skillFiles.forEach(function (e) { if (addFromRaw(e.text, "导入")) ok++; });
            if (ok) toast("从压缩包导入 " + ok + " 个技能", "ok");
          }).catch(function (e) { showStatus("解析 zip 失败：" + (e && e.message || e)); });
        };
        fr2.onerror = function () { showStatus("读取文件失败"); };
        fr2.readAsArrayBuffer(f);
      } else {
        showStatus("仅支持 .md / .markdown / .zip 文件");
      }
      fileI.value = "";
    });
    paneFile.appendChild(h("div", { class: "st-field" }, h("label", { class: "st-label", text: "本地文件" }),
      h("div", { class: "st-hint", text: "选 .md 直接校验导入；选 .zip 时压缩包内必须含 SKILL.md，否则报错「压缩包内缺少 SKILL.md」" })));
    paneFile.appendChild(h("div", { class: "st-row" }, fileBtn, fileI));

    var addCard = h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "添加 Skill" }),
        h("div", { class: "st-seg" }, mLink, mRepo, mFile)),
      h("div", { class: "st-card-desc", text: "三种来源：直链抓取 / 仓库扫描 / 本地导入。入库前统一校验 frontmatter 的 name 与 description。" }),
      paneLink, paneRepo, paneFile, status
    );

    /* 提权现在默认开启且是原版自带能力（用户要求：删掉单独开关，所有 skill 都是提权后的状态）
       不再渲染开关 UI；privilege() 默认返回 true，用户仍可在 store 里显式设 skillsPrivilege=false 关闭。 */
    var privOn = get("skillsPrivilege", true) !== false;
    if (!privOn) {
      root.appendChild(h("div", { class: "st-card" },
        h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "权限模式" }),
          h("span", { class: "st-tag", text: "提权（当前关闭）" })),
        h("div", { class: "st-card-desc", text: "技能默认走后端三层 AI 审核；提权关闭时，后端不可达将 fail-closed。" }),
        h("div", { class: "st-row" }, switchEl(privOn, function (v) {
          set("skillsPrivilege", v); emit("skills:privilege", { on: v });
          toast(v ? "提权已开启" : "提权已关闭", v ? "ok" : "warn");
        }, "技能提权"))));
    }
    root.appendChild(h("div", { class: "st-card" },
      h("div", { class: "st-card-head" }, h("h3", { class: "st-card-title", text: "内置技能" }),
        h("span", { class: "st-tag", text: "不可删除" })),
      h("div", { class: "st-card-desc", text: "内置技能只允许启停；其中「子 Agent」可无限添加 Agent 并各自指定模型。" })));
    root.appendChild(listBox);
    root.appendChild(addCard);

    render();
  }

  registerPanel("skills", { title: "Skills", icon: "sparkles", order: 30, mount: skillsPanel, unmount: function () {} });
})();
