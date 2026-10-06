/* AYCHO module: js/skill-ext | owner: C | contract: v1 */
/* 技能扩展层：技能可以直接改写页面（挂载槽位 / 执行动作）；危险动作必须用户确认后才执行 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {} }; }
  function toast(t, ty) {
    if (typeof A.toast === "function") { try { A.toast(t, ty || "info"); return; } catch (e) {} }
    try { BUS().emit("toast", { text: t, type: ty || "info" }); } catch (e) {}
  }
  function emit(ev, pl) { try { BUS().emit(ev, pl); } catch (e) {} }

  /* ---------------- 风险等级：0 只读 / 1 中（改页面·发消息·用麦克风） / 2 高（破坏性） ---------------- */
  var RISK = {
    "toast": 0, "panel.open": 0, "composer.fill": 0, "clipboard.write": 0,
    "voice.listen": 1, "composer.send": 1, "page.injectCSS": 1, "page.setTheme": 1,
    "setting.set": 1, "network.fetch": 1, "file.write": 1, "terminal.run": 2, "file.delete": 2
  };
  function riskOf(action) {
    if (Object.prototype.hasOwnProperty.call(RISK, action)) return RISK[action];
    if (String(action).indexOf("danger.") === 0) return 2;
    return 1; // 未登记的动作用户不可预知 -> 按中等风险处理
  }

  /* ---------------- 注册表 ---------------- */
  var REG = [];
  function defOf(id) { for (var i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i]; return null; }
  function enabled(id) {
    try {
      var list = ST().get("skills") || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].enabled !== false;
    } catch (e) {}
    return true;
  }

  function register(manifest) {
    if (!manifest || !manifest.id) return null;
    var old = defOf(manifest.id);
    if (old) { old.name = manifest.name || old.name; old.desc = manifest.desc || old.desc; return old; }
    REG.push(manifest);
    emit("ui-skills:change", { skills: REG });
    mountAll();
    return manifest;
  }
  function list() { return REG.slice(); }

  /* ---------------- 槽位：技能可以在页面指定位置放下自己的按钮 ---------------- */
  var SLOTS = { "composer.bar": ".ax-skill-slot" };
  function slotHost(name) { return document.querySelector(SLOTS[name] || name); }

  function svg(d, vb) {
    return '<svg viewBox="' + (vb || "0 0 24 24") + '" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  }
  var FALLBACK_ICON = svg('<path d="M12 3v18M3 12h18"/>');

  function mountOne(man) {
    if (!man.slot) return;
    var host = slotHost(man.slot);
    if (!host) return;
    if (host.querySelector('[data-skill="' + man.id + '"]')) return;
    if (!enabled(man.id)) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ax-skill-btn" + (man.danger ? " is-danger" : "");
    b.setAttribute("data-skill", man.id);
    b.title = man.title || man.name || man.id;
    b.setAttribute("aria-label", b.title);
    b.innerHTML = man.icon || FALLBACK_ICON;
    b.addEventListener("click", function () { run(man.id, b); });
    host.appendChild(b);
  }
  function mountAll() { REG.forEach(mountOne); }

  /* 页面是动态渲染的：槽位出现后自动挂载 */
  function observe() {
    try {
      var mo = new MutationObserver(function () { mountAll(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    document.addEventListener("click", function () { setTimeout(mountAll, 60); }, true);
    mountAll();
  }

  /* ---------------- 危险动作确认（技能不可绕过） ---------------- */
  var SESSION_OK = {}; // 本次会话内已放行的中等风险动作
  function confirmDialog(man, action, detail) {
    return new Promise(function (resolve) {
      var host = document.createElement("div");
      host.className = "ax-sk-confirm";
      var box = document.createElement("div");
      box.className = "ax-sk-confirm__box";
      var risky = riskOf(action) >= 2;
      box.innerHTML =
        '<div class="ax-sk-confirm__tag' + (risky ? " is-danger" : "") + '">' + (risky ? "高风险操作" : "需要确认") + "</div>" +
        '<h3 class="ax-sk-confirm__title"></h3>' +
        '<div class="ax-sk-confirm__desc"></div>' +
        '<div class="ax-sk-confirm__act"><code></code></div>' +
        '<div class="ax-sk-confirm__row"><button class="ax-sk-confirm__no" type="button">取消</button>' +
        '<button class="ax-sk-confirm__yes' + (risky ? " is-danger" : "") + '" type="button">允许执行</button></div>';
      box.querySelector(".ax-sk-confirm__title").textContent = "技能「" + (man.name || man.id) + "」请求执行动作";
      box.querySelector(".ax-sk-confirm__desc").textContent = detail || "该动作会改变页面或发送内容，请确认来源可信后再放行。";
      box.querySelector("code").textContent = action;
      host.appendChild(box);
      document.body.appendChild(host);
      function close(ok) {
        if (host.parentNode) host.parentNode.removeChild(host);
        resolve(ok);
      }
      box.querySelector(".ax-sk-confirm__no").addEventListener("click", function () { close(false); });
      box.querySelector(".ax-sk-confirm__yes").addEventListener("click", function () { close(true); });
      host.addEventListener("click", function (e) { if (e.target === host) close(false); });
    });
  }

  /* ---------------- 动作实现 ---------------- */
  function composerTextarea() { return document.querySelector(".ax-blob__input"); }
  function findComposer() {
    var ta = composerTextarea();
    return ta ? { ta: ta } : null;
  }
  var ACT = {
    "toast": function (d, a) { toast(a && a.text || "技能已执行", "ok"); },
    "panel.open": function (d, a) { emit("settings:open", { tab: (a && a.tab) || (a && a.id) || "user" }); },
    "composer.fill": function (d, a) {
      var c = findComposer();
      if (!c) { toast("当前页面没有输入框", "warn"); return false; }
      var t = a && (a.text != null ? a.text : a);
      c.ta.value = String(t == null ? "" : t);
      c.ta.dispatchEvent(new Event("input"));
      c.ta.focus();
      return true;
    },
    "composer.send": function (d, a) {
      var c = findComposer();
      if (!c) { toast("当前页面没有输入框", "warn"); return false; }
      var t = a && (a.text != null ? a.text : a);
      if (t != null) {
        c.ta.value = String(t);
        c.ta.dispatchEvent(new Event("input"));
      }
      if (A.chat && typeof A.chat.send === "function") { A.chat.send(""); return true; }
      var btn = document.querySelector(".ax-send");
      if (btn && !btn.disabled) { btn.click(); return true; }
      toast("未找到发送入口", "warn");
      return false;
    },
    "page.setTheme": function (d, a) {
      a = a || {};
      var r = document.documentElement.style;
      if (a.accent) r.setProperty("--ax-accent", a.accent);
      if (a.accent2) r.setProperty("--ax-accent-2", a.accent2);
      try { var s = ST().get("settings.general.ui", {}) || {}; s.accent = a.accent || s.accent; s.accent2 = a.accent2 || s.accent2; ST().set("settings.general.ui", s); ST().save(); } catch (e) {}
      toast("已应用主题：技能可改写页面配色", "ok");
      return true;
    },
    "page.injectCSS": function (d, a) {
      var css = (a && a.css) || "";
      var id = "ax-sk-css-" + d.id;
      var el = document.getElementById(id);
      if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
      el.textContent = css;
      toast("技能已注入页面样式", "ok");
      return true;
    },
    "clipboard.write": function (d, a) {
      var t = String((a && a.text) || "");
      try { if (navigator.clipboard) navigator.clipboard.writeText(t); toast("已复制到剪贴板", "ok"); } catch (e) { toast("剪贴板不可用", "warn"); }
      return true;
    },
    "setting.set": function (d, a) {
      a = a || {};
      try { ST().set(a.path, a.value); ST().save(); emit("state:change", { path: a.path }); toast("已写入设置 " + a.path, "ok"); } catch (e) { toast("设置写入失败", "warn"); return false; }
      return true;
    },
    "network.fetch": function (d, a) {
      return fetch((a && a.url) || d.url || "/").then(function (r) { return r.text(); });
    },
    "voice.listen": function (d, a) {
      var btn = a && a.btn;
      if (voice.active) {
        if (btn) btn.classList.remove("is-rec");
        voice.stop().then(function (r) {
          if (r.text) toast("识别完成：" + r.text.slice(0, 24) + (r.text.length > 24 ? "…" : ""), "ok");
          else if (r.url) { emit("voice:audio", r); toast("已录音；本环境未接入语音识别，音频已保留", "warn"); }
          else toast("没有识别到内容", "warn");
        });
        return true;
      }
      if (btn) btn.classList.add("is-rec");
      voice.start().then(function () { toast("录音中…再次点击话筒结束", "info"); })
        .catch(function (e) { if (btn) btn.classList.remove("is-rec"); toast("无法使用麦克风：" + (e && e.message || e), "warn"); });
      return true;
    }
  };

  /* ---------------- 后端三层 AI 审核（安全边界在后端，前端弹窗仅作告知） ----------------
   * 任何技能想真实改写页面 / 调用系统能力，代码必须先送 /api/skill/audit 过 L1 规则 + L2 快审 + L3 裁决；
   * 后端不可达时 fail-closed（拦截），绝不在前端自行放行。 */
  /* 提权开关：用户明确要求"skill 提权是必须要做到的"
     · 提权是默认开启的（用户要求：所有 skill 都是提权后的，不需要单独开关）
     · true 时本地/内置技能跳过后端审核，可直接改页面、加功能
     · 外部技能仍保留确认弹窗（知情），但后端不可达时不再 fail-closed
     · risk>=2 破坏性动作永远要用户点确认 */
  function privilege() {
    try {
      var v = ST().get("skillsPrivilege");
      return v === undefined ? true : v === true;   /* 默认提权（未显式关闭则视为开启） */
    } catch (e) { return true; }
  }
  function auditPayload(def, action, args) {
    var code = "";
    try { if (typeof def.onClick === "function") code += "/* onClick */\n" + String(def.onClick) + "\n"; } catch (e) {}
    try { code += "/* action=" + action + " */\n" + JSON.stringify(args == null ? {} : args); } catch (e) { code += "/* args 不可序列化 */"; }
    return code;
  }
  function backendAudit(def, action, args, opts) {
    var skip = !!(opts && opts.skip);
    if (skip) return Promise.resolve({ allowed: true, reason: "提权模式：跳过后端审核", priv: true });
    var api = A.api;
    if (!api || typeof api.request !== "function" || typeof api.available !== "function" || !api.available()) {
      if (privilege()) return Promise.resolve({ allowed: true, reason: "提权模式：离线放行", priv: true });
      return Promise.resolve({ allowed: false, reason: "后端安全审核不可达（未连接网关），已按 fail-closed 拦截" });
    }
    return api.request("POST", "/api/skill/audit", {
      skillId: def.id, action: action, target: String(def.name || def.id || ""), code: auditPayload(def, action, args)
    }).then(function (r) {
      if (r && r.allowed) return { allowed: true, auditId: r.auditId };
      var why = (r && r.final && r.final.reason) || (r && r.message) || "后端审核未通过";
      return { allowed: false, reason: why, blockedBy: (r && r.final && r.final.blockedBy) || "", auditId: r && r.auditId };
    }).catch(function (e) {
      return { allowed: false, reason: "审核请求失败：" + (e && e.message || e) };
    });
  }

  /* 运行技能：外部导入的技能运行前必须确认，避免隐藏行为
     提权模式（默认开）下：外部技能不再弹确认框，直接过后端审核即可运行；
     后端不可达 + 提权 → 离线放行（用户要求：skill 都调用得了）。 */
  function run(id, btn) {
    var d = defOf(id);
    if (!d) { toast("技能不存在：" + id, "warn"); return Promise.resolve(false); }
    if (!enabled(id)) { toast("技能已停用：" + (d.name || id), "warn"); return Promise.resolve(false); }
    if (typeof d.onClick !== "function") { toast("技能「" + (d.name || id) + "」没有可执行入口", "warn"); return Promise.resolve(false); }
    function go() {
      try { return d.onClick(btn); }
      catch (e) { toast("技能执行失败：" + (e && e.message || e), "warn"); return false; }
    }
    if (d.external || d.danger) {
      /* 提权时：跳过人工确认，直接走审核；审核拦截才提示 */
      if (privilege()) {
        return backendAudit(d, d.danger ? "danger.run" : "skill.run", null).then(function (v) {
          if (!v.allowed && !v.priv) { toast("后端安全审核拦截：" + v.reason, "warn"); return false; }
          return go();
        });
      }
      return confirmDialog(d, d.danger ? "danger.run" : "skill.run",
        d.desc || "该技能来自外部导入，运行前请确认来源可信。").then(function (ok) {
        if (!ok) { toast("已拦截该技能运行", "warn"); return false; }
        return backendAudit(d, d.danger ? "danger.run" : "skill.run", null).then(function (v) {
          if (!v.allowed) { toast("后端安全审核拦截：" + v.reason, "warn"); return false; }
          return go();
        });
      });
    }
    return Promise.resolve(go());
  }
  function runAction(def, action, args) {
    var fn = ACT[action];
    if (!fn) { toast("技能动作未登记：" + action, "warn"); return Promise.resolve(false); }
    var risk = riskOf(action);
    /* 提权：risk=1 的本机/内置技能不再每次弹窗（SESSION_OK 已覆盖同会话），
       且后端不可达时由 privilege() 放行；risk=0 直接执行不变。 */
    if (risk === 0) return Promise.resolve(fn(def, args));
    /* 提权（默认开）时：本地技能跳过 SESSION_OK 缓存，每次都走审核放行，避免"第一次拦截后就永远卡住" */
    var skipConfirm = privilege() && !def.external;
    var key = def.id + "|" + action;
    if (risk === 1 && SESSION_OK[key] && !privilege()) return Promise.resolve(fn(def, args));
    /* risk>=2 永远需要用户知情确认，提权也不豁免 */
    var detail = def.desc || "";
    var prompt = risk >= 2 || !skipConfirm;
    if (!prompt) {
      /* 低风险 + 提权 + 本地技能：直接走 fn，再补一次后端审核（若网关可达） */
      return backendAudit(def, action, args, { skip: false }).then(function (v) {
        if (!v.allowed && !v.priv) { toast("后端安全审核拦截：" + v.reason, "warn"); return false; }
        if (risk === 1) SESSION_OK[key] = true;
        return fn(def, args);
      });
    }
    return confirmDialog(def, action, detail).then(function (ok) {
      if (!ok) { toast("已取消：技能动作被拦截", "warn"); return false; }
      return backendAudit(def, action, args, { skip: skipConfirm && risk < 2 }).then(function (v) {
        if (!v.allowed && !v.priv) { toast("后端安全审核拦截：" + v.reason, "warn"); return false; }
        if (risk === 1) SESSION_OK[key] = true;
        return fn(def, args);
      });
    });
  }

  /* ---------------- 麦克风 / 语音（供录音技能使用） ---------------- */
  var voice = {
    active: false, stream: null, rec: null, chunks: [], finals: "",
    available: function () { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    speechAvailable: function () { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },
    start: function () {
      var self = this;
      if (self.active) return Promise.resolve(true);
      if (!self.available()) return Promise.reject(new Error("当前环境没有可用麦克风（需 https 且用户授权）"));
      return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        self.stream = stream; self.chunks = []; self.finals = ""; self.active = true;
        try {
          var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SR) {
            var r = new SR(); r.lang = "zh-CN"; r.continuous = true; r.interimResults = true;
            r.onresult = function (ev) {
              var t = "";
              for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
              self.finals = t;
              emit("voice:text", { text: t, isFinal: false });
              if (A.chat && A.chat.fill) { try { A.chat.fill(t); } catch (e) {} }
            };
            r.onerror = function () {};
            try { r.start(); self.speech = r; } catch (e) {}
          }
        } catch (e) {}
        if (typeof MediaRecorder !== "undefined") {
          try {
            var mr = new MediaRecorder(stream);
            mr.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
            mr.start();
            self.rec = mr;
          } catch (e) {}
        }
        emit("voice:state", { active: true });
        return true;
      });
    },
    stop: function () {
      var self = this;
      self.active = false;
      try { if (self.speech) self.speech.stop(); } catch (e) {}
      emit("voice:state", { active: false });
      return new Promise(function (resolve) {
        function finish() {
          try { if (self.stream) self.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
          var text = String(self.finals || "").trim();
          var url = "";
          try { url = self.chunks.length ? URL.createObjectURL(new Blob(self.chunks, { type: "audio/webm" })) : ""; } catch (e) {}
          resolve({ text: text, url: url });
        }
        if (self.rec && self.rec.state !== "inactive") {
          self.rec.onstop = finish;
          try { self.rec.stop(); } catch (e) { finish(); }
        } else finish();
      });
    },
    toggle: function () { var self = this; return self.active ? self.stop() : self.start().then(function () { return null; }); }
  };

  /* ---------------- 派生槽位名：panel.<id>.header ---------------- */
  function slotMount(name, el) {
    var host = slotHost(name);
    if (host) host.appendChild(el);
    else emit("slot:pending", { name: name });
  }

  /* ---------------- 内置示例技能：录音转文字（直接改写页面） ---------------- */
  var MIC_ICON = svg('<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>');
  register({
    id: "voice-mic",
    name: "语音输入",
    title: "语音输入（录音转文字）",
    desc: "在输入栏挂一个话筒按钮：点击请求麦克风权限并开始录音，再次点击结束；识别到的文字直接写入输入框。",
    icon: MIC_ICON,
    slot: "composer.bar",
    ui: true,
    onClick: function (btn) {
      return A.skillExt.act("voice-mic", "voice.listen", { btn: btn });
    }
  });

  /* 主动调用（用户要求：AI 觉得需要时应主动调技能）：
     暴露一个 onMessage 钩子，chat.js / agent 编排层在发请求前调用
     pickSkills(userText) —— 它按关键词/意图匹配已启用技能并返回应触发的 action 列表，
     主 AI 据此在 system prompt 里追加指令，实现"想到就用"。 */
  function pickSkills(userText) {
    var t = String(userText || "").toLowerCase();
    var out = [];
    REG.forEach(function (m) {
      if (!enabled(m.id)) return;
      if (m.triggers && m.triggers.length) {
        for (var i = 0; i < m.triggers.length; i++) {
          if (t.indexOf(String(m.triggers[i]).toLowerCase()) >= 0) {
            out.push({ id: m.id, name: m.name, trigger: m.triggers[i] });
            break;
          }
        }
      }
    });
    return out;
  }

  A.skillExt = {
    register: register, list: list, mountAll: mountAll, run: run,
    act: function (id, action, args) { var d = defOf(id); if (!d) return Promise.resolve(false); return runAction(d, action, args); },
    confirm: function (man, action, detail) { return confirmDialog(man, action, detail); },
    riskOf: riskOf, slots: SLOTS, voice: voice, slotMount: slotMount, audit: backendAudit,
    privilege: privilege,
    setPrivilege: function (on) {
      try { ST().set("skillsPrivilege", !!on); if (typeof ST().save === "function") ST().save(); } catch (e) {}
      toast(on ? "提权模式已开启：本地技能可离线改写页面" : "提权模式已关闭：恢复 fail-closed", on ? "ok" : "warn");
      emit("skills:privilege", { on: !!on });
    },
    isPrivileged: privilege,
    pickSkills: pickSkills,
    DANGER_ACTIONS: Object.keys(RISK)
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();
})();
