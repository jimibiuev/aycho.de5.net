/* ============================================================
   AYCHO module: auth  |  账号：登录 / 注册 / 找回密码
   · 登录页极简：邮箱 + 密码 → 登录（一个按钮）
   · 注册页完整：邮箱 + 密码 + 确认密码 + 邮箱验证码
   · 子目录：/login/ 打开即登录页，/register/ 打开即注册页；
     未登录时地址栏自动同步为 /login/，刷新后仍停在登录页
   · 账号由服务端真实落库（/api/auth/*），容器重建后自动从云端恢复，
     不会出现「数据还在、账号却显示未注册」的假象
   事件：auth:login {user} / auth:logout
   ============================================================ */
(function () {
  'use strict';
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util, el = U.el, icons = A.icons;

  /* 子目录入口：window.AYCHO_AUTH_VIEW = login | register | reset */
  const VIEW = (function () {
    const v = String(window.AYCHO_AUTH_VIEW || '').toLowerCase();
    return (v === 'register' || v === 'reset') ? v : 'login';
  })();
  const ABS = (typeof location !== 'undefined') && /^https?:$/.test(location.protocol);

  const S = {
    mode: VIEW,                  // login | register | reset
    email: '', pwd: '', pwd2: '', code: '',
    sending: false, checking: false,
    cd: 0, cdTimer: null,
    error: '', notice: '', offerRegister: false,
    /* 登录闸门出现在哪个面板页，登录成功后回到哪里 */
    backPath: (function () {
      const p = (typeof location !== 'undefined' && location.pathname) || '';
      return /\/(login|register)\/?$/.test(p) ? '' : (p && p !== '/' ? p : '');
    })()
  };
  let host, refs = {};

  const online = () => !!(A.api && A.api.available());
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
  function toast(t, ty) { if (A.toast) A.toast(t, ty); }

  /* ---------------- 密码强度 ---------------- */
  const LEVEL_TEXT = ['请输入密码', '太弱：长度不足 8 位', '偏弱：再混合大小写与数字', '不错：可以再长一些', '很强：符合安全要求'];
  function strength(p) {
    p = String(p || '');
    const rules = { len: p.length >= 8, lower: /[a-z]/.test(p), upper: /[A-Z]/.test(p), num: /\d/.test(p) };
    const okCount = Object.keys(rules).filter((k) => rules[k]).length;
    let level = 0;
    if (!p.length) level = 0;
    else if (p.length < 8) level = 1;
    else if (okCount <= 2) level = 2;
    else if (okCount === 3) level = 3;
    else level = 4;
    if (p.length >= 12 && okCount === 4) level = 4;
    return { rules, level, ok: rules.len && rules.lower && rules.upper && rules.num };
  }

  /* ---------------- 地址栏（登录 / 注册子目录） ---------------- */
  function syncUrl() {
    if (!ABS) return;
    try {
      const p = location.pathname || '';
      if (S.mode === 'register') {
        if (!/\/register\/?$/.test(p)) history.replaceState(null, '', '/register/');
      } else if (!/\/login\/?$/.test(p)) {
        history.replaceState(null, '', '/login/');
      }
    } catch (e) { /* 忽略：仅影响地址栏 */ }
  }
  function backToApp() {
    if (!ABS) return;
    try {
      const target = S.backPath || '/start/';
      if (location.pathname !== target) history.replaceState(null, '', target);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- DOM 基础 ---------------- */
  function brandHead() {
    return el('div', { class: 'ax-auth__brand' },
      el('span', { class: 'ax-brand__logo' }, el('span', { text: 'A' })),
      el('div', null,
        el('h1', { text: 'AYCHO' }),
        el('p', { text: 'The agent can help you get everything done' })
      )
    );
  }

  function field(label, node, hint) {
    return el('div', { class: 'ax-field' },
      el('div', { class: 'ax-field__label' },
        el('span', { text: label }),
        hint ? el('span', { class: 'ax-hint', text: hint }) : null),
      node
    );
  }

  function pwdField(placeholder, value, oninput, ac) {
    const input = el('input', {
      class: 'ax-input', type: 'password', placeholder: placeholder,
      autocomplete: ac || 'current-password', value: value || ''
    });
    input.addEventListener('input', () => oninput(input.value));
    const eye = el('button', { class: 'ax-inputwrap__act', type: 'button', title: '显示 / 隐藏密码', html: icons.get('eye', 17) });
    let shown = false;
    eye.addEventListener('click', (e) => {
      e.preventDefault();
      shown = !shown;
      input.type = shown ? 'text' : 'password';
      eye.classList.toggle('is-on', shown);
      try { input.focus(); } catch (_) {}
    });
    return el('div', { class: 'ax-inputwrap' }, input, eye);
  }

  function msgsNode() {
    const box = el('div', { class: 'ax-auth__msgs' });
    refs.msgs = box;
    paintMsgs();
    return box;
  }

  function paintMsgs() {
    const box = refs.msgs;
    if (!box) return;
    box.innerHTML = '';
    if (S.error) box.appendChild(el('div', { class: 'ax-auth__err is-on', text: S.error }));
    if (S.notice) box.appendChild(el('div', { class: 'ax-auth__notice', text: S.notice }));
    if (S.offerRegister) {
      const b = el('button', { class: 'ax-auth__offer', type: 'button' },
        el('span', { text: '用 ' + (S.email || '该邮箱') + ' 注册新账号' }));
      b.addEventListener('click', () => openMode('register'));
      box.appendChild(b);
    }
    box.hidden = !(S.error || S.notice || S.offerRegister);
  }

  function fail(msg) { S.error = msg || ''; S.notice = ''; paintMsgs(); }
  function note(msg) { S.notice = msg || ''; S.error = ''; paintMsgs(); }
  function clearMsgs() { S.error = ''; S.notice = ''; S.offerRegister = false; paintMsgs(); }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.innerHTML = '';
    btn.appendChild(busy ? el('span', { class: 'ax-auth__spin' }) : el('span', { html: icons.get('check', 16) }));
    btn.appendChild(el('span', { text: label }));
    btn.disabled = !!busy;
  }

  /* ---------------- 视图 ---------------- */
  function render() {
    if (!host) return;
    host.innerHTML = '';
    const card = el('div', { class: 'ax-auth__card' + (S.mode === 'register' ? ' ax-auth__card--wide' : '') },
      el('div', { class: 'ax-auth__glow' }),
      brandHead(),
      S.mode === 'login' ? viewLogin() : (S.mode === 'register' ? viewRegister() : viewReset()),
      el('div', { class: 'ax-auth__mode' },
        online()
          ? el('span', { class: 'ax-auth__tag is-ok', text: '已连接服务端 · 账号实时落库' })
          : el('span', { class: 'ax-auth__tag', text: '正在连接服务端…' }))
    );
    host.appendChild(card);
    refs.card = card;
    syncUrl();
    const first = card.querySelector('input');
    if (first && !first.value) { try { first.focus(); } catch (_) {} }
  }

  /* 登录页：只有邮箱 + 密码 */
  function viewLogin() {
    const email = el('input', {
      class: 'ax-input', type: 'email', placeholder: '邮箱地址',
      autocomplete: 'username', inputmode: 'email', value: S.email || ''
    });
    email.addEventListener('input', () => { S.email = email.value; });
    const pwd = pwdField('密码', S.pwd, (v) => { S.pwd = v; }, 'current-password');
    const pwdInput = pwd.querySelector('input');

    const btn = el('button', { class: 'ax-auth__submit ax-auth__submit--primary ax-auth__submit--lg', type: 'button' },
      el('span', { text: '登 录' }));
    btn.addEventListener('click', () => submitLogin(btn));
    pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(btn); });
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwdInput.focus(); });

    const signup = el('button', { class: 'ax-auth__signup', type: 'button' },
      el('span', { text: '注册新账号' }), el('span', { class: 'ax-auth__signup-arrow', text: '→' }));
    signup.addEventListener('click', () => openMode('register'));

    return el('div', { class: 'ax-auth__panel', dataset: { panel: 'login' } },
      el('h2', { class: 'ax-auth__title', text: '欢迎回来' }),
      el('p', { class: 'ax-auth__sub', text: '输入邮箱与密码即可进入工作台' }),
      msgsNode(),
      el('div', { class: 'ax-auth__form' },
        field('邮箱', email),
        field('密码', pwd)
      ),
      btn,
      el('div', { class: 'ax-auth__cta' },
        el('span', { class: 'ax-auth__cta-text', text: '还没有账号？' }),
        signup
      ),
      el('div', { class: 'ax-auth__foot' },
        el('button', { class: 'ax-auth__link', type: 'button', onclick: () => openMode('reset') }, '忘记密码？')
      )
    );
  }

  /* 注册页：邮箱 + 密码 + 确认密码 + 邮箱验证码 */
  function viewRegister() {
    const email = el('input', {
      class: 'ax-input', type: 'email', placeholder: '邮箱地址（用于登录与找回密码）',
      autocomplete: 'email', inputmode: 'email', value: S.email || ''
    });
    email.addEventListener('input', () => { S.email = email.value; });

    const pwd = pwdField('至少 8 位，含大小写字母与数字', S.pwd, (v) => { S.pwd = v; }, 'new-password');
    const pwdInput = pwd.querySelector('input');

    const bar = el('i');
    const stText = el('span', { class: 'ax-strength__text', text: LEVEL_TEXT[0] });
    const meter = el('div', { class: 'ax-strength' }, el('div', { class: 'ax-strength__bar' }, bar), stText);
    function refreshStrength() {
      const st = strength(S.pwd);
      bar.style.width = (st.level * 25) + '%';
      bar.dataset.level = String(st.level);
      stText.textContent = LEVEL_TEXT[st.level];
    }
    pwdInput.addEventListener('input', refreshStrength);
    refreshStrength();

    const pwd2 = pwdField('再次输入密码', S.pwd2, (v) => { S.pwd2 = v; }, 'new-password');

    const codeInput = el('input', {
      class: 'ax-input ax-input--code', type: 'text', inputmode: 'numeric', maxlength: '6',
      placeholder: '邮箱验证码', autocomplete: 'one-time-code', value: S.code || ''
    });
    codeInput.addEventListener('input', () => {
      codeInput.value = String(codeInput.value || '').replace(/\D/g, '').slice(0, 6);
      S.code = codeInput.value;
    });
    const sendBtn = el('button', { class: 'ax-codebtn', type: 'button' },
      el('span', { text: S.cd > 0 ? S.cd + 's 后重发' : '获取验证码' }));
    sendBtn.disabled = S.cd > 0;
    sendBtn.addEventListener('click', () => doSendCode(sendBtn));
    const codeRow = el('div', { class: 'ax-coderow' }, codeInput, sendBtn);

    const btn = el('button', { class: 'ax-auth__submit ax-auth__submit--primary ax-auth__submit--lg', type: 'button' },
      el('span', { text: '注册并进入 AYCHO' }));
    btn.addEventListener('click', () => submitRegister(btn));
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRegister(btn); });
    pwd2.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRegister(btn); });

    const back = el('button', { class: 'ax-auth__signup ax-auth__signup--ghost', type: 'button' }, el('span', { text: '返回登录' }));

    back.addEventListener('click', () => openMode('login'));

    return el('div', { class: 'ax-auth__panel', dataset: { panel: 'register' } },
      el('h2', { class: 'ax-auth__title', text: '创建 AYCHO 账号' }),
      el('p', { class: 'ax-auth__sub', text: '注册后账号保存在服务端，换设备 / 更新页面都无需重新注册' }),
      msgsNode(),
      el('div', { class: 'ax-auth__form' },
        field('邮箱', email),
        field('密码', pwd, '强度：' + LEVEL_TEXT[strength(S.pwd).level]),
        meter,
        field('确认密码', pwd2),
        field('邮箱验证码', codeRow, '10 分钟内有效')
      ),
      btn,
      el('div', { class: 'ax-auth__cta' },
        el('span', { class: 'ax-auth__cta-text', text: '已有账号？' }),
        back
      )
    );
  }

  /* 找回密码：邮箱 + 验证码 + 新密码 */
  function viewReset() {
    const email = el('input', {
      class: 'ax-input', type: 'email', placeholder: '注册时使用的邮箱',
      autocomplete: 'email', inputmode: 'email', value: S.email || ''
    });
    email.addEventListener('input', () => { S.email = email.value; });

    const codeInput = el('input', {
      class: 'ax-input ax-input--code', type: 'text', inputmode: 'numeric', maxlength: '6',
      placeholder: '邮箱验证码', autocomplete: 'one-time-code', value: S.code || ''
    });
    codeInput.addEventListener('input', () => {
      codeInput.value = String(codeInput.value || '').replace(/\D/g, '').slice(0, 6);
      S.code = codeInput.value;
    });
    const sendBtn = el('button', { class: 'ax-codebtn', type: 'button' },
      el('span', { text: S.cd > 0 ? S.cd + 's 后重发' : '获取验证码' }));
    sendBtn.disabled = S.cd > 0;
    sendBtn.addEventListener('click', () => doSendCode(sendBtn));

    const pwd = pwdField('新密码：至少 8 位，含大小写与数字', S.pwd, (v) => { S.pwd = v; }, 'new-password');

    const btn = el('button', { class: 'ax-auth__submit ax-auth__submit--primary ax-auth__submit--lg', type: 'button' },
      el('span', { text: '重设密码并登录' }));
    btn.addEventListener('click', () => submitReset(btn));

    const back = el('button', { class: 'ax-auth__signup ax-auth__signup--ghost', type: 'button' }, el('span', { text: '返回登录' }));
    back.addEventListener('click', () => openMode('login'));

    return el('div', { class: 'ax-auth__panel', dataset: { panel: 'reset' } },
      el('h2', { class: 'ax-auth__title', text: '重设密码' }),
      el('p', { class: 'ax-auth__sub', text: '验证邮箱后设置新的登录密码' }),
      msgsNode(),
      el('div', { class: 'ax-auth__form' },
        field('邮箱', email),
        field('邮箱验证码', el('div', { class: 'ax-coderow' }, codeInput, sendBtn)),
        field('新密码', pwd)
      ),
      btn,
      el('div', { class: 'ax-auth__cta' },
        el('span', { class: 'ax-auth__cta-text', text: '想起来了？' }),
        back
      )
    );
  }

  function openMode(m) {
    S.mode = m;
    S.error = ''; S.notice = ''; S.offerRegister = false;
    render();
  }

  /* ---------------- 业务逻辑 ---------------- */
  const NEED_ONLINE = '当前无法连接服务端：账号保存在云端，需要联网才能登录 / 注册。请检查网络后重试。';

  async function submitLogin(btn) {
    if (S.checking) return;
    clearMsgs();
    const email = String(S.email || '').trim().toLowerCase();
    if (!isEmail(email)) return fail('请输入正确的邮箱地址');
    if (!S.pwd) return fail('请输入登录密码');
    if (!online()) return fail(NEED_ONLINE);
    S.checking = true;
    setBusy(btn, true, '正在登录…');
    try {
      const r = await A.api.auth.login(email, S.pwd);
      setBusy(btn, false, '登录成功');
      applySession(r);
      finish(r.user);
    } catch (e) {
      S.checking = false;
      setBusy(btn, false, '登 录');
      if (e && e.status === 404) {
        S.offerRegister = true;
        fail('服务端没有该邮箱的注册记录（' + email + '）');
      } else if (e && e.status === 401) {
        fail('密码不正确，请重试');
      } else {
        fail((e && e.message) || '登录失败');
      }
    }
  }

  async function submitRegister(btn) {
    if (S.checking) return;
    clearMsgs();
    const email = String(S.email || '').trim().toLowerCase();
    if (!isEmail(email)) return fail('请输入正确的邮箱地址');
    const st = strength(S.pwd);
    if (!st.ok) return fail('密码至少 8 位，且需同时包含大写字母、小写字母与数字');
    if (S.pwd !== S.pwd2) return fail('两次输入的密码不一致');
    if (!/^\d{6}$/.test(String(S.code || ''))) return fail('请输入 6 位邮箱验证码');
    if (!online()) return fail(NEED_ONLINE);
    S.checking = true;
    setBusy(btn, true, '正在注册…');
    const name = (email.split('@')[0] || '老板').replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    try {
      const r = await A.api.auth.register(email, S.pwd, String(S.code), name);
      setBusy(btn, false, '注册成功');
      applySession(r);
      finish(r.user);
    } catch (e) {
      S.checking = false;
      setBusy(btn, false, '注册并进入 AYCHO');
      if (e && e.status === 409) {
        S.offerRegister = false;
        S.notice = '该邮箱已经注册过，请直接登录';
        S.error = '';
        paintMsgs();
        toast('该邮箱已存在，请直接登录', 'warn');
      } else {
        fail((e && e.message) || '注册失败');
      }
    }
  }

  async function submitReset(btn) {
    if (S.checking) return;
    clearMsgs();
    const email = String(S.email || '').trim().toLowerCase();
    if (!isEmail(email)) return fail('请输入正确的邮箱地址');
    if (!/^\d{6}$/.test(String(S.code || ''))) return fail('请输入 6 位邮箱验证码');
    const st = strength(S.pwd);
    if (!st.ok) return fail('新密码至少 8 位，且需同时包含大写字母、小写字母与数字');
    if (!online()) return fail(NEED_ONLINE);
    S.checking = true;
    setBusy(btn, true, '正在重设…');
    try {
      const r = await A.api.auth.resetPassword(email, String(S.code), S.pwd);
      setBusy(btn, false, '重设成功');
      applySession(r);
      finish(r.user);
    } catch (e) {
      S.checking = false;
      setBusy(btn, false, '重设密码并登录');
      fail((e && e.message) || '重设失败');
    }
  }

  /* 发送邮箱验证码（注册 / 找回密码共用） */
  async function doSendCode(btn) {
    clearMsgs();
    const email = String(S.email || '').trim().toLowerCase();
    if (!isEmail(email)) return fail('请先填写邮箱地址');
    if (!online()) return fail(NEED_ONLINE);
    if (S.cd > 0) return;
    const scene = S.mode === 'reset' ? 'reset' : 'register';
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      await A.api.auth.sendCode(email, scene);
      startCd(btn);
      note('验证码已发送至 ' + email + '，10 分钟内有效');
      toast('验证码已发送，请查收邮件（含垃圾箱）', 'ok');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = label;
      /* 服务端新语义：ok:false 时 e.data 可能带 needActivate / channel / note */
      const d = (e && e.data) || {};
      if (e && e.status === 404 && String(d.message || e.message).indexOf('尚未注册') >= 0)
        fail('该邮箱尚未注册，请先走「注册」流程拿验证码（注册后才能登录）');
      else if (e && e.status === 409) fail('该邮箱已注册，请直接登录');
      else if (d.needActivate) fail('首次使用转发通道：请先到邮箱（含垃圾箱）点 "Activate Form" 激活，再重新获取验证码');
      else if (d.pending) fail('验证码已提交 GitHub 中继队列，投递约需 1–3 分钟，请稍候查收');
      else if (e && (e.status === 429 || e.status === 502)) fail((d.message || e.message) || '发送失败，请稍后重试');
      else fail((d.message || e.message) || '验证码发送失败');
    }
  }

  function startCd(btn) {
    S.cd = 60;
    const paint = () => { btn.textContent = S.cd > 0 ? S.cd + 's 后重发' : '获取验证码'; };
    paint();
    if (S.cdTimer) clearInterval(S.cdTimer);
    S.cdTimer = setInterval(() => {
      S.cd--;
      if (S.cd <= 0) {
        clearInterval(S.cdTimer); S.cdTimer = null; S.cd = 0;
        btn.disabled = false;
        paint();
        return;
      }
      paint();
    }, 1000);
  }

  function applySession(r) {
    if (r && r.token) A.api.setToken(r.token);
    if (r && r.user) {
      A.store.set('user', {
        name: r.user.name || '老板', email: r.user.email || '',
        avatar: r.user.avatar || '', id: r.user.id
      });
    }
  }

  function finish(user) {
    const u = user || { name: '老板', email: S.email, avatar: '' };
    A.store.set('authed', true);
    A.bus.emit('auth:login', { user: u });
    backToApp();
    toast('欢迎回来，' + (u.name || '老板'), 'ok');
  }

  /* ---------------- 会话恢复 ---------------- */
  /* 只在服务端明确返回 401/403 时才清本地令牌；
     网关冷启动 / 网络抖动导致的失败保留令牌并重试，避免「一刷新就要求重新登录」 */
  async function restore(attempt) {
    attempt = attempt || 0;
    if (!online() || !A.api.token()) return false;
    try {
      const r = await A.api.auth.me();
      A.store.set('user', {
        name: r.user.name || '老板', email: r.user.email || '',
        avatar: r.user.avatar || '', id: r.user.id
      });
      A.store.set('authed', true);
      A.bus.emit('auth:login', { user: r.user, restored: true });
      return true;
    } catch (e) {
      const status = e && e.status;
      if (status === 401 || status === 403) {
        A.api.setToken('');
        A.store.set('authed', false);
        return false;
      }
      if (attempt < 4) {
        setTimeout(() => { restore(attempt + 1); }, 4000 * (attempt + 1));
      }
      return false;
    }
  }

  /* ---------------- 挂载 ---------------- */
  A.auth = {
    mount() {
      host = document.getElementById('ax-auth');
      if (!host) return;
      render();
      if (!A.__authRestoreHooked) {
        A.__authRestoreHooked = true;
        A.bus.on('api:ready', (e) => { if (e && e.online) restore(0); });
      }
    },
    show() { if (!host) A.auth.mount(); host.hidden = false; clearMsgs(); render(); },
    hide() { if (host) host.hidden = true; },
    openLogin() { if (!host) A.auth.mount(); host.hidden = false; openMode('login'); },
    openRegister() { if (!host) A.auth.mount(); host.hidden = false; openMode('register'); },
    logout() {
      if (online() && A.api.token()) { A.api.auth.logout().catch(() => {}); }
      if (A.api && A.api.setToken) A.api.setToken('');
      A.store.set('authed', false);
      A.bus.emit('auth:logout');
      A.auth.show();
      toast('已退出登录', 'ok');
    }
  };

  A.ready(() => {
    /* 已登录却停在 /login/ 或 /register/ 子目录 → 回到工作台，避免刷新后仍停在登录页 */
    if (ABS && A.store.get('authed') && /^\/(login|register)\/?$/.test(location.pathname)) {
      try { history.replaceState(null, '', '/start/'); } catch (e) { /* 仅影响地址栏 */ }
    }
    A.auth.mount();
    restore(0).then((ok) => {
      if (ok) return;
      if (A.api && A.api.probe) A.api.probe().then(() => restore(0)).catch(() => {});
    });
  });
})();
