/* ============================================================
   AYCHO module: chat  |  owner: A(main)  |  contract: v1
   主页 / 液态输入框 / 对话页（消息流 · 思考动画 · 步骤 · 产出物 · diff）/ 分享路由
   事件：chat:new chat:select chat:deleted chat:title chat:send
         msg:append msg:stream msg:update msg:done msg:tool msg:stop
         model:change reasoning:change thinking:toggle artifact:add
   ============================================================ */
(function () {
  const A = (window.AYCHO = window.AYCHO || {});
  const U = A.util, el = U.el, icons = A.icons, store = A.store, bus = A.bus;

  const AGENT_PALETTE = ['#7c9cff', '#f472b6', '#34d399', '#22d3ee', '#fbbf24', '#a78bfa', '#fb923c', '#60a5fa'];
  const menuItem = (...a) => A.menuItem(...a);   // 由 shell.js 提供
  const menu = A.menu;                            // 同上（延迟取用）

  /* ============================================================
     数据种子（首次运行时落盘默认配置）
     ============================================================ */
  function seed() {
    if (!(store.get('providers') || []).length) {
      store.set('providers', [
        {
          id: 'p_aycho', name: 'AYCHO 云端（服务端已配置）', baseUrl: 'https://apihub.agnes-ai.com/v1', keyRef: '', models: [
            { id: 'agnes-3.0-flash', label: 'agnes-3.0-flash', enabled: true }
          ]
        },
        {
          id: 'p_hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', keyRef: '', models: [
            { id: 'hunyuan-hy3', label: 'Hunyuan-HY3', enabled: true },
            { id: 'hunyuan-t1', label: 'Hunyuan-T1', enabled: true }
          ]
        },
        {
          id: 'p_deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyRef: '', models: [
            { id: 'deepseek-v4-pro', label: 'DeepSeek-V4 Pro', enabled: true },
            { id: 'deepseek-v4', label: 'DeepSeek-V4', enabled: true }
          ]
        }
      ]);
      store.set('activeModelId', 'agnes-3.0-flash');
    }
    if (!(store.get('agents') || []).length) {
      store.set('agents', [
        { id: 'main', name: 'AYCHO Core', desc: '主 AI · 任务编排', color: 'orb', builtin: true },
        { id: 'file', name: '文件 Agent', desc: '本地文件搜索与读写', color: '#7c9cff', builtin: true },
        { id: 'app', name: '应用 Agent', desc: 'App 安装与自动化操作', color: '#f472b6', builtin: true },
        { id: 'computer', name: '电脑 Agent', desc: '系统配置与终端', color: '#34d399', builtin: true },
        { id: 'browser', name: '浏览器 Agent', desc: '网页浏览与交互', color: '#22d3ee', builtin: true },
        { id: 'search', name: '搜索 Agent', desc: '联网检索与核验', color: '#fbbf24', builtin: true }
      ]);
    }
    if (!(store.get('skills') || []).length) {
      store.set('skills', [
        { id: 'sk_order', name: '通用点单', desc: '连锁品牌下单 / 优惠券', enabled: true, source: '内置' },
        { id: 'sk_persona', name: '人设更新', desc: '修改称呼与回答风格', enabled: true, source: '内置' },
        { id: 'sk_pdf', name: '文档摘要', desc: 'PDF / Word 提炼要点', enabled: false, source: '内置' }
      ]);
    }
    if (!(store.get('mcps') || []).length) {
      store.set('mcps', [{ id: 'mcp_commerce', name: 'commerce', desc: '通用品牌点单助手', enabled: true, tools: ['search_shop', 'create_order'] }]);
    }
  }

  /* ============================================================
     极简 Markdown
     ============================================================ */
  function mdToHtml(src) {
    let s = U.escapeHtml(src == null ? '' : String(src));
    const blocks = [];
    s = s.replace(/```([a-z0-9+#-]*)\n([\s\S]*?)```/gi, (m, lang, code) => {
      blocks.push(`<pre><code data-lang="${lang}">${code.replace(/\n$/, '')}</code></pre>`);
      return `\u0000B${blocks.length - 1}\u0000`;
    });
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000'; });
    /* 裸链接 → 网页卡片（DOM 层再补专属图案与「在浏览器打开」功能） */
    s = s.replace(/(https?:\/\/[^\s<>"'）)]+)/g, (m) => {
      let host = m;
      try { host = new URL(m).hostname.replace(/^www\./, ''); } catch (e) {}
      return `<a class="ax-linkcard" href="${m}" target="_blank" rel="noopener">${host}</a>`;
    });
    s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code>' + codes[Number(i)] + '</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/^\s*[-*]\s+(.*)$/gm, '<span class="ax-li">• $1</span>');
    s = s.split(/\n{2,}/).map((p) => (p.includes('\u0000B') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
    s = s.replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
    return s;
  }
  A.mdToHtml = mdToHtml;

  /* ============================================================
     对话内容的「专属呈现」
     同一段回复里，不同类型的动作穿不同的衣服：
       终端命令 → >_ 运行框（可复制、可一键送进右侧终端执行）
       代码块   → 语言徽章代码卡（可复制）
       网页链接 → 网页卡（地球图案 + 在浏览器面板打开）
     ============================================================ */
  function enhanceRich(root) {
    if (!root) return;

    root.querySelectorAll('pre > code[data-lang]').forEach((code) => {
      const lang = String(code.getAttribute('data-lang') || '').toLowerCase();
      if (!lang) return;
      const isShell = /^(bash|sh|shell|zsh|console|terminal|cmd|bat|powershell|ps1)$/.test(lang);
      const pre = code.parentNode;
      const parent = pre.parentNode;
      if (!parent) return;
      const raw = code.textContent || '';

      const acts = el('span', { class: 'ax-codebox__acts' });
      const copyBtn = el('button', { class: 'ax-codebox__btn', type: 'button', html: icons.get('clipboard', 13) }, el('span', { text: '复制' }));
      copyBtn.addEventListener('click', () => U.copy(raw));
      acts.appendChild(copyBtn);

      if (isShell) {
        const runBtn = el('button', { class: 'ax-codebox__btn', type: 'button', html: icons.get('terminal', 13) }, el('span', { text: '在终端运行' }));
        runBtn.addEventListener('click', () => {
          const line = raw.trim().split('\n')[0];
          bus.emit('panel:open', { tab: 'terminal' });
          bus.emit('terminal:run', { line });
          U.toast('已发送到终端：' + line, 'ok');
        });
        acts.appendChild(runBtn);
      }

      const box = el('div', { class: 'ax-codebox' + (isShell ? ' ax-codebox--shell' : ' ax-codebox--code') },
        el('div', { class: 'ax-codebox__head' },
          el('span', { class: 'ax-codebox__glyph', html: icons.get(isShell ? 'terminal' : 'code', 13) }),
          el('span', { class: 'ax-codebox__label', text: isShell ? '终端命令' : (lang.toUpperCase() + ' 代码') }),
          el('span', { class: 'ax-codebox__tag', text: isShell ? '>_' : lang }),
          acts
        )
      );
      parent.replaceChild(box, pre);
      box.appendChild(pre);
      pre.classList.add('ax-codebox__pre');
    });

    root.querySelectorAll('a.ax-linkcard').forEach((a) => {
      const url = a.getAttribute('href') || '';
      a.insertBefore(el('span', { class: 'ax-linkcard__glyph', html: icons.get('globe', 12) }), a.firstChild);
      a.appendChild(el('span', { class: 'ax-linkcard__go', html: icons.get('external', 12) }));
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        bus.emit('browser:navigate', { url });
        U.toast('已在浏览器面板打开：' + url, 'ok');
      });
    });
  }

  /* ============================================================
     会话
     ============================================================ */
  function newConversation(opts) {
    const conv = {
      id: U.uid('c'), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(),
      agentIds: (opts && opts.agentIds) || store.get('activeAgentIds') || []
    };
    store.set('conversations', [conv].concat(store.get('conversations') || []));
    store.set('activeConversationId', conv.id);
    bus.emit('chat:new', { conv });
    bus.emit('chat:select', { id: conv.id });
    return conv;
  }

  function activeConv() {
    const id = store.get('activeConversationId');
    return (store.get('conversations') || []).find((c) => c.id === id) || null;
  }

  function messagesOf(convId) { return (store.get('messages') || {})[convId] || []; }

  function setMessages(convId, list) {
    const all = store.get('messages') || {};
    all[convId] = list;
    store.set('messages', all);
  }

  function pushMessage(convId, msg) {
    const list = messagesOf(convId).slice();
    list.push(msg);
    setMessages(convId, list);
    bus.emit('msg:append', { convId, msg });
  }

  function updateMessage(convId, msgId, patch) {
    const list = messagesOf(convId).map((m) => (m.id === msgId ? Object.assign({}, m, patch) : m));
    setMessages(convId, list);
    const msg = list.find((m) => m.id === msgId);
    bus.emit('msg:update', { convId, msg });
    return msg;
  }

  /* ============================================================
     输入框（主页与对话页共用）
     ============================================================ */
  const pending = { files: [], images: [], skills: [], mcps: [], agents: [] };

  function fileTag(name) {
    return el('span', { class: 'ax-filetag' }, icons.fileNode(name, 15), el('span', { class: 'ax-truncate', text: name }),
      el('button', { class: 'ax-filetag__x', type: 'button', html: icons.get('x', 12), onclick: (e) => e.currentTarget.closest('.ax-filetag').remove() }));
  }

  function modelLabel(id) {
    const providers = store.get('providers') || [];
    for (const p of providers) {
      const m = (p.models || []).find((x) => x.id === id);
      if (m) return m.label;
    }
    return id || '未选择模型';
  }

  function buildComposer(variant) {
    const inChat = variant === 'chat';
    const ta = el('textarea', {
      class: 'ax-blob__input ax-scroll', rows: '1', placeholder: inChat ? '继续对话，或让 Agent 做点什么…' : '描述你想完成的事，例如：帮我把周报整理成 PPT',
      'aria-label': '输入指令'
    });
    const filesRow = el('div', { class: 'ax-blob__files' });

    const plusBtn = el('button', { class: 'ax-plus', type: 'button', title: '添加内容', html: icons.get('plus', 18) });
    plusBtn.addEventListener('click', () => { plusBtn.classList.add('is-rot'); openPlusMenu(plusBtn, filesRow); });

    const modelBtn = el('button', { class: 'ax-modelbtn', type: 'button' },
      el('span', { class: 'ax-modelbtn__dot' }),
      el('b', { text: modelLabel(store.get('activeModelId')) }),
      el('span', { class: 'ax-hint', text: reasonName(store.get('reasoning')) }),
      el('span', { html: icons.get('chevronDown', 14) })
    );
    modelBtn.addEventListener('click', () => openModelMenu(modelBtn));

    const sendBtn = el('button', { class: 'ax-send', type: 'button', title: '发送（Enter）', html: icons.get('send', 18) });
    /* 停止按钮：与发送按钮完全同尺寸（38×38），圆形，与旋转环同径，切换无抖动 */
    const stopBtn = el('button', { class: 'ax-stop', type: 'button', title: '停止生成' }, el('i', { class: 'ax-stop__ico' }));
    sendBtn.addEventListener('click', () => doSend(ta, filesRow));

    const skillSlot = el('span', { class: 'ax-skill-slot', 'data-slot': 'composer.bar' }); // 技能可直接往这里挂按钮
    /* AI 润色：用自带模型直接在输入框内改写提示词（Gemini 风格图标） */
    const polishBtn = el('button', { class: 'ax-polish', type: 'button', title: 'AI 润色（用自带模型改写输入框文字）', html: icons.get('gemini', 17) });
    polishBtn.addEventListener('click', () => polishInput(ta, polishBtn));
    /* 语音输入：录音 + 实时滚动波形 + 语音转文字（只保留这一个录音键，用户要求删掉重复的） */
    const voiceBtn = el('button', { class: 'ax-mic', type: 'button', title: '语音输入（录音并转文字）', html: icons.get('mic', 17) });
    const voiceBar = el('div', { class: 'ax-voicebar' },
      el('canvas', { class: 'ax-voicebar__cv' }),
      el('span', { class: 'ax-voicebar__hint', text: '正在聆听…' })
    );
    voiceBtn.addEventListener('click', () => toggleVoice(ta, voiceBtn, voiceBar));
    const bar = el('div', { class: 'ax-blob__bar' }, plusBtn, modelBtn, skillSlot, el('span', { class: 'ax-span' }), polishBtn, voiceBtn, sendBtn);

    const blob = el('div', { class: 'ax-blob' }, filesRow, voiceBar, ta, bar);
    const composer = el('div', { class: 'ax-composer' },
      el('div', { class: 'ax-composer__glow' }),
      blob,
      el('div', { class: 'ax-composer__foot', html: 'Enter 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行 · Agent 会自动选择工具' })
    );

    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(208, ta.scrollHeight) + 'px';
      sendBtn.disabled = !ta.value.trim();
    });
    ta.addEventListener('keydown', (e) => {
      const enterSend = (store.get('settings.general.enterToSend') !== false);
      if (e.key === 'Enter' && !e.shiftKey && enterSend) { e.preventDefault(); doSend(ta, filesRow); }
    });
    sendBtn.disabled = true;

    composer._api = {
      setStreaming(on) {
        /* 停止/发送两态完全同尺寸（38×38）圆形，切换无抖动 */
        const next = on ? stopBtn : sendBtn;
        const cur = bar.lastChild;
        if (cur !== next) {
          bar.replaceChild(next, cur === stopBtn || cur === sendBtn ? cur : next);
        }
        next.onclick = on ? stopStreaming : () => doSend(ta, filesRow);
        next.title = on ? '停止生成' : '发送（Enter）';
        composer.classList.toggle('is-busy', on);
        ta.disabled = false;
      },
      focus() { ta.focus(); },
      refill(text) { ta.value = text; ta.dispatchEvent(new Event('input')); },
      textarea: ta,
      filesRow
    };
    return composer;
  }

  /* ---------------- 语音输入：录音 + 实时波形 + 转文字 ---------------- */
  const voiceState = { on: false, ac: null, analyser: null, raf: 0, stream: null, mr: null, sr: null, base: '', noSR: false, buf: [] };

  function voiceSupported() {
    return typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  }
  function speechCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  /* 波形：一条长条柱状线，从右向左无限滚动，音量越高起伏越大 */
  function drawWave(bar, buf) {
    const cv = bar.querySelector('canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(120, cv.clientWidth || 260);
    const h = cv.clientHeight || 34;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = Math.max(8, Math.floor(w / 3.2));
    const step = w / n;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i < n; i++) {
      const v = buf[i] || 0;
      const bh = Math.max(2, Math.min(h - 4, v * (h - 8)));
      const x = w - (i + 1) * step;
      ctx.fillRect(x + 0.6, (h - bh) / 2, Math.max(1.2, step - 1.2), bh);
    }
  }

  function startSpeechInto(ta) {
    const SR = speechCtor();
    if (!SR) {
      voiceState.noSR = true;
      U.toast('当前环境不支持浏览器语音识别：改为 AI 云端转写（录音结束后自动上传）', 'warn');
      return;
    }
    try {
      const sr = new SR();
      sr.lang = 'zh-CN'; sr.continuous = true; sr.interimResults = true;
      let finalText = '';
      sr.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        ta.value = (voiceState.base + finalText + interim).replace(/^\s+/, '');
        ta.dispatchEvent(new Event('input'));
      };
      sr.onerror = (e) => {
        const err = (e && e.error) || '';
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          voiceState.noSR = true;
          U.toast('系统拒绝了语音识别权限：本次仅录音，未转文字', 'warn');
        }
      };
      sr.onend = () => { if (voiceState.on) { try { sr.start(); } catch (e) {} } };
      sr.start();
      voiceState.sr = sr;
    } catch (e) {
      voiceState.noSR = true;
    }
  }

  function startVoice(ta, btn, bar) {
    if (!voiceSupported()) { U.toast('当前环境无法采集麦克风（需 HTTPS 或 APK 壳）', 'warn'); return; }
    voiceState.on = true;
    voiceState.noSR = false;
    voiceState.base = ta.value || '';
    voiceState.buf = [];
    bar.classList.add('is-on');
    btn.classList.add('is-rec');
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      voiceState.stream = stream;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        voiceState.ac = new AC();
        const src = voiceState.ac.createMediaStreamSource(stream);
        const an = voiceState.ac.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.72;
        src.connect(an);
        voiceState.analyser = an;
        const data = new Uint8Array(an.fftSize);
        const tick = () => {
          if (!voiceState.on) return;
          an.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const d = (data[i] - 128) / 128; sum += d * d; }
          const rms = Math.sqrt(sum / data.length);
          voiceState.buf.unshift(Math.min(1, rms * 3.4));
          while (voiceState.buf.length > 260) voiceState.buf.pop();
          drawWave(bar, voiceState.buf);
          voiceState.raf = requestAnimationFrame(tick);
        };
        tick();
      }
      /* 录音留档：停止后保留音频块，便于回放/后续上传 */
      try {
        if (typeof MediaRecorder === 'function') {
          const mr = new MediaRecorder(stream);
          voiceState.chunks = [];
          mr.ondataavailable = (e) => { if (e.data && e.data.size) voiceState.chunks.push(e.data); };
          mr.onstop = () => aiTranscribe(ta, btn, bar);
          mr.start(500);
          voiceState.mr = mr;
        } else {
          voiceState.noSR = true;
        }
      } catch (e) { voiceState.noSR = true; }
      startSpeechInto(ta);
    }).catch((err) => {
      stopVoice(ta, btn, bar);
      U.toast('无法访问麦克风：' + ((err && err.message) || '请授权'), 'err');
    });
  }

  /* ---------------- AI 语音转文字：无 Web Speech 时用录音块走 /api/chat 多模态 ---------------- */
  async function aiTranscribe(ta, btn, bar) {
    const chunks = (voiceState.chunks || []).filter((c) => c && c.size);
    voiceState.chunks = [];
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
    if (blob.size < 2000) return;                       /* 太短不转 */
    const hint = (voiceState.base || '').trim();
    const mime = blob.type || 'audio/webm';
    let b64 = '';
    try {
      const buf = await blob.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      b64 = btoa(bin);
    } catch (e) { U.toast('音频编码失败：' + ((e && e.message) || e), 'err'); return; }
    if (!(A.api && A.api.available())) { U.toast('AI 转写需要连接后端网关（设置 → 后端网关）', 'warn'); return; }
    const ta2 = ta;
    const base0 = (ta2.value || '').replace(/\s*$/, '');
    const setTxt = (s) => { ta2.value = s; ta2.dispatchEvent(new Event('input')); };
    if (btn && !btn.classList.contains('is-rec')) btn.classList.add('is-rec');
    setTxt((base0 ? base0 + ' ' : '') + '⏱ 语音转写中…');
    /* 走网关 aipool 多模型集群（/api/ai/transcribe）：后端自动挑支持音频的免费模型，用户不用自己配 */
    try {
      const r = await A.api.request('POST', '/api/ai/transcribe', {
        audio: b64,
        mime: mime.replace(/^audio\//, '') || 'webm',
        textHint: hint
      });
      if (btn) btn.classList.remove('is-rec');
      if (r && r.ok && r.text && r.text.trim()) {
        setTxt((base0 ? base0 + ' ' : '') + r.text.trim());
        U.toast('语音已转文字（' + (r.name || r.model || 'AI') + '），可直接发送', 'ok');
      } else {
        setTxt(base0);
        U.toast('AI 转写失败：' + ((r && r.message) || '模型暂不支持音频输入'), 'warn');
      }
    } catch (e) {
      if (btn) btn.classList.remove('is-rec');
      setTxt(base0);
      U.toast('AI 转写异常：' + ((e && e.message) || e), 'err');
    }
  }

  function stopVoice(ta, btn, bar, keepForTranscribe) {
    voiceState.on = false;
    if (voiceState.raf) cancelAnimationFrame(voiceState.raf);
    voiceState.raf = 0;
    try { if (voiceState.sr) voiceState.sr.stop(); } catch (e) {}
    voiceState.sr = null;
    try {
      if (voiceState.mr && voiceState.mr.state !== 'inactive') voiceState.mr.stop();
    } catch (e) {}
    if (keepForTranscribe === false) { voiceState.mr = null; voiceState.chunks = []; }
    /* 注意：chunks 保留到 aiTranscribe 读完才清理；stream/ac 立刻回收 */
    try { if (voiceState.stream) voiceState.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    voiceState.stream = null;
    try { if (voiceState.ac) voiceState.ac.close(); } catch (e) {}
    voiceState.ac = null;
    voiceState.analyser = null;
    if (bar) bar.classList.remove('is-on');
    if (btn) btn.classList.remove('is-rec');
  }

  function toggleVoice(ta, btn, bar) {
    if (voiceState.on) {
      stopVoice(ta, btn, bar);
      /* 若 Web Speech 不在，MediaRecorder.onstop → aiTranscribe() 自动接手；
         这里不再提示"未转文字"，避免与 AI 转写结果冲突 */
      return;
    }
    startVoice(ta, btn, bar);
  }

  /* ---------------- AI 润色：直接改写输入框内的文字 ---------------- */
  function polishInput(ta, btn) {
    const src = (ta.value || '').trim();
    if (!src) { U.toast('先写点内容再润色', 'warn'); return; }
    if (btn.classList.contains('is-busy')) return;
    if (!(A.api && A.api.available())) { U.toast('润色需要先连接后端网关（设置中心 → 后端网关）', 'warn'); return; }
    btn.classList.add('is-busy');
    /* 优先走网关 aipool 多模型集群（/api/ai/polish），免费模型池自动轮换 */
    A.api.request('POST', '/api/ai/polish', { text: src }).then(function (r) {
      btn.classList.remove('is-busy');
      if (r && r.ok && r.text && r.text.trim()) {
        ta.value = r.text.trim();
        ta.dispatchEvent(new Event('input'));
        U.toast('已润色（' + (r.name || r.model || 'AI') + '），可直接发送', 'ok');
      } else {
        U.toast('润色失败：' + ((r && r.message) || '后端模型池暂不可用'), 'warn');
      }
    }).catch(function (e) {
      btn.classList.remove('is-busy');
      U.toast('润色失败：' + ((e && e.message) || e), 'err');
    });
  }

  function stopButton() {
    /* 已移除：停止按钮现在直接复用 composer 里的 stopBtn（38×38 圆形，与发送同径） */
    const b = el('button', { class: 'ax-stop', type: 'button', title: '停止生成' }, el('i'));
    b.addEventListener('click', () => stopStreaming());
    return b;
  }

  function doSend(ta, filesRow) {
    const text = (ta.value || '').trim();
    const attached = U.$$('.ax-filetag', filesRow).map((n) => ({
      name: n.dataset.name || '',
      size: Number(n.dataset.size || 0),
      type: n.dataset.type || '',
      content: n.dataset.content || ''
    }));
    if (!text && !attached.length) return;
    const conv = activeConv() || newConversation();
    const blob = ta.closest('.ax-blob');
    blob.classList.add('is-press');
    setTimeout(() => blob.classList.remove('is-press'), 160);

    ta.value = ''; ta.style.height = 'auto'; ta.dispatchEvent(new Event('input'));
    Array.from(filesRow.children).forEach((n) => n.remove());

    bus.emit('chat:send', {
      convId: conv.id, text, attachments: attached,
      agentIds: store.get('activeAgentIds') || [], modelId: store.get('activeModelId'),
      reasoning: store.get('reasoning'), thinking: store.get('thinking')
    });
    sendUserMessage(conv.id, text, attached);
    /* 已连接后端 → 走真实模型；否则走本地编排 */
    if (A.api && A.api.available()) runReal(conv.id, text, attached);
    else runSimulation(conv.id, text, attached);
  }

  /* ---------------- 加号菜单（用户要求：只保留 三个分区——Skill / MCP / 子Agent，每个分区带横向箭头展开+独立开关） ---------------- */
  function openPlusMenu(anchor, filesRow) {
    const skills = store.get('skills') || [];
    const mcps = store.get('mcps') || [];
    const agents = (store.get('agents') || []).filter((a) => a.id !== 'main');
    const activeAgents = store.get('activeAgentIds') || [];

    /* 每个分区：一个横向箭头按钮（无中间竖杠，纯展开箭头），点击展开该分区列表，每行带独立开关
       每行自带 toggleItem 函数，section 只负责渲染与展开 */
    function section(label, icon, items, extraRow) {
      const wrap = el('div', { class: 'ax-sec' });
      const head = el('div', { class: 'ax-sec__head' },
        el('span', { class: 'ax-sec__ico', html: icon ? icons.get(icon, 15) : '' }),
        el('b', { class: 'ax-sec__label', text: label }),
        el('button', { class: 'ax-sec__arrow', type: 'button', title: '展开/收起 ' + label, html: icons.get('chevronDown', 15), 'aria-label': '展开 ' + label })
      );
      const body = el('div', { class: 'ax-sec__body' });
      head.querySelector('.ax-sec__arrow').addEventListener('click', (e) => {
        e.stopPropagation();
        const open = body.classList.toggle('is-open');
        head.classList.toggle('is-open', open);
      });
      items.forEach((it) => {
        const row = el('div', { class: 'ax-sec__row' },
          el('b', { text: it.label }),
          it.desc ? el('small', { text: String(it.desc).slice(0, 40) }) : null,
          el('span', { class: 'ax-sec__spacer' }),
          el('button', {
            class: 'ax-sec__switch' + (it.on ? ' is-on' : ''), type: 'button', role: 'switch',
            'aria-checked': it.on ? 'true' : 'false', title: '启用/停用 ' + it.label,
            onclick: (e) => {
              e.stopPropagation();
              const v = it.toggleItem();
              e.currentTarget.classList.toggle('is-on', v);
              e.currentTarget.setAttribute('aria-checked', v ? 'true' : 'false');
            }
          })
        );
        body.appendChild(row);
      });
      if (items.length === 0) body.appendChild(el('div', { class: 'ax-sec__empty', text: '暂无 ' + label }));
      if (extraRow) body.appendChild(extraRow);
      wrap.appendChild(head);
      wrap.appendChild(body);
      return wrap;
    }

    /* Skill 分区：每个 skill 一个开关 */
    const skillSec = section('Skill', 'sparkles',
      skills.map((s) => ({
        label: s.name, desc: s.desc, on: s.enabled !== false,
        toggleItem: () => {
          s.enabled = !s.enabled;
          store.set('skills', skills);
          U.toast((s.enabled ? '已启用技能：' : '已停用技能：') + s.name, 'ok');
          return s.enabled;
        }
      }))
    );

    /* MCP 分区：每个 mcp 一个开关 */
    const mcpSec = section('MCP', 'plug',
      mcps.map((m) => ({
        label: m.name, desc: m.desc, on: pending.mcps.includes(m.id),
        toggleItem: () => {
          const on = toggleIn('mcps', m.id);
          U.toast((on ? '已启用：' : '已停用：') + m.name, 'ok');
          return on;
        }
      }))
    );

    /* 子 Agent 分区：每个 agent 一个开关；可新建 agent（名字+介绍+可选单独模型） */
    const agentItems = agents.map((a) => ({
      label: a.name, desc: a.desc, on: activeAgents.includes(a.id),
      toggleItem: () => {
        const cur = activeAgents.slice();
        const i = cur.indexOf(a.id);
        if (i >= 0) cur.splice(i, 1); else cur.push(a.id);
        store.set('activeAgentIds', cur);
        bus.emit('agents:change', { agents: cur });
        return cur.includes(a.id);
      }
    }));
    /* 新建子 agent 行 */
    const newAgentRow = el('div', { class: 'ax-sec__row ax-sec__row--new' },
      el('b', { text: '+ 新建 Agent' }),
      el('button', { class: 'ax-sec__newbtn', type: 'button', text: '创建' })
    );
    newAgentRow.querySelector('.ax-sec__newbtn').addEventListener('click', () => {
      const name = (prompt('Agent 名字：') || '').trim();
      if (!name) return;
      const desc = prompt('Agent 介绍（作为提示词）：') || '';
      const useOwnModel = confirm('此 Agent 单独选模型？（勾选后与主 AI 模型不同，但仍可互相讨论思考）');
      const id = U.uid('agent');
      const list = (store.get('agents') || []).filter((a) => a.id !== 'main');
      const agent = { id, name, desc: desc, createdAt: Date.now(), useOwnModel: !!useOwnModel };
      if (useOwnModel) {
        /* 简单：标记单独模型，复用当前 activeModelId 之外的选择由用户后续在模型面板指定 */
        agent.ownModelId = store.get('activeModelId') || '';
      }
      list.push(agent);
      store.set('agents', ['main'].concat(list));
      store.set('activeAgentIds', activeAgents.concat([id]));
      bus.emit('agents:change', { agents: store.get('activeAgentIds') });
      U.toast('已创建 Agent「' + name + '」（提权模式：默认启用，可单独模型）', 'ok');
    });
    const agentSec = section('子 Agent', 'robot', agentItems, activeAgents, null, newAgentRow);

    const content = [
      el('div', { class: 'ax-menu__label', text: '添加内容' }),
      el('div', { class: 'ax-menu__quick' },
        menuItem({ icon: 'files', label: '上传文件', desc: '文档 / 代码 / 压缩包', keepOpen: true, onClick: () => pickFiles('', true, '文件') }),
        menuItem({ icon: 'image', label: '上传图片', desc: '截图 / 照片（支持多选）', keepOpen: true, onClick: () => pickFiles('image/*', true, '图片') }),
        menuItem({ icon: 'files', label: '选择文件夹', desc: '系统文件管理器 · 只可选文件夹', keepOpen: true, onClick: () => pickFolder() })
      ),
      el('div', { class: 'ax-menu__sep' }),
      skillSec,
      mcpSec,
      agentSec
    ].filter(Boolean);
    const h = A.menu.open({ anchor, align: 'left', width: 300, toggle: true, content, onClose: () => anchor.classList.remove('is-rot') });
    return h;
  }

  function toggleIn(key, id) {
    const arr = pending[key];
    const i = arr.indexOf(id);
    if (i >= 0) { arr.splice(i, 1); return false; }
    arr.push(id); return true;
  }

  /* ============================================================
     推理等级（与后端 server/lib/chat.js 的 LEVEL_NAME / EFFORT / BUDGET 严格对应）
     等级真实作用于上游请求：reasoning_effort / thinking.budget_tokens / enable_thinking
     ============================================================ */
  const REASON_LEVELS = [
    { n: 0, en: 'Off', note: '不请求推理，最快最省 token' },
    { n: 1, en: 'Minimal', note: '极简推理，速度优先' },
    { n: 2, en: 'Low', note: '轻度推理' },
    { n: 3, en: 'Medium', note: '平衡（默认）' },
    { n: 4, en: 'High', note: '深度推理，质量优先' },
    { n: 5, en: 'Max', note: '最深推理，最慢、思考 token 最多' }
  ];
  const REASON_EFFORT = ['', 'minimal', 'low', 'medium', 'high', 'high'];
  const REASON_BUDGET = [0, 1024, 2048, 4096, 8192, 16384];
  function reasonLevel() { return Math.max(0, Math.min(5, Number(store.get('reasoning')) || 0)); }
  function reasonName(n) { const lv = REASON_LEVELS[Math.max(0, Math.min(5, Number(n) || 0))]; return lv ? lv.en : 'Medium'; }
  function reasonEffortText(n) {
    if (store.get('thinking') === false) return '思考模式关闭：不下发推理参数，不产生思考 token';
    if (n <= 0) return '不请求推理：不下发推理参数（省 token）';
    return 'effort=' + REASON_EFFORT[n] + ' · budget=' + REASON_BUDGET[n] + ' tokens';
  }
  function refreshModelHint() {
    const nodes = document.querySelectorAll('.ax-modelbtn .ax-hint');
    Array.from(nodes).forEach((n) => { n.textContent = reasonName(store.get('reasoning')); });
  }

  /* 粒子特效：圆点持续向外冒粒子（canvas，元素移除后自动停止） */
  function particles(canvas, getX) {
    const ctx = canvas.getContext('2d');
    const PALETTE = ['#5eead4', '#60a5fa', '#a78bfa', '#f0abfc', '#f472b6', '#ffffff'];
    let raf = 0, parts = [], W = 0, H = 0, last = 0;
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(x, y, n) {
      for (let i = 0; i < n; i++) {
        if (parts.length > 96) break;
        parts.push({
          x: x + (Math.random() - 0.5) * 13, y: y + (Math.random() - 0.5) * 9,
          vx: (Math.random() - 0.5) * 0.55, vy: -(0.32 + Math.random() * 0.9),
          life: 1, decay: 0.012 + Math.random() * 0.022,
          r: 0.9 + Math.random() * 1.9, c: PALETTE[(Math.random() * PALETTE.length) | 0]
        });
      }
    }
    function tick(ts) {
      if (!canvas.isConnected || !canvas.offsetParent) { raf = 0; return; }
      raf = requestAnimationFrame(tick);
      if (!W) resize();
      const dt = last ? Math.min(2.4, (ts - last) / 16.7) : 1; last = ts;
      ctx.clearRect(0, 0, W, H);
      spawn(getX(), H / 2, 3);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 0.006 * dt; p.vx *= 0.99; p.life -= p.decay * dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life) * 0.92;
        ctx.fillStyle = p.c; ctx.shadowBlur = 9; ctx.shadowColor = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.3, p.r * p.life), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    resize();
    raf = requestAnimationFrame(tick);
    return { resize: resize };
  }

  /* 可拖动的极光渐变进度条：Off → Max 六档英文等级 */
  function buildReasonSlider(level0, onPick) {
    const root = el('div', { class: 'ax-rsn' });
    const val = el('b', { class: 'ax-rsn__val', text: reasonName(level0) });
    const rail = el('div', {
      class: 'ax-rsn__rail', tabindex: '0', role: 'slider',
      'aria-label': '推理等级 Reasoning level', 'aria-valuemin': '0', 'aria-valuemax': '5'
    });
    const fill = el('div', { class: 'ax-rsn__fill' });
    const aura = el('div', { class: 'ax-rsn__aura' }, el('i'), el('i'));
    const fx = el('canvas', { class: 'ax-rsn__fx' });
    const ticks = el('div', { class: 'ax-rsn__ticks' });
    REASON_LEVELS.forEach(() => ticks.appendChild(el('i')));
    const knob = el('div', { class: 'ax-rsn__knob' });
    [fill, aura, fx, ticks, knob].forEach((n) => rail.appendChild(n));

    const scale = el('div', { class: 'ax-rsn__scale' });
    const scaleSpans = REASON_LEVELS.map((lv) => { const s = el('span', { text: lv.en }); scale.appendChild(s); return s; });
    const hint = el('div', { class: 'ax-rsn__hint' });
    const eff = el('div', { class: 'ax-rsn__eff' });
    root.appendChild(el('div', { class: 'ax-rsn__top' }, el('span', { class: 'ax-rsn__title', text: 'Reasoning' }), val));
    root.appendChild(rail);
    root.appendChild(scale);
    root.appendChild(hint);
    root.appendChild(eff);

    let level = Math.max(0, Math.min(5, Number(level0) || 0));
    let dragging = false;
    particles(fx, () => (level / 5) * (rail.clientWidth || 1));

    function paintEff() {
      const m = store.get('reasonMeta');
      if (store.get('thinking') === false && !m) { eff.textContent = reasonEffortText(level); eff.classList.remove('is-warn'); return; }
      if (!m) { eff.textContent = '实际下发：' + reasonEffortText(level); eff.classList.remove('is-warn'); return; }
      if (m.degraded) {
        eff.innerHTML = '上次调用：上游不认推理扩展字段，已自动降级为默认推理（<code>degraded</code>）';
        eff.classList.add('is-warn');
      } else {
        eff.innerHTML = '上次真实生效：<code>' + (m.effort ? 'reasoning_effort=' + m.effort : (m.thinking ? 'thinking enabled · budget=' + m.budget : 'disabled')) + '</code> · ' + reasonName(m.level);
        eff.classList.remove('is-warn');
      }
    }

    function apply(n, final) {
      level = Math.max(0, Math.min(5, Math.round(n)));
      root.style.setProperty('--rsn-pos', ((level / 5) * 100) + '%');
      root.classList.toggle('is-mute', store.get('thinking') === false);
      val.textContent = reasonName(level);
      scaleSpans.forEach((s, i) => s.classList.toggle('is-on', i === level));
      Array.from(ticks.children).forEach((t, i) => t.classList.toggle('is-on', i <= level));
      hint.textContent = REASON_LEVELS[level].note;
      rail.setAttribute('aria-valuenow', String(level));
      paintEff();
      /* Bug2：拖动时只改 CSS 变量，fill/knob 走 transition，不整条重渲染 */
      onPick(level, final);
    }

    function fromEvent(e) {
      const r = rail.getBoundingClientRect();
      const cx = (e && e.clientX != null) ? e.clientX : (r.left + r.width / 2);
      const x = Math.max(0, Math.min(r.width, cx - r.left));
      return (x / (r.width || 1)) * 5;
    }
    rail.addEventListener('pointerdown', (e) => {
      dragging = true; root.classList.add('is-drag');
      try { rail.setPointerCapture(e.pointerId); } catch (er) {}
      apply(fromEvent(e), false); e.preventDefault();
    });
    /* 拖动中：input 等价（pointermove）实时把 left%→right% 写入 fill 宽度，
       只更新 CSS 变量与 class，不重建节点 */
    rail.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const n = fromEvent(e);
      const i = Math.max(0, Math.min(5, Math.round(n)));
      if (i === level) return;
      level = i;
      root.style.setProperty('--rsn-pos', ((level / 5) * 100) + '%');
      val.textContent = reasonName(level);
      scaleSpans.forEach((s, k) => s.classList.toggle('is-on', k === level));
      Array.from(ticks.children).forEach((t, k) => t.classList.toggle('is-on', k <= level));
      hint.textContent = REASON_LEVELS[level].note;
      rail.setAttribute('aria-valuenow', String(level));
    });
    function endDrag() { if (!dragging) return; dragging = false; root.classList.remove('is-drag'); apply(level, true); }
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
    rail.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { apply(level + 1, true); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { apply(level - 1, true); e.preventDefault(); }
      else if (k === 'Home') { apply(0, true); e.preventDefault(); }
      else if (k === 'End') { apply(5, true); e.preventDefault(); }
    });

    apply(level, false);
    return root;
  }

  /* ---------------- 模型菜单 ---------------- */
  function openModelMenu(anchor) {
    const providers = store.get('providers') || [];
    const active = store.get('activeModelId');
    const level = reasonLevel();

    const levelRow = buildReasonSlider(level, (lv, final) => {
      store.set('reasoning', lv);
      refreshModelHint();
      if (final) {
        bus.emit('reasoning:change', { level: lv });
        U.toast('Reasoning level: ' + reasonName(lv), 'ok');
      }
    });

    const thinkSwitch = el('span', { class: 'ax-switch' + (store.get('thinking') !== false ? ' is-on' : '') });
    const thinkCost = el('span', { class: 'ax-menu__cost', text: (store.get('thinking') !== false ? '已开启' : '开启后') + '：额外推理 token，消耗约为 2 倍' });
    const thinkBtn = menuItem({
      icon: 'brain', label: '思考模式', desc: '展示 AI 的真实推理过程（可展开）', keepOpen: true,
      onClick: () => {
        const on = !(store.get('thinking') !== false);
        store.set('thinking', on);
        thinkSwitch.classList.toggle('is-on', on);
        thinkCost.textContent = (on ? '已开启' : '开启后') + '：额外推理 token，消耗约为 2 倍';
        bus.emit('thinking:toggle', { on });
        U.toast(on ? '思考模式已开启：会产生额外推理 token，消耗约为 2 倍' : '思考模式已关闭', on ? 'warn' : 'ok');
      }
    });
    thinkBtn.appendChild(thinkSwitch);
    thinkBtn.appendChild(thinkCost);

    const content = [
      el('div', { class: 'ax-menu__label', text: '模型' }),
      ...providers.flatMap((p) => (p.models || []).filter((m) => m.enabled !== false).map((m) => menuItem({
        icon: 'sparkles', label: m.label, desc: p.name, on: m.id === active,
        onClick: () => {
          store.set('activeModelId', m.id);
          bus.emit('model:change', { modelId: m.id });
          U.toast('已切换模型：' + m.label, 'ok');
          renderStage();
        }
      }))),
      el('div', { class: 'ax-menu__sep' }),
      levelRow,
      el('div', { class: 'ax-menu__sep' }),
      thinkBtn,
      el('div', { class: 'ax-menu__sep' }),
      menuItem({ icon: 'key', label: '配置模型与密钥', onClick: () => bus.emit('settings:open', { tab: 'api' }) })
    ];
    A.menu.open({ anchor, align: 'right', width: 348, toggle: true, content });
  }

  /* ============================================================
     视图：主页
     ============================================================ */
  function renderHome() {
    const view = el('section', { class: 'ax-view ax-home' });
    const composer = buildComposer('home');
    const chips = el('div', { class: 'ax-chips' });
    ['帮我把这份简历改成 PDF', '总结桌面上最新的周报', '在手机上装个 Shizuku 自动化脚本', '把这段代码重构成原生 JS'].forEach((t) => {
      const c = el('button', { class: 'ax-chip', type: 'button', text: t });
      c.addEventListener('click', () => { composer._api.refill(t); composer._api.focus(); });
      chips.appendChild(c);
    });

    const inner = el('div', { class: 'ax-home__inner' },
      el('div', { class: 'ax-home__mark' },
        el('span', { class: 'ax-boot__ring ax-boot__ring--1' }),
        el('span', { class: 'ax-boot__ring ax-boot__ring--2' }),
        el('span', { class: 'ax-boot__core' }, el('span', { class: 'ax-boot__element', role: 'img', 'aria-label': 'AYCHO' }))
      ),
      el('h2', { class: 'ax-home__title', html: 'The agent can help you <em>get everything done</em>' }),
      el('p', { class: 'ax-home__sub', text: '说一句话，AYCHO 会自己拆任务、选工具、动手做完。' }),
      composer,
      chips
    );
    view.appendChild(inner);
    setTimeout(() => composer._api.focus(), 120);
    return view;
  }

  /* ============================================================
     视图：对话
     ============================================================ */
  let chatScroll, chatInner, chatFoot, chatComposer;

  function renderChat() {
    let conv = activeConv();
    if (!conv) conv = newConversation();   // 直达 /chat/ 且无会话时兜底新建，避免 conv.id 空引用
    const view = el('section', { class: 'ax-view ax-chat' });
    chatInner = el('div', { class: 'ax-chat__inner' });
    chatScroll = el('div', { class: 'ax-chat__scroll ax-scroll' }, chatInner);
    chatComposer = buildComposer('chat');
    chatFoot = el('div', { class: 'ax-chat__foot' }, chatComposer);
    view.appendChild(chatScroll);
    view.appendChild(chatFoot);
    paintMessages();

    const msgs = messagesOf(conv.id);
    if (msgs.some((m) => m.streaming)) chatComposer._api.setStreaming(true);
    return view;
  }

  function paintMessages() {
    const conv = activeConv();
    if (!conv || !chatInner) return;
    chatInner.innerHTML = '';
    const msgs = messagesOf(conv.id);
    if (!msgs.length) {
      chatInner.appendChild(el('div', { class: 'ax-empty' },
        el('span', { html: icons.get('sparkles', 26) }),
        el('span', { text: '这是一个新对话' }),
        el('span', { class: 'ax-hint', text: '在下方输入指令，AYCHO 会协调 Agent 一起完成' })
      ));
      return;
    }
    msgs.forEach((m) => chatInner.appendChild(renderMessage(m)));
    scrollToEnd(false);
  }

  function scrollToEnd(smooth) {
    if (!chatScroll) return;
    requestAnimationFrame(() => {
      chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  function avatarOf(msg) {
    if (msg.role === 'user') {
      const user = store.get('user') || {};
      return el('span', { class: 'ax-avatar' }, user.avatar ? el('img', { src: user.avatar, alt: '' }) : el('span', { text: (user.name || '老板').slice(0, 1).toUpperCase() }));
    }
    if (msg.role === 'agent') {
      return el('span', { class: 'ax-agentorb' + (msg.streaming ? ' is-think' : ''), style: { background: msg.color || '#7c9cff' } }, el('span', { text: (msg.name || 'A').slice(0, 1) }));
    }
    return el('span', { class: 'ax-orb' + (msg.streaming ? ' is-think' : '') });
  }

  function renderMessage(msg) {
    const isUser = msg.role === 'user';
    const node = el('div', { class: 'ax-msg ax-msg--' + (isUser ? 'user' : msg.role) , dataset: { id: msg.id } });
    if (!isUser) node.appendChild(el('div', { class: 'ax-msg__side' }, avatarOf(msg)));
    const body = el('div', { class: 'ax-msg__body' });

    if (!isUser) {
      body.appendChild(el('div', { class: 'ax-msg__name' },
        el('b', { text: msg.name || (msg.role === 'agent' ? 'Agent' : 'AYCHO') }),
        msg.sub ? el('span', { class: 'ax-hint', text: msg.sub }) : null,
        el('span', { class: 'ax-msg__meta', text: U.fmtClock(msg.ts || Date.now()) })
      ));
    }

    if (msg.steps && msg.steps.length) body.appendChild(renderSteps(msg));

    const textNode = el('div', { class: 'ax-msg__text' + (msg.streaming ? ' is-stream' : '') });
    if (msg.streaming && !msg.text) {
      textNode.appendChild(el('div', { class: 'ax-thinking' }, el('span', { text: thinkLabel(msg) }), el('span', { class: 'ax-dots' }, el('i'), el('i'), el('i'))));
    } else {
      textNode.innerHTML = mdToHtml(msg.text || '');
      enhanceRich(textNode);
      if (msg.streaming) textNode.appendChild(el('span', { class: 'ax-caret', 'aria-hidden': 'true' }));
    }
    body.appendChild(textNode);

    if (msg.reason) body.appendChild(renderReason(msg));
    if (msg.artifacts && msg.artifacts.length) body.appendChild(renderArtifacts(msg.artifacts));
    if (msg.diff) body.appendChild(renderDiff(msg.diff));

    if (!isUser && !msg.streaming) {
      body.appendChild(el('div', { class: 'ax-msg__acts' },
        el('button', { class: 'ax-minibtn', type: 'button', html: icons.get('clipboard', 14) + '', onclick: () => U.copy(msg.text || '') }, el('span', { text: '复制' })),
        el('button', { class: 'ax-minibtn', type: 'button', onclick: () => U.toast('已记录到长期记忆', 'ok') }, el('span', { html: icons.get('memory', 14) }), el('span', { text: '记忆' })),
        el('button', { class: 'ax-minibtn', type: 'button', onclick: () => { chatComposer._api.refill(msg.text || ''); } }, el('span', { html: icons.get('refresh', 14) }), el('span', { text: '重试' }))
      ));
    }
    node.appendChild(body);
    return node;
  }

  /* 真实思维链（模型返回的 reasoning_content）：思考中实时显示「正在思考」，展开可见 AI 的思考内容 */
  function renderReason(msg) {
    const live = !!msg.streaming && !msg.text;
    const info = msg.reasonMeta || null;
    let open = msg.reasonOpen != null ? !!msg.reasonOpen : live;
    const body = el('div', { class: 'ax-reason__body', html: mdToHtml(msg.reason || '') });
    body.hidden = !open;
    const head = el('button', { class: 'ax-reason__head', type: 'button' },
      el('span', { class: 'ax-chev', html: icons.get('chevronRight', 14) }),
      el('span', { html: icons.get('sparkles', 14) }),
      el('span', { text: live ? '正在思考…' : '思考过程' }),
      el('span', { class: 'ax-reason__live' }, live ? el('em') : null, el('span', { text: live ? 'AI 正在推理，实时输出' : (open ? '收起' : '展开查看') }))
    );
    const box = el('div', { class: 'ax-reason' + (open ? ' is-open' : '') }, head, body);

    const metaBits = [];
    if (info) {
      metaBits.push(el('span', { html: 'Level <code>' + reasonName(info.level) + '</code>' }));
      metaBits.push(el('span', {
        html: 'param <code>' + (info.effort ? 'reasoning_effort=' + info.effort
          : (info.thinking ? 'thinking budget=' + info.budget : 'thinking: disabled')) + '</code>'
      }));
      if (info.degraded) metaBits.push(el('span', { text: '上游不支持推理扩展字段，已自动降级' }));
    }
    if (msg.reasonTokens != null) metaBits.push(el('span', { html: '思考 <code>' + msg.reasonTokens + '</code> tokens' }));
    if (metaBits.length) box.appendChild(el('div', { class: 'ax-reason__meta' }, ...metaBits));

    head.addEventListener('click', () => {
      open = !open; body.hidden = !open; box.classList.toggle('is-open', open);
      const list = messagesOf(msg.convId).map((m) => (m.id === msg.id ? Object.assign({}, m, { reasonOpen: open }) : m));
      setMessages(msg.convId, list);
    });
    if (live && open) { try { body.scrollTop = body.scrollHeight; } catch (e) {} }
    return box;
  }

  function thinkLabel(msg) {
    if (msg.role === 'agent') return (msg.name || 'Agent') + ' 正在处理';
    return (msg.steps && msg.steps.some((s) => s.status === 'run')) ? '正在执行' : '正在思考';
  }

  /* ============================================================
     对话步骤的「专属样式」
     每一种操作在对话流里都有自己的图案、标语、配色与展开详情：
       终端命令 >_   · 读取/写入文件 · 浏览网页 · 检索资料 · 调用技能
       协作代理     · 编写代码     · 模型服务 · 任务规划 · 长期记忆
     ============================================================ */
  var STEP_KINDS = {
    shell:  { icon: 'terminal', label: '终端命令', cls: 'ax-step--shell' },
    read:   { icon: 'edit',     label: '读取文件', cls: 'ax-step--read' },
    write:  { icon: 'files',    label: '写入文件', cls: 'ax-step--write' },
    browse: { icon: 'globe',    label: '浏览网页', cls: 'ax-step--browse' },
    search: { icon: 'search',   label: '检索资料', cls: 'ax-step--search' },
    skill:  { icon: 'sparkles', label: '调用技能', cls: 'ax-step--skill' },
    agent:  { icon: 'robot',    label: '协作代理', cls: 'ax-step--agent' },
    code:   { icon: 'code',     label: '编写代码', cls: 'ax-step--code' },
    model:  { icon: 'brain',    label: '模型服务', cls: 'ax-step--model' },
    memory: { icon: 'memory',   label: '长期记忆', cls: 'ax-step--memory' },
    image:  { icon: 'image',    label: '图像处理', cls: 'ax-step--image' },
    voice:  { icon: 'mic',      label: '语音处理', cls: 'ax-step--voice' },
    plan:   { icon: 'list',     label: '任务规划', cls: 'ax-step--plan' }
  };

  /* 步骤没带 kind 时按文案推断，保证任何来源的步骤都能拿到专属样式 */
  function stepKind(s) {
    if (s && s.kind && STEP_KINDS[s.kind]) return s.kind;
    var t = String((s && s.label) || '').replace(/<[^>]+>/g, ' ');
    if (/https?:\/\//.test(t) || /浏览|打开网页|访问(网站|页面)|网址/.test(t)) return 'browse';
    if (/搜索|检索|查找资料|联网/.test(t)) return 'search';
    if (/技能|skill/i.test(t)) return 'skill';
    if (/写入|保存|生成文件|创建文件|新建文件|落盘/.test(t)) return 'write';
    if (/读取|解析文件|加载文件|提取要点/.test(t)) return 'read';
    if (/命令|终端|\$ |npm |pnpm |git |node |python|pip |curl |bash/.test(t)) return 'shell';
    if (/代码|脚本|补丁|重构|编译/.test(t)) return 'code';
    if (/语音|录音|转写/.test(t)) return 'voice';
    if (/图片|图像|截图|视觉/.test(t)) return 'image';
    if (/记忆/.test(t)) return 'memory';
    if (/模型|推理|思考|token|连接/i.test(t)) return 'model';
    if (/代理|agent/i.test(t)) return 'agent';
    return 'plan';
  }

  /* 单条步骤：图案 + 状态 + 标语（专属文案）+ 内容 + 可展开详情 */
  function renderStepRow(s, ico) {
    var k = stepKind(s);
    var def = STEP_KINDS[k];
    var row = el('div', { class: 'ax-step ' + def.cls });
    row.appendChild(el('span', { html: ico }));
    row.appendChild(el('span', { class: 'ax-step__glyph', html: icons.get(def.icon, 13) }));
    var main = el('div', { class: 'ax-step__main' },
      el('span', { class: 'ax-step__txt', html: s.label }),
      el('span', { class: 'ax-step__kind', text: def.label })
    );
    if (s.meta) main.appendChild(el('span', { class: 'ax-step__meta', text: s.meta }));
    row.appendChild(main);

    var det = s.detail || null;
    if (!det) {
      if (s.cmd) det = { type: 'shell', text: s.cmd };
      else if (s.url) det = { type: 'browse', text: s.url };
      else if (s.path) det = { type: k === 'shell' ? 'shell' : 'file', text: s.path };
    }
    if (det && det.text) {
      var open = false;
      var box = el('div', { class: 'ax-step__detail' }, el('pre', { text: det.text }));
      box.hidden = true;
      var btn = el('button', { class: 'ax-step__more', type: 'button', text: '详情' });
      btn.addEventListener('click', function () {
        open = !open; box.hidden = !open; btn.textContent = open ? '收起' : '详情';
        row.classList.toggle('is-open', open);
      });
      row.appendChild(btn);
      row.appendChild(box);
    }
    return row;
  }

  function renderSteps(msg) {
    const done = msg.steps.filter((s) => s.status === 'ok').length;
    const box = el('div', { class: 'ax-steps' + (msg.stepsOpen ? ' is-open' : '') });
    const head = el('button', { class: 'ax-steps__head', type: 'button' },
      el('span', { class: 'ax-chev', html: icons.get('chevronRight', 14) }),
      el('span', { html: icons.get('terminal', 14) }),
      el('span', { text: msg.streaming ? `执行中 · ${done}/${msg.steps.length} 步` : `已执行 ${msg.steps.length} 步` }),
      el('span', { class: 'ax-menu__meta', text: msg.streaming ? '进行中' : '展开查看' })
    );
    const inner = el('div', null);
    msg.steps.forEach((s) => {
      const ico = s.status === 'ok' ? '<span class="ax-step__ico ax-step__ico--ok">' + icons.get('check', 14) + '</span>'
        : s.status === 'err' ? '<span class="ax-step__ico ax-step__ico--err">' + icons.get('x', 14) + '</span>'
          : '<span class="ax-step__ico ax-step__ico--run">' + icons.get('refresh', 14) + '</span>';
      inner.appendChild(renderStepRow(s, ico));
    });
    head.addEventListener('click', () => {
      const open = box.classList.toggle('is-open');
      const list = messagesOf(msg.convId).map((m) => (m.id === msg.id ? Object.assign({}, m, { stepsOpen: open }) : m));
      setMessages(msg.convId, list);
    });
    box.appendChild(head);
    box.appendChild(el('div', { class: 'ax-steps__body' }, inner));
    return box;
  }

  function artifactById(id) { return (store.get('artifacts') || []).find((a) => a.id === id); }

  function renderArtifacts(ids) {
    const wrap = el('div', { class: 'ax-artifacts' }, el('div', { class: 'ax-artifacts__t', text: '产出物 · ' + ids.length + ' 个文件' }));
    const list = el('div', { class: 'ax-artlist' });
    ids.map(artifactById).filter(Boolean).forEach((a) => {
      const row = el('button', { class: 'ax-art', type: 'button' },
        icons.fileNode(a.name, 20),
        el('span', { class: 'ax-art__txt' }, el('b', { text: a.name }), el('small', { text: (a.kind || '文件') + ' · ' + (a.size ? U.fmtBytes(a.size) : '已生成') })),
        el('span', { class: 'ax-art__acts' },
          el('span', { class: 'ax-iconbtn', style: { width: '28px', height: '28px' }, title: '预览', html: icons.get('eye', 15) }),
          el('span', { class: 'ax-iconbtn', style: { width: '28px', height: '28px' }, title: '下载', html: icons.get('download', 15) })
        )
      );
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ax-iconbtn')) {
          const isDownload = e.target.closest('.ax-iconbtn').title === '下载';
          if (isDownload) { U.download(a.name, a.content || '', a.mime); U.toast('已开始下载 ' + a.name, 'ok'); }
          else { bus.emit('artifact:select', { id: a.id }); }
          return;
        }
        bus.emit('artifact:select', { id: a.id });
        bus.emit('panel:open', { tab: 'artifacts' });
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderDiff(diff) {
    const box = el('div', { class: 'ax-diff' });
    box.appendChild(el('div', { class: 'ax-diff__head' },
      icons.fileNode(diff.path, 15),
      el('span', { text: diff.path }),
      el('span', { class: 'ax-diff__stat' },
        el('span', { class: 'ax-diff__add', text: '+' + (diff.add || 0) }),
        el('span', { class: 'ax-diff__del', text: '-' + (diff.del || 0) })
      )
    ));
    const body = el('div', { class: 'ax-diff__body ax-scroll' });
    (diff.lines || []).forEach((l) => {
      body.appendChild(el('div', { class: 'ax-diff__line ax-diff__line--' + l.t },
        el('span', { text: l.n != null ? String(l.n) : '' }),
        el('span', { text: (l.t === 'add' ? '+ ' : l.t === 'del' ? '- ' : '  ') + l.s })
      ));
    });
    box.appendChild(body);
    return box;
  }

  /* ============================================================
     发送与 Agent 编排
     ============================================================ */
  function sendUserMessage(convId, text, attachments) {
    pushMessage(convId, {
      id: U.uid('m'), role: 'user', text, ts: Date.now(),
      attachments: attachments || []
    });
    touchConv(convId);
    if (store.get('ui.view') !== 'chat') goChat();
    else { paintMessages(); scrollToEnd(true); }
    const conv = (store.get('conversations') || []).find((c) => c.id === convId);
    if (conv && conv.title === '新对话') autoTitle(convId, text);
  }

  function touchConv(id) {
    store.set('conversations', (store.get('conversations') || []).map((c) => (c.id === id ? Object.assign({}, c, { updatedAt: Date.now() }) : c)));
  }

  async function autoTitle(convId, text) {
    await U.sleep(700);
    const clean = text.replace(/\s+/g, ' ').replace(/^(帮我|请|麻烦|我要|把)/, '').trim();
    const title = (clean.length > 18 ? clean.slice(0, 18) + '…' : clean) || '新对话';
    store.set('conversations', (store.get('conversations') || []).map((c) => (c.id === convId ? Object.assign({}, c, { title, aiTitled: true }) : c)));
    bus.emit('chat:title', { id: convId, title });
    A.shell && A.shell.render();
  }

  let streamCtl = null;

  function stopStreaming() {
    if (streamCtl) {
      streamCtl.stopped = true;
      if (typeof streamCtl.abort === 'function') { try { streamCtl.abort(); } catch (e) {} }
    }
    const conv = activeConv();
    store.set('streaming', false);
    if (conv && chatComposer) chatComposer._api.setStreaming(false);
    U.toast('已停止生成', 'warn');
  }

  /* ============================================================
     真实对话链路：经 server/ 网关转发 OpenAI 兼容模型（流式 SSE）
     产出物不是「按关键词编的」，而是从模型真实回复中的代码块解析落盘。
     ============================================================ */
  const FILE_META = {
    js: ['JavaScript', 'text/javascript'], ts: ['TypeScript', 'text/typescript'],
    html: ['HTML', 'text/html'], css: ['CSS', 'text/css'], json: ['JSON', 'application/json'],
    md: ['Markdown', 'text/markdown'], py: ['Python', 'text/x-python'], sh: ['Shell', 'text/x-sh'],
    yml: ['YAML', 'text/yaml'], yaml: ['YAML', 'text/yaml'], sql: ['SQL', 'text/x-sql'],
    txt: ['文本', 'text/plain'], xml: ['XML', 'application/xml'], java: ['Java', 'text/x-java'],
    go: ['Go', 'text/x-go'], rs: ['Rust', 'text/x-rust'], php: ['PHP', 'text/x-php'],
    rb: ['Ruby', 'text/x-ruby'], c: ['C', 'text/x-c'], cpp: ['C++', 'text/x-c++'],
    kt: ['Kotlin', 'text/x-kotlin'], swift: ['Swift', 'text/x-swift'], csv: ['CSV', 'text/csv'],
    log: ['日志', 'text/plain'], ini: ['配置', 'text/plain'], toml: ['TOML', 'text/plain']
  };
  const LANG_EXT = {
    javascript: 'js', js: 'js', jsx: 'js', typescript: 'ts', ts: 'ts', tsx: 'ts',
    html: 'html', xml: 'xml', css: 'css', scss: 'css', json: 'json', jsonc: 'json',
    md: 'md', markdown: 'md', python: 'py', py: 'py', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
    yaml: 'yml', yml: 'yml', sql: 'sql', java: 'java', go: 'go', golang: 'go',
    rust: 'rs', rs: 'rs', php: 'php', ruby: 'rb', rb: 'rb', c: 'c', cpp: 'cpp', 'c++': 'cpp',
    kotlin: 'kt', kt: 'kt', swift: 'swift', csv: 'csv', toml: 'toml', ini: 'ini', text: 'txt', txt: 'txt'
  };

  function metaOf(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    return FILE_META[ext] || ['文件', 'application/octet-stream'];
  }

  function byteSize(s) {
    try { return new Blob([s]).size; } catch (e) { return String(s).length; }
  }

  const SYSTEM_PROMPT = [
    '你是 AYCHO 工作台的执行智能体，运行在用户本机的 AYCHO 工作台内，通过工作区（/workspace）与用户协作。',
    '风格要求：使用简体中文，结论先行，动作明确，绝不空泛；不要输出与任务无关的客套话。',
    '能力边界：你能真实调用终端、读写工作区文件、联网检索与操作浏览器；无法执行的操作要直接说明原因，禁止假装执行。需要打开网页、执行命令、读写文件时，直接输出动作标记（见下），前端会自动执行。',
    '动作标记（前端会自动解析并执行，你只需输出，不要假装已执行）：',
    '  打开网址 → 在回复中输出 [browser:https://example.com]',
    '  执行终端命令 → 输出 [terminal:ls -la]',
    '  读文件 → 输出 [fs:read 路径]；写文件 → 输出 [fs:write 路径]',
    '  调用技能 → 输出 [skill:技能id 参数]（技能清单见上文）',
    '标记单独成行或跟在动作说明后，执行结果前端会回报；不要在标记前加多余解释。',
    '子 agent 协作：当有「协作代理」参与时，你像项目经理一样分发任务——明确告诉每个 agent 做什么、交付什么；它们各自产出结论后由你汇总裁决，不要替子 agent 假装它们的产出。',
    '技能主动调用：当用户消息命中某个已启用技能的触发条件（如"录一段音"、"做个 PPT"、"整理周报"），主动调用对应技能完成动作，并在回复中说明用了哪个技能；不要等用户点名。',
    '产出物约定：当需要交付文件时，必须用 Markdown 代码块给出完整内容，并在代码块语言标注后写明文件名，格式：```文件名 或 ```语言 filename=文件名。',
    '严禁编造执行结果、文件路径或数据；不确定就说不确定。'
  ].join('\n');

  /* 主动技能调用（用户要求：AI 觉得需要就主动调技能）
     把当前所有已启用技能的清单（id+名称+触发词+描述）注入 system prompt，
     让 AI 知道有哪些技能可以主动调用，命中即声明使用。 */
  function activeSkillDigest() {
    if (!(A.skillExt && typeof A.skillExt.list === 'function')) return '';
    const list = (A.skillExt.list() || []).filter((s) => s && s.name);
    if (!list.length) return '';
    return '当前可用技能清单（用户已启用，可在任务中主动调用）：\n' +
      list.map((s) => {
        const trig = (s.triggers && s.triggers.length) ? '（触发词：' + s.triggers.join(' / ') + '）' : '';
        return '  · ' + s.name + (s.id ? ' [' + s.id + ']' : '') + (s.desc ? '：' + String(s.desc).slice(0, 60) : '') + trig;
      }).join('\n');
  }
  function providerOf(modelId) {
    const ps = store.get('providers') || [];
    for (const p of ps) {
      const m = (p.models || []).find((x) => x.id === modelId);
      if (m) return { provider: p, model: m };
    }
    return { provider: null, model: null };
  }

  function attachTextOf(msg) {
    const list = (msg && msg.attachments) || [];
    const parts = list.filter((a) => a && a.content).map((a) => `\n\n[附件 ${a.name}]\n\`\`\`\n${String(a.content).slice(0, 20000)}\n\`\`\``);
    return parts.join('');
  }

  /** 组装真实上下文（取最近 24 条消息） */
  function buildContext(convId) {
    const out = [{ role: 'system', content: SYSTEM_PROMPT + '\n' + activeSkillDigest() }];
    const agents = (store.get('activeAgentIds') || []).map((id) => ((store.get('agents') || []).find((a) => a.id === id) || {}).name).filter(Boolean);
    if (agents.length) {
      out.push({ role: 'system', content: '本次由以下协作代理参与：' + agents.join('、') + '。请在回复中体现分工与各自结论。' });
      /* 子 agent 互对话：每个 agent 的历史结论 + 最近一轮发言，让 AI 看到"它们在讨论什么" */
      const convAgents = (store.get('activeAgentIds') || []);
      convAgents.forEach((aid) => {
        const msgs = messagesOf(convId).filter((m) => m.role === 'agent' && m.agentId === aid && !m.streaming);
        const recent = msgs.slice(-3);
        if (recent.length) {
          const def = (store.get('agents') || []).find((a) => a.id === aid) || {};
          const lines = recent.map((m) => '  - ' + (def.name || aid) + '（' + m.ts + '）：' + (m.text || '').slice(0, 200));
          out.push({ role: 'system', content: '【' + (def.name || aid) + ' 的历史结论】\n' + lines.join('\n') + '\n请将上述结论并入当前任务分工，避免重复劳动。' });
        }
      });
    }
    /* 主动技能调用（用户要求：AI 觉得需要就主动调技能） */
    if (A.skillExt && typeof A.skillExt.pickSkills === 'function') {
      const lastUser = (messagesOf(convId).slice().reverse().find((m) => m.role === 'user' && m.text) || {}).text || '';
      const hits = A.skillExt.pickSkills(lastUser);
      if (hits.length) {
        out.push({ role: 'system', content: '检测到可用技能：' + hits.map((s) => s.name + '（触发词「' + s.trigger + '」）').join('；') + '。请在执行任务时主动调用这些技能完成对应动作。' });
      }
    }
    messagesOf(convId).slice(-24).forEach((m) => {
      if (!m || !m.text) return;
      if (m.role === 'user') out.push({ role: 'user', content: m.text + attachTextOf(m) });
      else if (m.role === 'assistant' && !m.streaming) out.push({ role: 'assistant', content: m.text });
      else if (m.role === 'agent') out.push({ role: 'assistant', content: '【' + (m.name || 'Agent') + '】' + m.text });
    });
    return out;
  }

  /** 从模型真实回复里解析代码块，落为真实产出物 */
  function extractArtifacts(text) {
    const out = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let m, i = 0;
    const used = {};
    while ((m = re.exec(text || ''))) {
      i++;
      const info = String(m[1] || '').trim();
      let lang = info;
      let name = '';
      const nm = info.match(/(?:filename|file|path|name)\s*[:=]\s*([^\s]+)/i);
      if (nm) { name = nm[1]; lang = info.replace(nm[0], '').trim(); }
      const body = String(m[2] || '');
      if (!body.trim()) continue;
      if (!name) {
        const f2 = body.split('\n')[0].match(/^\s*(?:\/\/|#|<!--|\/\*)\s*(?:filename|file|path|name)\s*[:=]\s*([^\s>*]+)/i);
        if (f2) name = f2[1];
      }
      const ext = LANG_EXT[lang.toLowerCase()] || lang.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!name) name = 'aycho-output-' + i + '.' + (ext || 'txt');
      else name = name.split(/[\\/]/).pop();
      if (name && !/\.[a-z0-9]{1,8}$/i.test(name)) name = name + '.' + (ext || 'txt');
      if (used[name]) name = name.replace(/(\.[a-z0-9]+)$/i, '-' + i + '$1');
      used[name] = true;
      const meta = metaOf(name);
      out.push({
        id: U.uid('a'), name, path: '/workspace/output/' + name,
        kind: meta[0], mime: meta[1], size: byteSize(body),
        content: body.replace(/\s+$/, ''), createdAt: Date.now(), source: 'model'
      });
    }
    return out;
  }

  function diffOf(arts) {
    const a = (arts || []).find((x) => x.content);
    if (!a) return null;
    const lines = String(a.content).split('\n');
    return {
      path: a.path, add: lines.length, del: 0,
      lines: lines.slice(0, 60).map((s, i) => ({ t: 'add', n: i + 1, s }))
    };
  }

  function runReal(convId, text, attachments) {
    const modelId = store.get('activeModelId');
    const pick = providerOf(modelId);
    const useAgents = store.get('activeAgentIds') || [];
    const ctl = { stopped: false, abort: null };
    streamCtl = ctl;
    store.set('streaming', true);
    if (chatComposer) chatComposer._api.setStreaming(true);

    const msgId = U.uid('m');
    const steps = [
      { kind: 'model', label: '建立连接：<code>' + U.escapeHtml((pick.provider && pick.provider.name) || '模型服务') + '</code> · ' + U.escapeHtml(modelLabel(modelId)), status: 'run', detail: { type: 'model', text: 'provider: ' + ((pick.provider && pick.provider.name) || '模型服务') + '\nmodel: ' + modelLabel(modelId) + '\nstream: true' } },
      { kind: useAgents.length ? 'agent' : 'plan', label: useAgents.length ? `协作代理（${useAgents.length}）并行处理` : '流式生成回复', status: 'todo' },
      { kind: 'write', label: '解析产出物与文件变更', status: 'todo' }
    ];
    pushMessage(convId, {
      id: msgId, convId, role: 'assistant', name: 'AYCHO', sub: modelLabel(modelId),
      text: '', reason: '', ts: Date.now(), streaming: true, steps: steps.slice(), stepsOpen: false, real: true
    });
    if (store.get('ui.view') === 'chat') { paintMessages(); scrollToEnd(true); }

    let acc = '', accReason = '', usage = null, lastPaint = 0, pendingPaint = null;
    function msgNow() { return messagesOf(convId).find((m) => m.id === msgId); }
    /* Bug1 修复：流式 delta 只更新最后一条消息的「文本容器」节点（textContent 增量渲染），
       不再整条 replaceWith 重渲染，避免每个 delta 全消息闪烁。
       结束时再整条重渲一次，恢复复制/记忆/重试等完整动作。 */
    function repaint() {
      if (store.get('ui.view') !== 'chat' || !chatInner) return;
      const node = chatInner.querySelector('.ax-msg[data-id="' + msgId + '"]');
      const msg = msgNow();
      if (node && msg) { node.replaceWith(renderMessage(msg)); scrollToEnd(false); }
    }
    function repaintTextOnly() {
      if (store.get('ui.view') !== 'chat' || !chatInner) return;
      const node = chatInner.querySelector('.ax-msg[data-id="' + msgId + '"]');
      if (!node) return;
      const msg = msgNow();
      if (!msg) return;
      let textNode = node.querySelector('.ax-msg__text');
      if (textNode) {
        /* 去掉旧的 thinking 占位 / caret，重建为纯文本容器 */
        if (!textNode.classList.contains('ax-text-only')) {
          const tn = el('div', { class: 'ax-msg__text ax-text-only' });
          textNode.replaceWith(tn);
          textNode = tn;
        }
        textNode.textContent = acc || '';
        if (acc) textNode.appendChild(el('span', { class: 'ax-caret', 'aria-hidden': 'true' }));
      }
      let reasonBox = node.querySelector('.ax-reason');
      if (reasonBox) {
        const reasonBody = reasonBox.querySelector('.ax-reason__body');
        if (reasonBody && accReason) {
          reasonBody.textContent = accReason;
          try { reasonBody.scrollTop = reasonBody.scrollHeight; } catch (e) {}
        }
      }
      scrollToEnd(false);
    }
    function paintSoon() {
      const now = Date.now();
      if (now - lastPaint > 60) { lastPaint = now; repaintTextOnly(); return; }
      if (pendingPaint) return;
      pendingPaint = setTimeout(() => { pendingPaint = null; lastPaint = Date.now(); repaintTextOnly(); }, 60);
    }

    // 仅当用户为该服务商填了自己的 Key 时才透传 baseUrl/apiKey，
    // 否则留空交由服务端网关使用其已配置的模型（避免默认服务商的地址覆盖服务端配置导致 401）
    const userKey = (pick.provider && pick.provider.keyRef) || '';
    const handle = A.api.chat({
      model: userKey ? modelId : '',
      baseUrl: userKey ? ((pick.provider && pick.provider.baseUrl) || '') : '',
      apiKey: userKey,
      messages: buildContext(convId),
      temperature: (store.get('settings.advanced.temperature') == null ? 0.7 : store.get('settings.advanced.temperature')),
      /* 真实推理参数：Level 0–5 由后端映射为 reasoning_effort / thinking.budget_tokens / enable_thinking */
      reasoningLevel: reasonLevel(),
      thinkingMode: store.get('thinking') !== false,
      reasoning: store.get('thinking') !== false
    }, {
      onDelta(t) {
        if (ctl.stopped) return;
        if (steps[0].status !== 'ok') { steps[0].status = 'ok'; steps[0].meta = '已连接'; steps[1].status = 'run'; }
        acc += t;
        updateMessage(convId, msgId, { text: acc, steps: steps.slice() });
        paintSoon();
      },
      onMeta(info) {
        const r = (info && info.reasoning) || null;
        if (!r) return;
        store.set('reasonMeta', r);
        updateMessage(convId, msgId, { reasonMeta: r });
      },
      onReason(t) {
        if (ctl.stopped) return;
        accReason += t;
        updateMessage(convId, msgId, { reason: accReason });
        paintSoon();          // 思考内容实时刷新（60ms 节流）
      },
      onUsage(u) {
        usage = u;
        const det = (u && (u.completion_tokens_details || u.output_tokens_details)) || null;
        const rt = det ? (det.reasoning_tokens != null ? det.reasoning_tokens : det.thinking_tokens) : null;
        if (rt != null) updateMessage(convId, msgId, { reasonTokens: rt });
      },
      onDone() {
        if (ctl.stopped) return finishReal(true);
        finishReal(false);
      },
      onError(err) {
        if (ctl.stopped) return finishReal(true);
        const msg = (err && err.message) || '生成失败';
        steps[0].status = 'ok';
        steps[1].status = 'err'; steps[1].meta = '失败';
        updateMessage(convId, msgId, {
          text: (acc ? acc + '\n\n' : '') + '**生成失败：**' + msg,
          streaming: false, steps: steps.slice(), error: msg
        });
        repaint();
        store.set('streaming', false);
        if (chatComposer) chatComposer._api.setStreaming(false);
        if (/Key|密钥|401|403/.test(msg)) U.toast('模型未配置或密钥无效：请到「设置 → API」填写 Base URL 与 Key', 'err');
        else U.toast('生成失败：' + msg, 'err');
        bus.emit('msg:done', { convId, msgId });
      }
    });
    ctl.abort = handle && handle.abort;
    if (handle && handle.promise && typeof handle.promise.catch === 'function') handle.promise.catch(() => {});

    function finishReal(interrupted) {
      streamCtl = null;
      if (pendingPaint) { clearTimeout(pendingPaint); pendingPaint = null; }
      store.set('streaming', false);
      if (chatComposer) chatComposer._api.setStreaming(false);
      steps[0].status = 'ok';
      if (steps[1].status === 'run') { steps[1].status = 'ok'; }
      steps[1].meta = usage && usage.total_tokens ? (usage.total_tokens + ' tokens') : '完成';
      steps[2].status = 'ok';

      const patch = { streaming: false, steps: steps.slice(), reason: accReason, reasonMeta: store.get('reasonMeta') || null };
      if (interrupted) patch.text = (acc || '') + '\n\n_（已手动停止生成）_';
      else {
        const arts = extractArtifacts(acc);
        if (arts.length) {
          store.set('artifacts', arts.concat(store.get('artifacts') || []));
          armsEmit(arts, convId);
          patch.artifacts = arts.map((a) => a.id);
          const d = diffOf(arts);
          if (d) patch.diff = d;
          steps[2].meta = arts.length + ' 个产出物';
          patch.steps = steps.slice();
        }
      }
      /* 动作标记自动执行（AI 输出 [browser:…] [terminal:…] [fs:…] [skill:…] → 前端自动做） */
      if (!interrupted) autoRunActions(acc || '');
      updateMessage(convId, msgId, patch);
      repaint();
      bus.emit('msg:done', { convId, msgId, msg: msgNow() });
      touchConv(convId);
      A.shell && A.shell.renderList();
      A.sync && A.sync.now && A.sync.now();
    }
  }

  /* AI 回复里的动作标记 → 前端自动执行（用户要求：AI 可以主动调用功能）
     支持：[browser:URL] [terminal:命令] [fs:read 路径] [fs:write 路径] [skill:技能id 参数] */
  function autoRunActions(text) {
    const t = String(text || '');
    let m, ran = 0;
    const reB = /\[browser:\s*([^\]\s]+)\s*\]/g;
    const reT = /\[terminal:\s*([^\]\n]+)\]/g;
    const reF = /\[fs:(read|write)\s+([^\]\n]+)\]/g;
    const reS = /\[skill:\s*([a-z0-9_.-]+)\s*([^\]\n]*)\]/g;
    while ((m = reB.exec(t))) {
      const u = String(m[1]).trim();
      if (/^https?:\/\//i.test(u)) {
        bus.emit('panel:open', { tab: 'browser' });
        bus.emit('browser:navigate', { url: u });
        ran++;
      }
    }
    while ((m = reT.exec(t))) {
      const cmd = String(m[1]).trim();
      if (cmd) {
        bus.emit('panel:open', { tab: 'terminal' });
        bus.emit('terminal:run', { cmd: cmd, byAi: true });
        ran++;
      }
    }
    while ((m = reF.exec(t))) {
      const op = m[1];
      const p = String(m[2]).trim();
      if (!p) continue;
      bus.emit('panel:open', { tab: 'files' });
      if (op === 'read') bus.emit('file:open', { path: p });
      else bus.emit('file:write', { path: p });
      ran++;
    }
    while ((m = reS.exec(t))) {
      const sid = m[1];
      const args = String(m[2]).trim();
      if (A.skillExt && typeof A.skillExt.run === 'function') {
        A.skillExt.run(sid, args || undefined);
        ran++;
      } else if (A.skillExt && typeof A.skillExt.act === 'function' && args) {
        const parts = args.split(/\s+/);
        A.skillExt.act(sid, parts[0] || 'run', parts.slice(1).join(' ') || undefined);
        ran++;
      }
    }
    if (ran) {
      bus.emit('chat:actions', { count: ran, convId: store.get('activeConversationId') });
      U.toast('已自动执行 ' + ran + ' 个动作', 'ok');
    }
  }

  function runSimulation(convId, text, attachments) {
    const convAgents = store.get('activeAgentIds') || [];
    const useAgents = convAgents.length ? convAgents : ['file'];
    const defs = store.get('agents') || [];
    const ctl = { stopped: false };
    streamCtl = ctl;
    store.set('streaming', true);
    if (chatComposer) chatComposer._api.setStreaming(true);

    const mainId = U.uid('m');
    const plan = buildPlan(text, useAgents, attachments);
    pushMessage(convId, {
      id: mainId, convId, role: 'assistant', name: 'AYCHO', sub: modelLabel(store.get('activeModelId')),
      text: '', ts: Date.now(), streaming: true,
      steps: plan.map((p) => ({ label: p.label, status: 'todo' })), stepsOpen: false
    });
    if (store.get('ui.view') === 'chat') { paintMessages(); scrollToEnd(true); }

    function repaint(msgId) {
      if (store.get('ui.view') !== 'chat' || !chatInner) return;
      const node = chatInner.querySelector('.ax-msg[data-id="' + msgId + '"]');
      const msg = messagesOf(convId).find((m) => m.id === msgId);
      if (node && msg) { node.replaceWith(renderMessage(msg)); scrollToEnd(false); }
    }

    function typeText(msgId, full, speed) {
      return new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          if (ctl.stopped) return resolve();
          i = Math.min(full.length, i + 2);
          updateMessage(convId, msgId, { text: full.slice(0, i) });
          repaint(msgId);
          if (i < full.length) setTimeout(tick, speed);
          else resolve();
        };
        tick();
      });
    }

    function finish(interrupted) {
      store.set('streaming', false);
      if (chatComposer) chatComposer._api.setStreaming(false);
      const cur = messagesOf(convId).find((m) => m.id === mainId);
      const patch = { streaming: false, steps: (cur.steps || []).map((s) => (s.status === 'run' ? Object.assign({}, s, { status: 'ok' }) : s)) };
      if (interrupted) patch.text = (cur.text || '') + '\n\n_（已手动停止）_';
      updateMessage(convId, mainId, patch);
      repaint(mainId);
      bus.emit('msg:done', { convId, msgId: mainId, msg: messagesOf(convId).find((m) => m.id === mainId) });
      touchConv(convId);
      A.shell && A.shell.renderList();
    }

    (async function orchestrate() {
      await U.sleep(320);
      if (ctl.stopped) return finish(true);

      await typeText(mainId, plan[0].intro, 18);
      const steps = plan.map((p) => ({ label: p.label, status: 'todo' }));
      const insertAt = Math.max(1, Math.ceil(plan.length / 2));
      const agentList = useAgents.filter((id) => defs.some((a) => a.id === id));

      for (let i = 0; i < plan.length; i++) {
        if (ctl.stopped) return finish(true);
        steps[i].status = 'run';
        updateMessage(convId, mainId, { steps: steps.slice() });
        repaint(mainId);
        await U.sleep(plan[i].ms);
        if (ctl.stopped) return finish(true);
        steps[i].status = 'ok';
        steps[i].meta = plan[i].meta;
        updateMessage(convId, mainId, { steps: steps.slice() });
        repaint(mainId);

        /* 中间插入协作 Agent 发言 */
        if (i + 1 === insertAt && agentList.length) {
          for (let k = 0; k < agentList.length; k++) {
            if (ctl.stopped) return finish(true);
            const def = defs.find((a) => a.id === agentList[k]) || { name: 'Agent', color: AGENT_PALETTE[k % AGENT_PALETTE.length] };
            const mid = U.uid('m');
            pushMessage(convId, { id: mid, convId, role: 'agent', agentId: def.id, name: def.name, color: def.color, text: '', ts: Date.now(), streaming: true });
            if (store.get('ui.view') === 'chat') { paintMessages(); scrollToEnd(true); }
            await typeText(mid, agentLine(def, text), 16);
            if (ctl.stopped) return finish(true);
            updateMessage(convId, mid, { streaming: false });
            repaint(mid);
            await U.sleep(240);
          }
        }
      }

      if (ctl.stopped) return finish(true);

      /* 产出物 + diff */
      const arts = makeArtifacts(text, attachments);
      if (arts.length) {
        store.set('artifacts', arts.concat(store.get('artifacts') || []));
        armsEmit(arts, convId);
      }
      const d = makeDiff(text);
      const patch = {};
      if (arts.length) patch.artifacts = arts.map((a) => a.id);
      if (d) patch.diff = d;
      if (Object.keys(patch).length) { updateMessage(convId, mainId, patch); repaint(mainId); }

      await typeText(mainId, closingText(text, useAgents), 14);
      if (ctl.stopped) return finish(true);
      finish(false);
    })();
  }

  function armsEmit(arts, convId) {
    arts.forEach((a) => bus.emit('artifact:add', { artifact: a, convId }));
  }

  function buildPlan(text, agents, attachments) {
    const hasFile = (attachments || []).length > 0;
    const t = (text || '').slice(0, 26);
    return [
      { label: `理解目标：<code>${U.escapeHtml(t)}${text.length > 26 ? '…' : ''}</code>`, meta: '0.3s', ms: 700, intro: '收到，我先把这件事拆开，然后协调最合适的 Agent 动手。' },
      { label: hasFile ? `读取附件（${attachments.length} 个文件）并提取要点` : '检索工作区上下文与历史记忆', meta: '1.2s', ms: 1100 },
      { label: '选择能力：按需调用 Skill / MCP / 本地工具', meta: '0.6s', ms: 900 },
      { label: '执行并校验结果', meta: '2.1s', ms: 1400 },
      { label: '整理产出物并写入工作目录', meta: '0.4s', ms: 800 }
    ];
  }

  function agentLine(def, text) {
    const map = {
      file: '我扫了一遍工作目录，相关的历史产物和文件结构都拿到了。已把需要的文件路径整理给主 AI。',
      app: '应用侧我确认过：目标 App 已安装，Shizuku 授权有效，可以直接执行自动化步骤。',
      computer: '系统侧没问题：终端环境可用，依赖齐全，我准备好在沙箱里跑命令了。',
      browser: '我用浏览器把目标页面打开并抓到了关键内容，登录态还在，可以继续操作。',
      search: '联网核对完成：找到 3 条可靠来源，其中 2 条是一手信息，结论已经标注来源。'
    };
    return (map[def.id] || `我是 ${def.name}，这部分我来处理，已经把结果交给主 AI。`) + (def.id === 'file' ? '' : '');
  }

  function closingText(text, agents) {
    const who = agents.length > 1 ? `${agents.length} 个 Agent 协作` : '1 个 Agent';
    return `都安排好了：这次由 ${who} 完成，结果和产出物都在下面。\n\n` +
      `**你要做的事**：确认产出物是否符合预期，需要我改哪里直接说一句就行。`;
  }

  function makeArtifacts(text, attachments) {
    const out = [];
    const now = Date.now();
    if (/(ppt|演示|幻灯片)/i.test(text)) {
      out.push({ id: U.uid('a'), name: 'AYCHO_介绍.pptx', path: '/workspace/output/AYCHO_介绍.pptx', kind: 'PPT', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 184320, content: '', createdAt: now });
    }
    if (/(pdf|导出)/i.test(text)) {
      out.push({ id: U.uid('a'), name: '导出结果.pdf', path: '/workspace/output/导出结果.pdf', kind: 'PDF', mime: 'application/pdf', size: 96256, content: '', createdAt: now });
    }
    if (/(代码|重构|js|html|函数|组件)/i.test(text)) {
      out.push({ id: U.uid('a'), name: 'aycho-patch.js', path: '/workspace/output/aycho-patch.js', kind: 'JavaScript', mime: 'text/javascript', size: 4210, content: '// AYCHO 生成的补丁\n', createdAt: now });
    }
    if (/(周报|总结|文档|简历|报告)/i.test(text)) {
      out.push({ id: U.uid('a'), name: '成果报告.md', path: '/workspace/output/成果报告.md', kind: 'Markdown', mime: 'text/markdown', size: 3180, content: '# 成果报告\n', createdAt: now });
    }
    if (attachments && attachments.length && !out.length) {
      out.push({ id: U.uid('a'), name: '处理结果.txt', path: '/workspace/output/处理结果.txt', kind: '文本', mime: 'text/plain', size: 1024, content: '处理完成。\n', createdAt: now });
    }
    return out;
  }

  function makeDiff(text) {
    if (!/(代码|重构|js|html|函数|组件|改一下)/i.test(text || '')) return null;
    return {
      path: 'aycho-web/js/chat.js',
      add: 6, del: 3,
      lines: [
        { t: 'ctx', n: 12, s: 'function doSend(ta, filesRow) {' },
        { t: 'del', n: 13, s: '  const text = ta.value;' },
        { t: 'add', n: 13, s: '  const text = (ta.value || \'\').trim();' },
        { t: 'ctx', n: 14, s: '  if (!text) return;' },
        { t: 'add', n: 15, s: '  // 附件一并透传给子 Agent' },
        { t: 'add', n: 16, s: '  const files = U.$$(\'.ax-filetag\', filesRow);' },
        { t: 'del', n: 17, s: '  runSimulation(conv.id, text);' },
        { t: 'add', n: 17, s: '  runSimulation(conv.id, text, files.map((n) => n.dataset.name));' }
      ]
    };
  }

  /* ============================================================
     视图切换
     ============================================================ */
  let stageHost;
  function renderStage() {
    if (!stageHost) return;
    const view = store.get('ui.view');
    const old = stageHost.querySelector('.ax-view');
    const node = view === 'chat' ? renderChat() : renderHome();
    if (old) old.replaceWith(node); else stageHost.appendChild(node);
  }

  function setView(v) {
    store.set('ui.view', v);
    renderStage();
    A.shell && A.shell.renderTop && A.shell.render();
  }
  function goHome() { setView('home'); }
  function goChat(convId) {
    if (convId) {
      const exists = (store.get('conversations') || []).some((c) => c.id === convId);
      if (exists) store.set('activeConversationId', convId);
      else newConversation();          // 直达地址里的会话不存在 → 落到新会话，避免空白/报错
    } else if (!activeConv()) {
      newConversation();
    }
    setView('chat');
  }

  /* ============================================================
     分享路由 #/s/<slug>
     ============================================================ */
  function shareFind(slug) {
    const items = (store.get('share.items') || []).slice();
    return items.find((x) => x.slug === slug) || (store.get('artifacts') || []).find((a) => a.slug === slug) || null;
  }

  function paintShareMissing(body, slug) {
    body.appendChild(el('div', { class: 'ax-empty', style: { paddingTop: '18vh' } },
      el('span', { html: icons.get('link', 26) }),
      el('span', { text: '分享不存在或已被撤回' }),
      el('span', { class: 'ax-hint', text: 'slug: ' + U.escapeHtml(slug) })
    ));
  }

  function paintShare(body, rec) {
    const mime = rec.mime || 'text/plain';
    if (mime.includes('html')) {
      const frame = el('iframe', { sandbox: 'allow-scripts allow-forms', srcdoc: rec.content || '<!doctype html><meta charset="utf-8"><p>空内容</p>' });
      body.appendChild(frame);
    } else if (mime.startsWith('image/')) {
      body.appendChild(el('div', { style: { display: 'grid', placeItems: 'center', height: '100%' } },
        el('img', { src: rec.url || rec.content, style: { maxWidth: '92%', maxHeight: '88%', borderRadius: '14px' }, alt: rec.name || '' })));
    } else {
      body.appendChild(el('pre', { class: 'ax-sharepage__src ax-scroll', text: rec.content || '（无文本内容）' }));
    }
  }

  function renderShare(slug) {
    const host = document.getElementById('ax-share-page');
    host.innerHTML = '';
    host.hidden = false;
    const local = shareFind(slug);

    const bar = el('div', { class: 'ax-sharepage__bar' },
      el('span', { class: 'ax-brand__logo', style: { width: '26px', height: '26px' } }, el('span', { style: { fontSize: '13px' }, text: 'A' })),
      el('span', { class: 'ax-truncate', text: local ? (local.name || 'AYCHO 分享') : '分享内容' }),
      el('span', { class: 'ax-topbar__badge', text: local && local.remote ? '服务端分享 · 只读' : '只读分享' }),
      el('span', { class: 'ax-span' }),
      el('button', { class: 'ax-btn', type: 'button', onclick: () => { location.hash = ''; host.hidden = true; } }, el('span', { text: '返回工作台' }))
    );
    const body = el('div', { class: 'ax-sharepage__body' });
    host.appendChild(bar);
    host.appendChild(body);

    if (local) { paintShare(body, local); return; }
    /* 本机没有 → 去服务端取（跨设备真实可达）；取不到就是真不存在 */
    body.appendChild(el('div', { class: 'ax-empty', style: { paddingTop: '18vh' } },
      el('span', { html: icons.get('refresh', 22) }), el('span', { text: '正在从服务端读取分享内容…' })));
    if (A.share && A.share.fetch) {
      A.share.fetch(slug).then((rec) => {
        body.innerHTML = '';
        if (rec) {
          bar.children[1].textContent = rec.name || 'AYCHO 分享';
          bar.children[2].textContent = '服务端分享 · 只读';
          paintShare(body, rec);
        } else paintShareMissing(body, slug);
      }, () => { body.innerHTML = ''; paintShareMissing(body, slug); });
    } else {
      body.innerHTML = '';
      paintShareMissing(body, slug);
    }
  }

  function route() {
    const h = location.hash || '';
    const m = h.match(/^#\/s\/([A-Za-z0-9_-]+)/);
    const host = document.getElementById('ax-share-page');
    if (m) { renderShare(m[1]); return true; }
    if (host) host.hidden = true;
    return false;
  }

  /* ============================================================
     挂载
     ============================================================ */
  let didMount = false;   // 幂等：boot 与自启动可能各调一次
  A.chat = {
    mount() {
      if (didMount) return;
      didMount = true;
      stageHost = document.getElementById('ax-stage');
      seed();
      bus.on('chat:select', (p) => goChat(p && p.id));
      bus.on('chat:new', () => goChat());
      bus.on('msg:stop', stopStreaming);
      bus.on('state:change', (e) => {
        const p = e && e.path;
        if (p === 'activeModelId' || p === 'reasoning') {
          const fresh = renderStage && stageHost && stageHost.querySelector('.ax-view');
        }
      });
      window.addEventListener('hashchange', route);
      if (!route()) {
        if (!store.get('activeConversationId') && (store.get('conversations') || []).length) {
          store.set('activeConversationId', store.get('conversations')[0].id);
        }
        renderStage();
      }
    },
    renderStage, setView, goHome, goChat, route,
    newConversation: () => { const c = newConversation(); goChat(c.id); return c; },
    send: (text) => { if (chatComposer) { chatComposer._api.refill(text); doSend(chatComposer._api.textarea, chatComposer._api.filesRow); } },
    /* 技能可直接写入输入框（不发送） */
    fill: (text) => {
      const t = String(text == null ? '' : text);
      if (chatComposer) { chatComposer._api.refill(t); chatComposer._api.focus(); return true; }
      const ta = document.querySelector('.ax-blob__input');
      if (ta) { ta.value = t; ta.dispatchEvent(new Event('input')); ta.focus(); return true; }
      return false;
    },
    /* 供技能追加文本（如语音识别增量结果） */
    append: (text) => {
      const ta = (chatComposer && chatComposer._api.textarea) || document.querySelector('.ax-blob__input');
      if (!ta) return false;
      ta.value = (ta.value || '') + String(text == null ? '' : text);
      ta.dispatchEvent(new Event('input'));
      return true;
    }
  };
})();
