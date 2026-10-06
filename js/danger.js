/* AYCHO module: js/danger | 危险指令二次核验闸门
 * 仅作用于 AI / 外部执行入口（A.bus 'terminal:run' 与 A.terminal.run）；
 * 用户在终端里手动敲的命令、以及用户点「运行」按钮触发的命令（byUser:true）不拦截。
 *
 * 命中危险规则时弹出爆红确认框，必须用「登录密码」或「邮箱验证码」核验身份后才会放行，
 * 也可选择「本会话始终允许」该条规则（会话级，刷新即失效）。
 *
 * 对外：AYCHO.danger.inspect(cmd) / guard(cmd, {byUser}) / allowOnceRule(why) / reset()
 */
(function () {
  var A = window.AYCHO || (window.AYCHO = {});
  var RULES = [
    { id: 'rm-root', why: '递归删除根目录 / 家目录 / 通配路径', re: /\brm\s+(-\w+\s+)*(\/|~|\$HOME|\/\*)(\s|$)/i },
    { id: 'rm-rf', why: '递归强制删除文件（不可恢复）', re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*[fF]|-[a-zA-Z]*[fF][a-zA-Z]*[rR])\b/i },
    { id: 'wipe', why: '磁盘格式化 / 分区擦写（mkfs / fdisk / wipefs）', re: /\b(mkfs(\.\w+)?|fdisk|sfdisk|parted|wipefs|hdparm\s+--security-erase)\b/i },
    { id: 'dd-dev', why: '直接写入块设备（可能损毁磁盘）', re: /\bdd\b[^\n]*\bof=\/dev\//i },
    { id: 'forkbomb', why: 'fork 炸弹（耗尽系统进程）', re: /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;\s*:/ },
    { id: 'chmod-root', why: '把系统目录权限改为全开', re: /\bchmod\s+(-[a-zA-Z]+\s+)*(777|a\+rwx)\s+\/(?!tmp|sdcard|storage)/i },
    { id: 'chown-root', why: '批量修改系统目录属主', re: /\bchown\s+(-[a-zA-Z]+\s+)*[^\s]+\s+\/(?!tmp|sdcard|storage)/i },
    { id: 'power', why: '关机 / 重启 / 停机', re: /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i },
    { id: 'kill-sys', why: '结束系统关键进程', re: /\b(kill|pkill|killall)\s+(-[a-zA-Z0-9]+\s+)*(1|init|systemd|zygote|surfaceflinger)\b/i },
    { id: 'overwrite-sys', why: '覆盖系统关键目录中的文件', re: />>?\s*(\/etc\/|\/usr\/|\/boot\/|\/bin\/|\/sbin\/|\/system\/|\/vendor\/)/i },
    { id: 'write-sys', why: '向系统关键目录写入 / 移动文件', re: /\b(mv|cp|install)\s+[^\n]+\s+(\/etc\/|\/usr\/|\/boot\/|\/bin\/|\/sbin\/|\/system\/|\/vendor\/)/i },
    { id: 'flash', why: '擦除 / 刷写分区（fastboot erase / flash）', re: /\b(fastboot\s+(erase|flash|format)|flash\s+partition)\b/i },
    { id: 'win-format', why: '格式化磁盘 / 递归删除（Windows 语义）', re: /\b(format\s+[a-zA-Z]:|del\s+\/[sq]\b|rd\s+\/s\b)/i },
    { id: 'git-nuke', why: '丢弃全部本地改动 / 清空版本库', re: /\b(git\s+reset\s+--hard|git\s+clean\s+-[a-zA-Z]*[dfx]|git\s+push\s+[^\n]*--force)\b/i },
    { id: 'drop-db', why: '删除数据库 / 表', re: /\b(DROP\s+(DATABASE|TABLE)|TRUNCATE\s+TABLE)\b/i }
  ];

  var sessionAllow = {};
  var chain = Promise.resolve();

  function toast(text, type) {
    if (A.toast) { A.toast(text, type); return; }
    if (A.bus && A.bus.emit) A.bus.emit('toast', { text: text, type: type });
  }

  function userRules() {
    try {
      var extra = (A.store && A.store.get('settings.danger.rules')) || [];
      return Array.isArray(extra) ? extra : [];
    } catch (e) { return []; }
  }

  function inspect(cmd) {
    var s = String(cmd == null ? '' : cmd);
    if (!s.trim()) return null;
    var list = RULES.concat(userRules());
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      try { if (r.re.test(s)) return { id: r.id || ('rule-' + i), why: r.why || '命中危险指令规则' }; } catch (e) {}
    }
    return null;
  }

  /* ------------------------------------------------------------ 弹窗 */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function authApi() { return (A.api && A.api.auth) || null; }

  function ask(cmd, hit) {
    return new Promise(function (resolve) {
      if (!document || !document.body) { resolve(false); return; }
      var method = 'password';
      var mask = el('div', { class: 'ax-danger-mask' });
      var input = el('input', { type: 'password', placeholder: '请输入登录密码', autocomplete: 'current-password' });
      var codeBtn = el('button', { class: 'ax-danger__code', type: 'button', text: '发送验证码' });
      codeBtn.hidden = true;
      var errBox = el('div', { class: 'ax-danger__err' });
      var onceBtn = el('button', { class: 'g-once', type: 'button', text: '核验并执行' });
      var alwaysBtn = el('button', { class: 'g-always', type: 'button', text: '本会话始终允许' });
      var cancelBtn = el('button', { class: 'g-cancel', type: 'button', text: '取消执行' });

      var tabPw = el('button', { class: 'is-on', type: 'button', text: '登录密码' });
      var tabCode = el('button', { type: 'button', text: '邮箱验证码' });
      function pick(m) {
        method = m;
        tabPw.classList.toggle('is-on', m === 'password');
        tabCode.classList.toggle('is-on', m === 'code');
        input.value = '';
        input.type = m === 'password' ? 'password' : 'text';
        input.placeholder = m === 'password' ? '请输入登录密码' : '请输入邮件里的 6 位验证码';
        codeBtn.hidden = m !== 'code';
        errBox.textContent = '';
      }
      tabPw.addEventListener('click', function () { pick('password'); });
      tabCode.addEventListener('click', function () { pick('code'); });

      codeBtn.addEventListener('click', function () {
        var api = authApi();
        if (!api || !api.sendCode) { errBox.textContent = '后端未连接，无法发送验证码'; return; }
        if (!A.api.available()) { errBox.textContent = '后端未连接，无法发送验证码'; return; }
        codeBtn.disabled = true; codeBtn.textContent = '发送中…';
        api.sendCode('', 'verify').then(function () {
          errBox.textContent = '';
          toast('验证码已发送到你的注册邮箱', 'ok');
          var left = 60;
          codeBtn.textContent = left + 's 后可重发';
          var t = setInterval(function () {
            left--; codeBtn.textContent = left + 's 后可重发';
            if (left <= 0) { clearInterval(t); codeBtn.disabled = false; codeBtn.textContent = '重新发送'; }
          }, 1000);
        }, function (e) {
          codeBtn.disabled = false; codeBtn.textContent = '重新发送';
          errBox.textContent = (e && e.message) || '验证码发送失败';
        });
      });

      function busy(on) {
        onceBtn.disabled = on; alwaysBtn.disabled = on; cancelBtn.disabled = on;
        onceBtn.textContent = on ? '核验中…' : '核验并执行';
      }

      function doVerify() {
        var api = authApi();
        if (!api || (!api.verify && !api.verifyCode)) {
          errBox.textContent = '后端未连接，无法完成身份核验';
          return Promise.reject(new Error('核验接口不可用'));
        }
        var val = String(input.value || '').trim();
        if (!val) { errBox.textContent = method === 'password' ? '请输入登录密码' : '请输入邮箱验证码'; return Promise.reject(new Error('empty')); }
        return method === 'password' ? api.verify(val) : api.verifyCode(val);
      }

      function finish(ok, always) {
        try { document.body.removeChild(mask); } catch (e) {}
        document.removeEventListener('keydown', onKey, true);
        if (ok && always) sessionAllow[hit.why] = true;
        resolve(ok);
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); onceBtn.click(); }
      }

      cancelBtn.addEventListener('click', function () { finish(false); });
      onceBtn.addEventListener('click', function () {
        errBox.textContent = '';
        busy(true);
        doVerify().then(function () { busy(false); finish(true, false); }, function (e) {
          busy(false);
          if (e && e.message && e.message !== 'empty') errBox.textContent = e.message;
          else if (!input.value) errBox.textContent = method === 'password' ? '请输入登录密码' : '请输入邮箱验证码';
        });
      });
      alwaysBtn.addEventListener('click', function () {
        errBox.textContent = '';
        busy(true);
        doVerify().then(function () { busy(false); toast('本会话内该指令不再拦截', 'warn'); finish(true, true); }, function (e) {
          busy(false);
          if (e && e.message && e.message !== 'empty') errBox.textContent = e.message;
        });
      });

      var card = el('div', { class: 'ax-danger', role: 'dialog', 'aria-modal': 'true' }, [
        el('div', { class: 'ax-danger__hd' }, [el('span', { class: 'ax-danger__beacon' }), el('span', { text: '危险指令已被拦截' })]),
        el('div', { class: 'ax-danger__bd' }, [
          el('div', { class: 'ax-danger__sub', html: 'AI / 外部入口试图执行高风险系统指令。<br>核验身份后才会真正执行，避免误删与不可逆损坏。' }),
          el('div', { class: 'ax-danger__cmd', text: String(cmd) }),
          el('div', { class: 'ax-danger__why', html: '命中规则：<b>' + String(hit.why) + '</b>' }),
          el('div', { class: 'ax-danger__tabs' }, [tabPw, tabCode]),
          el('div', { class: 'ax-danger__row' }, [input, codeBtn]),
          errBox
        ]),
        el('div', { class: 'ax-danger__ft' }, [cancelBtn, alwaysBtn, onceBtn])
      ]);
      mask.appendChild(card);
      document.body.appendChild(mask);
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 40);
    });
  }

  /* ------------------------------------------------------------ 对外 API */
  function guard(cmd, opts) {
    opts = opts || {};
    if (opts.byUser) return Promise.resolve(true);          // 用户手动输入 / 用户点按钮：不拦截
    var hit = inspect(cmd);
    if (!hit) return Promise.resolve(true);
    if (sessionAllow[hit.why]) return Promise.resolve(true);
    // 串行化，避免多条并发指令同时弹窗
    chain = chain.then(function () { return ask(cmd, hit); });
    return chain;
  }

  A.danger = {
    inspect: inspect,
    guard: guard,
    rules: function () { return RULES.slice(); },
    allowThisSession: function (why) { sessionAllow[why] = true; },
    reset: function () { sessionAllow = {}; }
  };
})();
