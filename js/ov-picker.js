/* AYCHO module: js/ov-picker | owner: C | contract: v1 */
/* 元素选择：点击选中 / 矩形框选 / 自由圈选；对外暴露 AYCHO.picker={open,close,sync,setMode}
   选中后触发自定义事件：AYCHO.bus.emit('ctx:pick', {selector, html, rect})，由 A 塞进输入框。
   Esc 退出并清理所有描边、标签与监听。 */
(function () {
  "use strict";
  var A = window.AYCHO = window.AYCHO || {};

  function BUS() { return A.bus || { on: function () {}, emit: function () {} }; }
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
  function copy(text) {
    if (A.util && typeof A.util.copy === "function") {
      try { var r = A.util.copy(text); if (r && typeof r.then === "function") return r; return Promise.resolve(true); } catch (e) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy");
        document.body.removeChild(ta); res(true);
      } catch (e) { rej(e); }
    });
  }

  /* 覆盖层注入到被选页面（iframe 内无站点 token），色值需自包含；优先读取宿主 token，缺失再兜底 */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = (v || "").trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }
  var ACCENT = cssVar("--ax-accent", "#7c9cff");   /* 实色：SVG 描边 / 色相基准 */
  var ACCENT_LINE = "rgba(124,156,255,.85)";       /* 半透明描边：轮廓用半透明描边（skills 规范） */
  var HL = "rgba(124,156,255,.14)";                /* 高亮填充：半透明 */
  var RING = "0 0 0 1px rgba(255,255,255,.06), 0 10px 28px rgba(0,0,0,.55)";  /* 分层阴影 */

  var layer = null, host_ = null, shadow = null, bar = null, tip = null, result = null;
  var source = null, mode = "click", doc = null, alive = false;
  var highlighted = [], marquee = null, lassoSvg = null, lassoPath = null;
  var pts = [], drawing = false, justDrew = 0, curSel = null;
  var lastFrame = null, ro = null, listenersBound = false;

  /* ---------- 高亮工具 ---------- */
  function mark(el) {
    if (!el || el.nodeType !== 1) return false;
    for (var i = 0; i < highlighted.length; i++) if (highlighted[i].el === el) return false;
    var prev = {
      outline: el.style.getPropertyValue("outline"),
      outlineOffset: el.style.getPropertyValue("outline-offset"),
      bg: el.style.getPropertyValue("background-color"),
      bgPrio: el.style.getPropertyPriority("background-color")
    };
    try {
      el.style.setProperty("outline", "2px solid " + ACCENT_LINE, "important");
      el.style.setProperty("box-shadow", RING, "important");
      el.style.setProperty("outline-offset", "0px", "important");
      el.style.setProperty("background-color", HL, "important");
    } catch (e) {}
    highlighted.push({ el: el, prev: prev });
    return true;
  }
  function clearMarks() {
    for (var i = 0; i < highlighted.length; i++) {
      var it = highlighted[i], s = it.el.style;
      try {
        if (it.prev.outline) s.setProperty("outline", it.prev.outline); else s.removeProperty("outline");
        if (it.prev.outlineOffset) s.setProperty("outline-offset", it.prev.outlineOffset); else s.removeProperty("outline-offset");
        if (it.prev.bg) s.setProperty("background-color", it.prev.bg, it.prev.bgPrio || ""); else s.removeProperty("background-color");
      } catch (e) {}
    }
    highlighted = [];
  }
  function isOurs(el) {
    if (!el || el.nodeType !== 1) return true;
    var c = String(el.getAttribute("class") || "");
    return c.indexOf("ax-pick-") >= 0;
  }
  function pathOf(el) {
    var parts = [], node = el, guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      var tag = node.tagName.toLowerCase();
      if (tag === "html") break;
      if (tag === "body") { parts.unshift("body"); break; }
      var seg = tag;
      var cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(function (c) { return c && c.indexOf("ax-pick-") !== 0; });
      if (cls.length) seg += "." + cls[0];
      var p = node.parentNode;
      if (p && p.children) {
        var sibs = [], k;
        for (k = 0; k < p.children.length; k++) if (p.children[k].tagName === node.tagName) sibs.push(p.children[k]);
        if (sibs.length > 1) seg += ":nth-child(" + (Array.prototype.indexOf.call(p.children, node) + 1) + ")";
      }
      parts.unshift(seg);
      node = p;
    }
    return parts.join(" > ") || "body";
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  /* ---------- 浮层构建 ---------- */
  function build() {
    if (layer) return;
    var host = document.getElementById("ax-overlay-host") || document.body;
    layer = h("div", { class: "ov-layer" });
    layer.setAttribute("data-ov", "picker");
    layer.style.pointerEvents = "none";
    layer.style.zIndex = "900";

    host_ = h("div", { class: "ov-grow" });
    /* 层本体 pointer-events:none 不挡页面，但影子文档必须可交互，否则无法点选 */
    host_.style.cssText = "position:absolute;overflow:hidden;pointer-events:auto;";

    tip = h("span", { class: "ov-picker-tip", text: "点击页面元素即可选中" });
    var seg = h("div", { class: "ov-seg" });
    var btns = {};
    [["click", "点击选中"], ["rect", "矩形框选"], ["lasso", "自由圈选"]].forEach(function (o) {
      var b = h("button", { class: "ov-seg-btn" + (mode === o[0] ? " ov-on" : ""), type: "button" }, txt(o[1]));
      b.addEventListener("click", function () { setMode(o[0]); });
      btns[o[0]] = b;
      seg.appendChild(b);
    });
    layer.appendChild(h("div", { class: "ov-grow" }));
    bar = h("div", { class: "ov-picker-bar" }, seg, tip,
      h("button", { class: "ov-btn ov-danger", type: "button", onclick: function () { close(); } }, txt("退出")));
    bar.style.pointerEvents = "auto";

    result = h("div", { class: "ov-result", role: "dialog", "aria-label": "选中元素信息" });
    result.style.pointerEvents = "auto";

    layer.appendChild(host_);
    layer.appendChild(bar);
    layer.appendChild(result);
    host.appendChild(layer);
    if (!listenersBound) {
      listenersBound = true;
      document.addEventListener("keydown", onKey, true);
      window.addEventListener("resize", sync);
      window.addEventListener("scroll", sync, true);
    }
  }

  function setMode(m) {
    mode = m;
    var b = bar.querySelectorAll(".ov-seg-btn");
    var order = ["click", "rect", "lasso"];
    for (var i = 0; i < b.length; i++) b[i].classList.toggle("ov-on", order[i] === m);
    tip.textContent = m === "click" ? "点击页面元素即可选中" : (m === "rect" ? "按住拖拽画矩形，松开后选中相交元素" : "按住随意画圈，松开后选中圈内元素");
    removeMarquee();
  }

  /* ---------- 影子文档（保证可注入：srcdoc 的 allow-same-origin 由本模块自持） ---------- */
  function mountDoc(html) {
    if (!host_.firstChild) {
      shadow = h("iframe", { class: "ov-frame", sandbox: "allow-same-origin allow-scripts", title: "元素选择预览" });
      shadow.style.cssText = "width:100%;height:100%;border:0;display:block;background:#fff;";
      shadow.setAttribute("srcdoc", html || "<!doctype html><html><body></body></html>");
      host_.appendChild(shadow);
      shadow.addEventListener("load", bindDoc);
    } else if (shadow) {
      shadow.setAttribute("srcdoc", html || "");
    }
    if (shadow && shadow.contentDocument && shadow.contentDocument.readyState === "complete") bindDoc();
  }

  function bindDoc() {
    try { doc = shadow.contentDocument; } catch (e) { doc = null; }
    if (!doc) { toast("无法进入预览文档，元素选择不可用", "error"); return; }
    alive = true;
    var st = doc.createElement("style");
    st.className = "ax-pick-style";
    st.textContent = ".ax-pick-label{position:fixed;z-index:2147483646;padding:3px 7px;border-radius:6px;background:rgba(6,7,11,.92);color:#cddaff;backdrop-filter:blur(6px);" +
      "font:500 11px/1.5 ui-monospace,monospace;border:1px solid rgba(124,156,255,.4);box-shadow:0 8px 24px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);pointer-events:none;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;}" +
      ".ax-pick-marquee{position:fixed;z-index:2147483645;border:1px dashed rgba(124,156,255,.75);background:rgba(124,156,255,.12);box-shadow:0 6px 20px rgba(124,156,255,.12);pointer-events:none;}" +
      ".ax-pick-lasso{position:fixed;inset:0;z-index:2147483645;pointer-events:none;}";
    try { doc.head.appendChild(st); } catch (e) { try { doc.documentElement.appendChild(st); } catch (e2) {} }
    /* iframe 内聚焦后，父页面的 Esc 监听收不到事件，需在影子文档内单独处理 */
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopPropagation();
      close();
    }, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("mousedown", onDown, true);
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
    doc.addEventListener("mouseover", onOver, true);
  }

  function labelFor(el) {
    var lab = doc.querySelector(".ax-pick-label");
    if (!lab) { lab = doc.createElement("div"); lab.className = "ax-pick-label"; doc.body.appendChild(lab); }
    lab.textContent = pathOf(el);
    var r = el.getBoundingClientRect();
    lab.style.left = Math.max(2, Math.round(r.left)) + "px";
    lab.style.top = Math.max(2, Math.round(r.top) - 22) + "px";
    return lab;
  }
  function hideLabel() {
    var lab = doc && doc.querySelector(".ax-pick-label");
    if (lab && lab.parentNode) lab.parentNode.removeChild(lab);
  }
  function removeMarquee() {
    if (marquee && marquee.parentNode) marquee.parentNode.removeChild(marquee);
    marquee = null;
    if (lassoSvg && lassoSvg.parentNode) lassoSvg.parentNode.removeChild(lassoSvg);
    lassoSvg = null; lassoPath = null; pts = [];
  }

  /* ---------- 模式一：点击选中 ---------- */
  function onOver(e) {
    if (mode !== "click" || drawing) return;
    var t = e.target;
    if (isOurs(t) || !t || t.nodeType !== 1 || t === doc.body || t === doc.documentElement) { hideLabel(); return; }
    labelFor(t);
  }
  function onClick(e) {
    if (justDrew && Date.now() - justDrew < 300) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }
    if (mode !== "click") { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var t = e.target;
    if (!t || isOurs(t) || t === doc.body || t === doc.documentElement) return;
    clearMarks();
    mark(t);
    showResult([t], t);
  }

  /* ---------- 模式二：矩形框选 / 自由圈选 ---------- */
  function onDown(e) {
    if (mode === "click" || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    drawing = true;
    clearMarks();
    hideResult();
    if (mode === "rect") {
      marquee = doc.createElement("div");
      marquee.className = "ax-pick-marquee";
      marquee.style.left = e.clientX + "px";
      marquee.style.top = e.clientY + "px";
      marquee.style.width = "0px";
      marquee.style.height = "0px";
      doc.body.appendChild(marquee);
      pts = [{ x: e.clientX, y: e.clientY }];
    } else {
      lassoSvg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      lassoSvg.setAttribute("class", "ax-pick-lasso");
      lassoPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      lassoPath.setAttribute("fill", "rgba(124,156,255,.12)");
      lassoPath.setAttribute("stroke", ACCENT);
      lassoPath.setAttribute("stroke-width", "1.5");
      lassoPath.setAttribute("stroke-dasharray", "4 3");
      lassoSvg.appendChild(lassoPath);
      doc.body.appendChild(lassoSvg);
      pts = [{ x: e.clientX, y: e.clientY }];
    }
  }
  function onMove(e) {
    if (!drawing) return;
    e.preventDefault();
    if (mode === "rect" && marquee) {
      var x0 = pts[0].x, y0 = pts[0].y;
      marquee.style.left = Math.min(x0, e.clientX) + "px";
      marquee.style.top = Math.min(y0, e.clientY) + "px";
      marquee.style.width = Math.abs(e.clientX - x0) + "px";
      marquee.style.height = Math.abs(e.clientY - y0) + "px";
      pts[1] = { x: e.clientX, y: e.clientY };
    } else if (mode === "lasso" && lassoPath) {
      pts.push({ x: e.clientX, y: e.clientY });
      var d = "M" + pts.map(function (p) { return p.x + " " + p.y; }).join(" L");
      lassoPath.setAttribute("d", d);
    }
  }
  function onUp(e) {
    if (!drawing) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    drawing = false;
    justDrew = Date.now();
    var found = [];
    if (mode === "rect" && marquee) {
      var r = marquee.getBoundingClientRect();
      found = sample(r, null);
      removeMarquee();
    } else if (mode === "lasso") {
      found = sampleBBox(pts);
      removeMarquee();
    }
    if (!found.length) { toast("没有选中任何元素，请再试一次", "info"); return; }
    var order = found.slice().sort(function (a, b) {
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    var primary = order[0];
    clearMarks();
    for (var i = 0; i < found.length; i++) mark(found[i]);
    showResult(found, primary);
  }

  function sample(rect, poly) {
    var seen = [], step = 12, x, y, list, i, j;
    var w = rect.width, h = rect.height;
    if (w < 2 || h < 2) return seen;
    for (x = rect.left + 2; x <= rect.right - 2; x += step) {
      for (y = rect.top + 2; y <= rect.bottom - 2; y += step) {
        if (poly && !inPoly(x, y, poly)) continue;
        list = doc.elementsFromPoint(x, y) || [];
        for (i = 0; i < list.length; i++) {
          var el = list[i];
          if (isOurs(el) || el === doc.body || el === doc.documentElement) continue;
          var r2 = el.getBoundingClientRect();
          if (r2.width * r2.height > (doc.documentElement.clientWidth * doc.documentElement.clientHeight) * 0.92) continue;
          for (j = 0; j < seen.length; j++) if (seen[j] === el) break;
          if (j === seen.length) seen.push(el);
          break;
        }
      }
    }
    return seen.slice(0, 30);
  }
  function sampleBBox(poly) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, i;
    for (i = 0; i < poly.length; i++) {
      minX = Math.min(minX, poly[i].x); minY = Math.min(minY, poly[i].y);
      maxX = Math.max(maxX, poly[i].x); maxY = Math.max(maxY, poly[i].y);
    }
    return sample({ left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY }, poly);
  }
  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ---------- 结果卡片 ---------- */
  function row(k, v, mono) {
    return h("div", { class: "ov-result-row" },
      h("div", { class: "ov-result-k", text: k }),
      h("div", { class: "ov-result-v", text: v }));
  }
  function hideResult() { if (result) result.classList.remove("ov-open"); }

  /* 高亮用的是内联样式，导出 HTML 片段前先把本工具注入的描边/底色摘掉，
     保证用户复制到的是「原始标记」而不是带调试样式的副本 */
  var HLTXT = null, HLTXT_BG = null;
  function hlSerialized() {
    if (HLTXT) return HLTXT;
    try {
      var probe = document.createElement("div");
      probe.style.setProperty("outline", "2px solid " + ACCENT_LINE, "important");
      probe.style.setProperty("box-shadow", RING, "important");
      probe.style.setProperty("background-color", HL, "important");
      HLTXT = probe.style.getPropertyValue("outline");
      HLTXT_BG = probe.style.getPropertyValue("background-color");
    } catch (e) { HLTXT = "2px solid"; HLTXT_BG = ""; }
    return HLTXT;
  }
  function cleanSnippet(node) {
    var clone;
    try { clone = node.cloneNode(true); } catch (e) { return String(node.outerHTML || ""); }
    var mark = hlSerialized();
    var all = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (!n.style || !n.style.getPropertyValue) continue;
      var o = n.style.getPropertyValue("outline");
      if (o && (o.indexOf(mark) === 0 || o.indexOf("2px solid ") === 0)) n.style.removeProperty("outline");
      if (n.style.getPropertyValue("outline-offset") === "0px") n.style.removeProperty("outline-offset");
      var bg = n.style.getPropertyValue("background-color");
      if (bg && (bg === HLTXT_BG || (HLTXT_BG && bg.indexOf(HLTXT_BG) === 0))) n.style.removeProperty("background-color");
      if (!n.getAttribute("style")) n.removeAttribute("style");
    }
    return String(clone.outerHTML || "");
  }

  function showResult(list, primary) {
    if (!primary) return;
    var sel = pathOf(primary);
    /* 复制用完整干净标记；展示用 500 字截断，避免卡片被超长 HTML 撑爆 */
    var fullHtml = cleanSnippet(primary).replace(/\s+/g, " ").trim();
    var html = fullHtml.length > 500 ? fullHtml.slice(0, 500) + "…" : fullHtml;
    var r = rectOf(primary);
    curSel = { selector: sel, html: html, rect: r };

    while (result.firstChild) result.removeChild(result.firstChild);
    result.appendChild(h("div", { class: "ov-result-row" },
      h("strong", { class: "ov-result-k", text: "已选中 " + (list.length > 1 ? list.length + " 个元素（主元素）" : "1 个元素") })));
    result.appendChild(row("选择器路径", sel));
    result.appendChild(row("HTML 片段", html));
    result.appendChild(row("尺寸", r.w + " × " + r.h + " px  ·  位置 " + r.x + ", " + r.y));

    var acts = h("div", { class: "ov-result-acts" });
    function act(label, fn, cls) {
      var b = h("button", { class: "ov-btn" + (cls ? " " + cls : ""), type: "button" }, txt(label));
      b.addEventListener("click", fn);
      return b;
    }
    acts.appendChild(act("复制选择器", function () {
      copy(sel).then(function () { toast("选择器已复制", "ok"); }).catch(function () { toast("复制失败", "error"); });
    }, "ov-primary"));
    acts.appendChild(act("复制 HTML", function () {
      copy(fullHtml).then(function () { toast("HTML 已复制", "ok"); }).catch(function () { toast("复制失败", "error"); });
    }));
    acts.appendChild(act("引用到输入框", function () {
      emit("ctx:pick", curSel);
      toast("已引用到输入框", "ok");
    }));
    acts.appendChild(act("清除选中", function () { clearMarks(); hideResult(); }));
    result.appendChild(acts);
    requestAnimationFrame(function () { if (result) result.classList.add("ov-open"); });
  }

  /* ---------- 定位 ---------- */
  function targetRect() {
    var f = lastFrame;
    if (f && f.getBoundingClientRect) {
      var r = f.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) return r;
    }
    var panel = document.querySelector(".ov-panel .ov-body, .ov-panel");
    if (panel && panel.getBoundingClientRect) {
      var p = panel.getBoundingClientRect();
      if (p.width > 8 && p.height > 8) return p;
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(720, vw - 32), hh = Math.min(520, vh - 120);
    return { left: Math.round((vw - w) / 2), top: Math.round((vh - hh) / 2), width: Math.round(w), height: Math.round(hh) };
  }

  function sync() {
    if (!layer || !layer.classList.contains("ov-open")) return;
    var r = targetRect();
    host_.style.left = Math.round(r.left) + "px";
    host_.style.top = Math.round(r.top) + "px";
    host_.style.width = Math.round(r.width) + "px";
    host_.style.height = Math.round(r.height) + "px";
  }

  function onKey(e) {
    if (e.key !== "Escape") return;
    if (!layer || !layer.classList.contains("ov-open")) return;
    e.stopPropagation(); e.preventDefault();
    close();
  }

  function close() {
    if (!layer) return;
    alive = false;
    clearMarks();
    hideLabel();
    removeMarquee();
    hideResult();
    curSel = null;
    layer.classList.remove("ov-open");
    if (shadow && shadow.parentNode) shadow.parentNode.removeChild(shadow);
    shadow = null; doc = null;
    if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
    /* 彻底摘除浮层节点，避免隐藏层长期驻留 DOM；下次 open() 由 build() 重建 */
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null; host_ = null; bar = null; tip = null; result = null;
  }

  var API = {
    open: function (opts) {
      opts = opts || {};
      build();
      lastFrame = opts.frame || null;
      if (!opts.html) { toast("没有可选择的预览内容", "error"); return; }
      layer.classList.add("ov-open");
      sync();
      mountDoc(opts.html || "");
      tip.textContent = mode === "click" ? "点击页面元素即可选中" : (mode === "rect" ? "按住拖拽画矩形，松开后选中相交元素" : "按住随意画圈，松开后选中圈内元素");
      if (!alive) setTimeout(function () { if (layer && layer.classList.contains("ov-open") && !alive) bindDoc(); }, 120);
    },
    close: close,
    sync: sync,
    setMode: setMode,
    isOpen: function () { return !!(layer && layer.classList.contains("ov-open")); },
    current: function () { return curSel; }
  };
  A.picker = API;
})();
