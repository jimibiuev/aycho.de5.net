/* AYCHO module: js/ov-preview | owner: C | contract: v1 */
/* 预览侧边栏：480px 可拖宽、渲染态/源码态切换、下载/分享/关闭、元素选择入口
   对外暴露 AYCHO.preview={open,close,toggle,isOpen}；默认源码态 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
  function ST() { return A.store || { get: function () {}, set: function () {}, save: function () {} }; }
  function get(p, d) { try { var v = ST().get(p); return v === undefined || v === null ? d : v; } catch (e) { return d; } }
  function set(p, v) { try { ST().set(p, v); if (typeof ST().save === "function") ST().save(); emit("state:change", { path: p }); } catch (e) {} }
  function emit(ev, pl) { try { BUS().emit(ev, pl); } catch (e) {} }
  function on(ev, fn) { try { BUS().on(ev, fn); } catch (e) {} }
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
  function fmtBytes(n) {
    if (A.util && typeof A.util.fmtBytes === "function") { try { return A.util.fmtBytes(n); } catch (e) {} }
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function download(name, content, mime) {
    if (A.util && typeof A.util.download === "function") { try { A.util.download(name, content, mime || "text/plain"); return true; } catch (e) {} }
    try {
      var blob = new Blob([content], { type: mime || "text/plain" });
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name || "download.txt";
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return true;
    } catch (e) { return false; }
  }

  var layer = null, panel = null, nameEl = null, bodyEl = null, renderPane = null, srcPane = null, toolbar = null;
  var segSrc = null, segRender = null, pickBtn = null, diffBtn = null, ideBtn = null;
  var zoomBtnO = null, zoomBtnI = null, zoomLbl = null;
  var cur = null, curKind = "text", frame = null, lastFocus = null, width = 480;
  var zoom = 1, view = "src";

  function kindOf(art) {
    var n = String((art && (art.name || art.title)) || "").toLowerCase();
    var t = String((art && (art.type || art.contentType)) || "").toLowerCase();
    var ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || "";
    if (/html?$/.test(ext) || t.indexOf("html") >= 0) return "html";
    if (ext === "svg" || t.indexOf("svg") >= 0) return "svg";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].indexOf(ext) >= 0 || t.indexOf("image/") === 0) return "image";
    return "text";
  }
  function contentOf(art) {
    if (!art) return "";
    if (art.content !== undefined && art.content !== null) return String(art.content);
    if (art.text !== undefined && art.text !== null) return String(art.text);
    if (art.code !== undefined) return String(art.code);
    return "";
  }
  function isImageData(art) {
    var s = contentOf(art);
    return /^data:image\//i.test(s) || /^blob:/i.test(s) || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(s);
  }

  function build() {
    if (layer) return;
    var host = document.getElementById("ax-overlay-host") || document.body;
    layer = h("div", { class: "ov-layer" });
    layer.setAttribute("data-ov", "preview");
    layer.style.pointerEvents = "none";
    nameEl = h("span", { class: "ov-name", text: "" });

    panel = h("div", { class: "ov-panel" });
    panel.style.pointerEvents = "auto";
    panel.style.width = width + "px";

    var grip = h("div", { class: "ov-grip", role: "separator", "aria-label": "拖动调整宽度", tabindex: "0" });
    grip.addEventListener("pointerdown", startDrag);
    grip.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { width = Math.min(920, width + 24); panel.style.width = width + "px"; }
      if (e.key === "ArrowRight") { width = Math.max(320, width - 24); panel.style.width = width + "px"; }
    });

    function mkBtn(label, cls, fn, title) {
      var b = h("button", { class: "ov-btn" + (cls ? " " + cls : ""), type: "button", title: title || label }, txt(label));
      b.addEventListener("click", fn);
      return b;
    }

    var head = h("div", { class: "ov-head" }, nameEl,
      mkBtn("下载", "", function () {
        if (!cur) return;
        var nm = cur.name || "download.txt";
        var ok = download(nm, contentOf(cur));
        toast(ok ? "已开始下载" : "下载失败", ok ? "ok" : "error");
      }),
      mkBtn("分享", "", function () {
        if (!cur) return;
        emit("artifact:share", { id: cur.id, name: cur.name });
      }),
      mkBtn("关闭", "", function () { close(); }, "关闭预览 (Esc)"));

    segSrc = h("button", { class: "ov-seg-btn ov-on", type: "button" }, txt("源码态"));
    segRender = h("button", { class: "ov-seg-btn", type: "button" }, txt("渲染态"));
    var seg = h("div", { class: "ov-seg" }, segSrc, segRender);
    segSrc.addEventListener("click", function () { showView("src"); });
    segRender.addEventListener("click", function () { showView("render"); });

    pickBtn = mkBtn("元素选择", "", function () {
      if (!cur) return;
      if (curKind !== "html" && curKind !== "svg") { toast("当前文件不支持元素选择", "error"); return; }
      if (!A.picker || typeof A.picker.open !== "function") { toast("元素选择模块未加载", "error"); return; }
      A.picker.open({ frame: frame, html: contentOf(cur), name: cur.name || "" });
    }, "在预览中选取页面元素");

    /* 改动对比：与上一版逐行 diff（红=删除 绿=新增） */
    diffBtn = mkBtn("改动对比", "", function () { showView(view === "diff" ? "src" : "diff"); }, "与上一版对比：红=删除 绿=新增");
    diffBtn.disabled = true; diffBtn.style.opacity = ".45";

    /* 缩放：图片 / 渲染态页面 */
    zoomBtnO = mkBtn("缩小", "", function () { setZoom(zoom - 0.25); }, "缩小预览");
    zoomBtnI = mkBtn("放大", "", function () { setZoom(zoom + 0.25); }, "放大预览");
    zoomLbl = h("span", { class: "ov-zoom", text: "100%" });

    /* 在 IDE 打开：写入服务端工作区，再切到 IDE 面板 */
    ideBtn = mkBtn("在 IDE 打开", "", function () { openInIde(); }, "把该产出物写入工作区并在 IDE 中打开");

    var lineHint = h("span", { class: "ov-picker-tip", text: "" });
    toolbar = h("div", { class: "ov-toolbar" }, seg, diffBtn, zoomBtnO, zoomLbl, zoomBtnI, pickBtn, h("div", { class: "ov-grow" }), ideBtn, lineHint);

    renderPane = h("div", { class: "ov-pane", hidden: true });
    srcPane = h("div", { class: "ov-pane" });
    bodyEl = h("div", { class: "ov-body" }, renderPane, srcPane);

    panel.appendChild(grip);
    panel.appendChild(head);
    panel.appendChild(toolbar);
    panel.appendChild(bodyEl);
    layer.appendChild(panel);
    host.appendChild(layer);
    document.addEventListener("keydown", onKey, false);
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    if (!layer || !layer.classList.contains("ov-open")) return;
    if (document.querySelector(".st-modal.st-open") || document.querySelector(".ov-result.ov-open")) return;
    e.stopPropagation();
    close();
  }

  /* 拖动改宽 */
  var dragState = null;
  function startDrag(e) {
    if (window.matchMedia && window.matchMedia("(max-width:760px)").matches) return;
    dragState = { x: e.clientX, w: width };
    panel.style.transition = "none";
    document.body.classList.add("ov-dragging");
    e.target.classList.add("ov-dragging");
    e.preventDefault();
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag, { once: true });
  }
  function onDrag(e) {
    if (!dragState) return;
    var maxW = Math.max(320, Math.min(920, window.innerWidth - 160));
    var w = Math.round(dragState.w + (dragState.x - e.clientX));
    w = Math.max(320, Math.min(maxW, w));
    width = w;
    panel.style.width = w + "px";
    if (A.picker && typeof A.picker.sync === "function") { try { A.picker.sync(); } catch (er) {} }
  }
  function endDrag() {
    dragState = null;
    panel.style.transition = "";
    document.body.classList.remove("ov-dragging");
    var g = panel.querySelector(".ov-grip");
    if (g) g.classList.remove("ov-dragging");
    if (A.picker && typeof A.picker.sync === "function") { try { A.picker.sync(); } catch (er) {} }
  }

  function clearPanes() {
    while (renderPane.firstChild) renderPane.removeChild(renderPane.firstChild);
    while (srcPane.firstChild) srcPane.removeChild(srcPane.firstChild);
    frame = null;
    renderPane.hidden = true;
    renderPane.className = "ov-pane";
    srcPane.hidden = false;
  }

  function showView(v) {
    if (!cur) return;
    var canRender = curKind === "html" || curKind === "svg" || curKind === "image";
    if (v === "render" && !canRender) { toast("该文件类型仅有源码态", "info"); v = "src"; }
    if (v === "diff" && !hasBaseline()) { toast("该产出物还没有上一版可对比", "info"); v = "src"; }
    view = v;
    renderPane.hidden = v !== "render";
    srcPane.hidden = v === "render";
    segSrc.classList.toggle("ov-on", v === "src");
    segRender.classList.toggle("ov-on", v === "render");
    diffBtn.classList.toggle("ov-on", v === "diff");
    if (v === "diff") paintDiff(String(cur.prevContent == null ? "" : cur.prevContent), contentOf(cur));
    if (v === "render") applyZoom();
  }

  /* ---------------- 改动对比：行级 LCS diff ---------------- */
  function hasBaseline() {
    return !!(cur && cur.prevContent != null && String(cur.prevContent) !== contentOf(cur));
  }
  function lineDiff(a, b) {
    var A1 = String(a).split(/\r?\n/), B1 = String(b).split(/\r?\n/);
    var n = A1.length, m = B1.length;
    var out = [], i, j;
    if (n * m > 260000) {                       // 大文件降级：按行号对齐比较
      var L = Math.max(n, m);
      for (i = 0; i < L; i++) {
        var x = A1[i], y = B1[i];
        if (x === y) out.push({ t: " ", s: x == null ? "" : x });
        else { if (x != null) out.push({ t: "-", s: x }); if (y != null) out.push({ t: "+", s: y }); }
      }
      return out;
    }
    var dp = [];
    for (i = 0; i <= n; i++) { var row = []; for (j = 0; j <= m; j++) row.push(0); dp.push(row); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i][j] = A1[i] === B1[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A1[i] === B1[j]) { out.push({ t: " ", s: A1[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", s: A1[i] }); i++; }
      else { out.push({ t: "+", s: B1[j] }); j++; }
    }
    while (i < n) out.push({ t: "-", s: A1[i++] });
    while (j < m) out.push({ t: "+", s: B1[j++] });
    return out;
  }
  function paintDiff(a, b) {
    while (srcPane.firstChild) srcPane.removeChild(srcPane.firstChild);
    var rows = lineDiff(a, b);
    var add = 0, del = 0;
    var box = h("div", { class: "ov-diff" });
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.t === "+") add++;
      if (r.t === "-") del++;
      var cls = r.t === "+" ? "ov-diff__row ov-diff__row--add"
        : r.t === "-" ? "ov-diff__row ov-diff__row--del" : "ov-diff__row";
      box.appendChild(h("div", { class: cls },
        h("span", { class: "ov-diff__sign", text: r.t === " " ? " " : r.t }),
        h("span", { class: "ov-diff__txt", text: r.s || "\u200b" })
      ));
    }
    srcPane.appendChild(h("div", { class: "ov-diffhead" },
      h("span", { class: "ov-diff__tag ov-diff__tag--add", text: "+" + add + " 行" }),
      h("span", { class: "ov-diff__tag ov-diff__tag--del", text: "-" + del + " 行" }),
      h("span", { class: "ov-diff__tag", text: "对比上一版" })
    ));
    srcPane.appendChild(box);
  }

  /* ---------------- 缩放 ---------------- */
  function applyZoom() {
    if (zoomLbl) zoomLbl.textContent = Math.round(zoom * 100) + "%";
    if (!renderPane) return;
    var img = renderPane.querySelector(".ov-img");
    if (img) { img.style.width = (zoom * 100) + "%"; img.style.maxWidth = "none"; }
    var svg = renderPane.querySelector(".ov-svg");
    if (svg) { svg.style.transform = "scale(" + zoom + ")"; svg.style.transformOrigin = "top left"; }
    if (frame) { try { frame.style.zoom = String(zoom); } catch (e) {} }
  }
  function setZoom(z) {
    zoom = Math.max(0.25, Math.min(4, Math.round(z * 100) / 100));
    if (view !== "render" && curKind !== "image") { /* 缩放仅作用于渲染态 */ }
    if (view !== "render") showView("render");
    applyZoom();
  }

  /* ---------------- 在 IDE 打开 ---------------- */
  function openInIde() {
    if (!cur) return;
    var nm = String(cur.name || cur.title || "artifact.txt").replace(/^\/+/, "");
    var path = "/workspace/" + nm;
    var content = contentOf(cur);
    /* 先落到本地项目文件列表（IDE 立即可打开） */
    try {
      var recs = get("projectFiles", []);
      if (!Array.isArray(recs)) recs = [];
      var hit = null;
      for (var i = 0; i < recs.length; i++) if (String(recs[i].path) === path) { hit = recs[i]; break; }
      if (hit) { hit.content = content; hit.kind = "file"; hit.updatedAt = Date.now(); }
      else recs.push({ path: path, kind: "file", content: content, updatedAt: Date.now() });
      set("projectFiles", recs);
    } catch (e) {}
    /* 再真写服务端工作区（未连接后端时只留本机草稿，并如实提示） */
    if (A.ide && A.ide.fs && A.ide.fs.write) {
      A.ide.fs.write(path, content).then(function () {
        if (A.ide.fs.refresh) A.ide.fs.refresh(true);
      });
    }
    emit("panel:open", { tab: "ide" });
    emit("file:open", { path: path });
    toast("已在 IDE 打开 " + nm, "ok");
    API.close();
  }

  function paintSource(text) {
    while (srcPane.firstChild) srcPane.removeChild(srcPane.firstChild);
    var lines = String(text).split(/\r?\n/);
    var capped = lines.length > 3000;
    var use = capped ? lines.slice(0, 3000) : lines;
    var gutter = h("div", { class: "ov-gutter" });
    var nums = [];
    for (var i = 1; i <= use.length; i++) nums.push(String(i));
    gutter.textContent = nums.join("\n");
    var pre = h("pre", { class: "ov-src", text: use.join("\n") });
    var code = h("div", { class: "ov-code" }, gutter, pre);
    srcPane.appendChild(code);
    if (capped) srcPane.appendChild(h("div", { class: "ov-share-note", style: { padding: "0 12px 12px" }, text: "文件过大，源码态仅显示前 3000 行。" }));
  }

  function buildRender(art) {
    while (renderPane.firstChild) renderPane.removeChild(renderPane.firstChild);
    frame = null;
    renderPane.className = "ov-pane";
    if (curKind === "html") {
      frame = h("iframe", { class: "ov-frame", sandbox: "allow-scripts allow-forms allow-modals", title: art.name || "预览" });
      frame.setAttribute("srcdoc", contentOf(art));
      renderPane.appendChild(frame);
    } else if (curKind === "svg") {
      renderPane.classList.add("ov-render");
      var wrap = h("div", { class: "ov-svg" });
      wrap.innerHTML = contentOf(art);
      renderPane.appendChild(wrap);
    } else if (curKind === "image") {
      renderPane.classList.add("ov-render");
      var src = contentOf(art);
      if (!isImageData(art)) {
        renderPane.appendChild(h("div", { class: "ov-share-note", text: "仅有二进制引用，无法内联渲染（本地路径无法被浏览器直接读取）。" }));
      } else {
        renderPane.appendChild(h("img", { class: "ov-img", src: src, alt: art.name || "图片预览" }));
      }
    }
  }

  function infoFor(art, text) {
    var bytes = 0;
    try { bytes = new Blob([text]).size; } catch (e) { bytes = text.length; }
    return "类型：" + curKind + " · 字符数：" + text.length + " · 约 " + fmtBytes(bytes) + " · 行数：" + text.split(/\r?\n/).length;
  }

  var API = {
    open: function (art) {
      if (!art) return;
      build();
      cur = art;
      curKind = kindOf(art);
      var text = contentOf(art);
      nameEl.textContent = art.name || art.title || "未命名文件";
      nameEl.title = nameEl.textContent;
      clearPanes();

      if (curKind === "html") { buildRender(art); paintSource(text); }
      else if (curKind === "svg") { buildRender(art); paintSource(text); }
      else if (curKind === "image") {
        buildRender(art);
        while (srcPane.firstChild) srcPane.removeChild(srcPane.firstChild);
        srcPane.appendChild(h("div", { class: "ov-share-note", style: { padding: "14px" }, text: "二进制图片无文本源码。信息：" + infoFor(art, text) + "（dataURL 长度 " + text.length + " 字符）" }));
      } else {
        segRender.disabled = true;
        segRender.style.opacity = ".45";
        paintSource(text || "（空文件）");
      }
      if (curKind !== "text") { segRender.disabled = false; segRender.style.opacity = ""; }
      pickBtn.disabled = !(curKind === "html" || curKind === "svg");
      pickBtn.style.opacity = pickBtn.disabled ? ".45" : "";
      toolbar.querySelector(".ov-picker-tip").textContent = infoFor(art, text);

      /* 版本对比 / 缩放 状态复位 */
      zoom = 1;
      diffBtn.disabled = !hasBaseline();
      diffBtn.style.opacity = diffBtn.disabled ? ".45" : "";
      diffBtn.classList.remove("ov-on");
      zoomBtnO.disabled = zoomBtnI.disabled = !(curKind === "html" || curKind === "svg" || curKind === "image");
      zoomBtnO.style.opacity = zoomBtnI.style.opacity = zoomBtnO.disabled ? ".45" : "";
      zoomLbl.textContent = "100%";

      showView("src"); /* 默认源码态 */
      if (curKind === "image" && !frame) applyZoom();
      set("ui.rightOpen", true);
      lastFocus = document.activeElement;
      requestAnimationFrame(function () {
        layer.classList.add("ov-open");
        if (window.matchMedia && window.matchMedia("(max-width:760px)").matches) panel.style.width = "100%";
      });
    },
    close: function () {
      if (!layer) return;
      if (A.picker && typeof A.picker.close === "function") { try { A.picker.close(); } catch (e) {} }
      layer.classList.remove("ov-open");
      cur = null; frame = null;
      set("ui.rightOpen", false);
      try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (e) {}
    },
    toggle: function (art) {
      if (layer && layer.classList.contains("ov-open")) API.close();
      else API.open(art || cur);
    },
    isOpen: function () { return !!(layer && layer.classList.contains("ov-open")); },
    current: function () { return cur; }
  };
  A.preview = API;

  on("artifact:open", function (p) { if (p) API.open(p.artifact || p); });
  on("preview:open", function (p) { if (p) API.open(p.artifact || p); });
  on("preview:close", function () { API.close(); });
})();
