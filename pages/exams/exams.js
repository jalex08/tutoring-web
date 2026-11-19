/*!
 * Jose Diaz Tutoring — exam calendar engine (exams.js)
 * Renders the interactive parts of /exams/ and the exam guides from the
 * school-year JSON embedded in the page as <script id="exam-data" type="application/json">.
 *
 * The static HTML that build.js writes stays in place for crawlers and no-JS
 * visitors; this script replaces the contents of the containers it finds:
 *   Calendar page:   #audChips #audPanel (grade picker) · #yearsvg (year graph)
 *                    #chips #audNote #ledger (coming up)
 *   Exam guide page: <body data-exam="alg1"> · #examStatus · [data-nextwin]
 *                    #winList · #heroRuler · #chkForm/#chkTest/#chkScore/#chkResult/#chkNote
 *                    #waffle · #brkList · #examLinks · #srcList · #claudeBtn
 *   Both:            [data-checked]
 *
 * The server (exam-calendar.js) renders the same containers first, so the page works without
 * JavaScript; #srcList is server-only.
 * Language comes from <html lang>. Test a different "today" with ?debug=1&today=YYYY-MM-DD.
 * Analytics: one dataLayer event, select_content, with these content_type values:
 *   exam_grade · exam_filter · exam_calendar_add · exam_resource · score_check · summarize_claude
 * No scores or other personal data are ever pushed.
 */
(function () {
  "use strict";
  var dataEl = document.getElementById("exam-data");
  if (!dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var q = new URLSearchParams(location.search);
  var LANG = /^es/i.test(document.documentElement.lang) ? "es" : "en";
  var SITE = location.origin;
  var HUB = LANG === "es" ? "/es/examenes/" : "/exams/";
  var S = { filter: "all", expanded: false, aud: "all", today: null };

  var now = new Date();
  S.today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (q.get("debug") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(q.get("today") || "")) S.today = P(q.get("today"));

  // EN + ES strings: STRINGS in exam-calendar.js, written here by scripts/build.js (one copy for server and browser).
  var L = __EXAM_STRINGS__;
  function t(k, v) { var s = L[LANG][k]; if (v) for (var x in v) s = s.split("{" + x + "}").join(v[x]); return s; }
  function nm(o) { return o ? (o[LANG] || o.en) : ""; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function track(type, id) { (window.dataLayer = window.dataLayer || []).push({ event: "select_content", content_type: type, content_id: String(id), page_language: LANG }); }
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- dates ---------- */
  function P(s) { var a = s.split("-"); return new Date(+a[0], a[1] - 1, +a[2]); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function diff(a, b) { return Math.round((a - b) / 864e5); }
  var LOC = LANG === "es" ? "es-US" : "en-US";
  function clean(s) { return s.replace(/\./g, ""); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function mon(d) { return cap(clean(new Intl.DateTimeFormat(LOC, { month: "short" }).format(d))); }
  function dow(d) { return cap(clean(new Intl.DateTimeFormat(LOC, { weekday: "short" }).format(d))); }
  function md(d) { return LANG === "es" ? d.getDate() + " " + mon(d).toLowerCase() : mon(d) + " " + d.getDate(); }
  function mdy(d) { return LANG === "es" ? d.getDate() + " de " + clean(new Intl.DateTimeFormat("es-US", { month: "long" }).format(d)) + " de " + d.getFullYear() : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d); }
  function range(ev) { var a = P(ev.start); return ev.end ? md(a) + " – " + md(P(ev.end)) : md(a); }
  function rel(n) { if (n === 0) return t("today"); if (n === 1) return t("tomorrow"); if (n <= 45) return t("inDays", { n: n }); if (n <= 120) return t("inWeeks", { n: Math.round(n / 7) }); return t("inMonths", { n: Math.round(n / 30.4) }); }
  function status(ev) {
    var a = P(ev.start), b = ev.end ? P(ev.end) : a, td = S.today;
    if (td > b) return { state: "past" };
    if (td >= a && ev.end) { var left = diff(b, td); return { state: "open", text: left === 0 ? t("openLast") : t("open", { n: left + 1 }) }; }
    var n = diff(a, td);
    return { state: "upcoming", n: n, text: ev.end ? t("opens", { x: rel(n) }) : rel(n) };
  }
  function examOf(id) { for (var i = 0; i < D.exams.length; i++) if (D.exams[i].id === id) return D.exams[i]; }
  function evById(id) { for (var i = 0; i < D.events.length; i++) if (D.events[i].id === id) return D.events[i]; }
  function laneOf(ev) { return examOf(ev.exam).lane; }
  function upcoming() { return D.events.filter(function (e) { return status(e).state !== "past"; }).sort(function (x, y) { return P(x.start) - P(y.start) || P(x.end || x.start) - P(y.end || y.start); }); }
  function nextFor(id) { return upcoming().filter(function (e) { return (e.exam === id || (e.also || []).indexOf(id) > -1) && e.type !== "reg" && e.type !== "late"; })[0]; }
  function guideURL(x) { return x && x.pageLive ? (LANG === "es" ? x.pageEs : x.page) : null; }
  function nextYear() { return D.nextYear ? D.nextYear.label : ""; }

  /* ---------- grade picker ---------- */
  function audById(id) { return (D.audiences || []).filter(function (a) { return a.id === id; })[0]; }
  function audExams() { var a = audById(S.aud); return a ? a.items.map(function (i) { return i.exam; }) : null; }
  function inAud(e, ax) { return !ax || ax.indexOf(e.exam) > -1 || (e.also || []).some(function (z) { return ax.indexOf(z) > -1; }); }
  var ICON_DO = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="none" stroke="#1C4C9E" stroke-width="1.6"/><path d="M5.3 9.2l2.4 2.4 5-5.2" fill="none" stroke="#1C4C9E" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_CAL = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_WARN = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.7H1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".9" fill="currentColor"/></svg>';

  function resHTML(examId, max) {
    var x = examOf(examId); if (!x || !x.resources) return "";
    var list = x.resources.slice(0, max || 9).map(function (k) {
      var r = D.resources[k];
      return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-res="' + k + '"><span class="badge' + (r.official ? "" : " free") + '">' + esc(r.official ? t("official") : t("freeB")) + '</span><span><span class="rl">' + esc(nm(r.label)) + '</span><span class="by">' + esc(r.by) + '</span></span><span class="ext" aria-hidden="true">↗</span></a></li>';
    }).join("");
    return '<div class="res"><p class="res-h">' + esc(t("freeHelp")) + "</p><ul>" + list + "</ul></div>";
  }
  function whenHTML(examId) {
    var n = nextFor(examId);
    if (!n) return '<p class="aud-when muted">' + esc(t("noNext")) + "</p>";
    return '<p class="aud-when"><b>' + esc(t("nextDate")) + ":</b> " + esc(range(n)) + '<span class="hand">' + esc(status(n).text) + "</span></p>";
  }
  function linksHTML(examId, src) {
    var g = guideURL(examOf(examId)), out = [];
    if (g) out.push('<a href="' + g + '">' + esc(t("guideLink")) + "</a>");
    out.push('<a href="#next">' + esc(t("datesLink")) + "</a>");
    if (src) out.push('<a href="' + esc(D.sources[src].url) + '" target="_blank" rel="noopener">' + esc(t("source")) + "</a>");
    return '<p class="aud-links">' + out.join("") + "</p>";
  }
  function renderFinder(swap) {
    var box = $("audChips"), panel = $("audPanel"); if (!box || !panel) return;
    box.innerHTML = "";
    var opts = (D.audiences || []).map(function (a) { return { id: a.id, label: nm(a.label) }; }).concat([{ id: "all", label: t("allExams") }]);
    opts.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", S.aud === o.id ? "true" : "false");
      b.textContent = o.label;
      b.onclick = function () { S.aud = o.id; S.expanded = false; renderFinder(true); renderLedger(); drawYear(false); syncURL(); track("exam_grade", o.id); };
      box.appendChild(b);
    });
    var sel = box.querySelector('[aria-selected="true"]');
    if (sel && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, sel.offsetLeft - box.offsetLeft - 40);
    var a = audById(S.aud), html = "";
    if (!a) {
      html = '<p class="aud-intro">' + esc(t("allIntro")) + '</p><ul class="aud-list allgrid">';
      D.exams.forEach(function (x) {
        var lane = D.lanes.filter(function (l) { return l.id === x.lane; })[0], g = guideURL(x);
        html += '<li class="aud-item"><span class="lane-name">' + esc(nm(lane)) + "</span><h3>" + esc(nm(x.name)) + '</h3><p class="aud-why">' + esc(nm(x.stakes)) + "</p>" + whenHTML(x.id) + resHTML(x.id, 2) +
          (g ? '<p class="aud-links"><a href="' + g + '">' + esc(t("guideLink")) + "</a></p>" : "") + "</li>";
      });
      html += "</ul>";
    } else {
      html = '<p class="aud-intro">' + esc(nm(a.intro)) + '</p><ol class="aud-list">';
      a.items.forEach(function (it, i) {
        var x = examOf(it.exam), title = it.title ? nm(it.title) : nm(x.name);
        html += '<li class="aud-item"><div><h3>' + esc(title) + (i === 0 ? '<span class="start">' + esc(t("startHere")) + "</span>" : "") + "</h3>" + whenHTML(it.exam) + "</div>" +
          '<div><p class="aud-why">' + esc(nm(it.why)) + '</p><p class="aud-do">' + ICON_DO + '<span><span class="sr">' + esc(t("whatNow")) + ": </span>" + esc(nm(it.todo)) + "</span></p>" +
          linksHTML(it.exam, it.src) + resHTML(it.exam) + "</div></li>";
      });
      html += "</ol>";
      var u = SITE + HUB + "?for=" + a.id;
      html += '<div class="aud-foot"><span class="muted">' + esc(t("footFor")) + '</span><a href="https://wa.me/?text=' + encodeURIComponent(t("shareText", { g: nm(a.label), u: u })) + '" target="_blank" rel="noopener" data-share="' + a.id + '">' + esc(t("share")) + "</a></div>";
    }
    panel.innerHTML = html;
    if (swap && !RM) { panel.classList.remove("swap"); void panel.offsetWidth; panel.classList.add("swap"); }
  }
  function syncURL() { try { var u = new URL(location.href); if (S.aud === "all") u.searchParams.delete("for"); else u.searchParams.set("for", S.aud); history.replaceState(null, "", u); } catch (e) {} }

  /* ---------- year graph ---------- */
  var G, Y0 = P(D.range.start), YE = P(D.range.end), R0, R1, SPAN;
  function gx(d) { return G.x0 + (G.x1 - G.x0) * diff(d, R0) / SPAN; }
  function el(n, a, txt) { var e = document.createElementNS("http://www.w3.org/2000/svg", n); for (var k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; return e; }
  function drawYear(animate) {
    var svg = $("yearsvg"); if (!svg) return;
    var compact = svg.parentNode.getBoundingClientRect().width < 640;
    G = compact ? { W: 340, H: 350, x0: 6, x1: 334, top: 84, bottom: 322, lanes: { state: 128, satact: 186, ap: 244, college: 300 }, labelAbove: true, fs: 13 }
                : { W: 1040, H: 330, x0: 176, x1: 1020, top: 80, bottom: 304, lanes: { state: 116, satact: 170, ap: 224, college: 278 }, labelAbove: false, fs: 13 };
    svg.setAttribute("viewBox", "0 0 " + G.W + " " + G.H);
    if (compact) {
      var len = 165, st = new Date(S.today.getTime() - 10 * 864e5);
      if (st < Y0) st = Y0;
      if (diff(YE, st) < len) st = new Date(YE.getTime() - len * 864e5);
      R0 = st; R1 = new Date(st.getTime() + len * 864e5);
    } else { R0 = Y0; R1 = YE; }
    SPAN = diff(R1, R0) + 1;
    var title = svg.querySelector("title");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (title) svg.appendChild(title);
    svg.classList.toggle("drawn", !!animate && !RM);
    var defs = el("defs", {}), cp = el("clipPath", { id: "plotclip" });
    cp.appendChild(el("rect", { x: G.x0, y: 0, width: G.x1 - G.x0, height: G.H })); defs.appendChild(cp); svg.appendChild(defs);
    var g = el("g", { "font-family": "Atkinson Hyperlegible, sans-serif" }); svg.appendChild(g);
    for (var m = 0; m < 14; m++) {
      var d = new Date(R0.getFullYear(), R0.getMonth() + m, 1), x = gx(d);
      if (d < R0) continue; if (d > R1) break;
      g.appendChild(el("line", { x1: x, y1: G.top - 6, x2: x, y2: G.bottom, stroke: "#C7DDBE", "stroke-width": 1 }));
      var lab = mon(d) + (d.getMonth() === 0 || d.getMonth() === 7 ? " " + d.getFullYear() : "");
      if (x + 5 < G.x1 - 24) g.appendChild(el("text", { x: x + 5, y: G.top - 14, "font-size": G.fs, fill: "#55605E", "font-weight": 700 }, lab));
    }
    g.appendChild(el("line", { x1: G.x0, y1: G.top - 6, x2: G.x0, y2: G.bottom, stroke: "#C7DDBE" }));
    g.appendChild(el("line", { x1: G.x1, y1: G.top - 6, x2: G.x1, y2: G.bottom, stroke: "#C7DDBE" }));
    var shown = 0;
    (D.annotations || []).forEach(function (a) {
      var ad = P(a.date); if (ad < R0 || ad > R1) return; if (compact && shown++) return;
      var ax = gx(ad), anchor = ax > G.x1 - 120 ? "end" : (ax < G.x0 + 120 ? "start" : "middle");
      g.appendChild(el("text", { x: ax, y: G.top - 38, "text-anchor": anchor, "font-family": "Kalam, cursive", "font-size": compact ? 15 : 17, "font-weight": 700, fill: "#1C4C9E" }, nm(a)));
      g.appendChild(el("path", { d: "M" + ax + " " + (G.top - 32) + " q 3 8 0 14", fill: "none", stroke: "#1C4C9E", "stroke-width": 1.6, "stroke-linecap": "round" }));
    });
    var lbl = el("g", {});
    D.lanes.forEach(function (ln, i) {
      var y = G.lanes[ln.id];
      if (i > 0) g.appendChild(el("line", { x1: G.labelAbove ? G.x0 : 16, y1: y - 28, x2: G.x1, y2: y - 28, stroke: "#E4EAE7" }));
      if (G.labelAbove) lbl.appendChild(el("text", { x: G.x0 + 4, y: y - 12, "font-size": 13.5, "font-weight": 700, fill: "#232A2A", stroke: "#fff", "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round" }, nm(ln)));
      else g.appendChild(el("text", { x: 16, y: y + 5, "font-size": 14, "font-weight": 700, fill: "#232A2A" }, nm(ln)));
    });
    var ax2 = audExams(), rows = {};
    var evs = D.events.filter(function (e) { return e.type !== "reg" && e.type !== "late"; });
    var bars = evs.filter(function (e) { return e.end; }).sort(function (a, b) { return P(a.start) - P(b.start); });
    bars.forEach(function (e) {
      var ln = laneOf(e); rows[ln] = rows[ln] || [];
      var r = rows[ln], s = P(e.start), placed = false;
      for (var i = 0; i < r.length; i++) if (r[i] < s) { r[i] = P(e.end); e._row = i; placed = true; break; }
      if (!placed) { r.push(P(e.end)); e._row = r.length - 1; }
    });
    var marks = el("g", { "clip-path": "url(#plotclip)" }); g.appendChild(marks);
    bars.forEach(function (e) {
      var ln = laneOf(e), n = rows[ln].length, h = n > 2 ? 7 : (n === 2 ? 10 : 14), gap = 3;
      var tot = n * h + (n - 1) * gap, y = G.lanes[ln] - tot / 2 + e._row * (h + gap);
      var x = gx(P(e.start)), w = Math.max(gx(new Date(P(e.end).getTime() + 864e5)) - x, 5);
      var soft = /schoolday/.test(e.id);
      var r = el("rect", { x: x, y: y, width: w, height: h, rx: h / 2, fill: soft ? "rgba(28,76,158,.28)" : "#1C4C9E", opacity: inAud(e, ax2) ? 1 : 0.16, "class": "mk mk-bar", tabindex: 0, role: "button", "data-ev": e.id, style: "--d:" + Math.round((x - G.x0) * 1.1) });
      r.appendChild(el("title", {}, nm(e.label) + " · " + range(e))); marks.appendChild(r);
    });
    evs.filter(function (e) { return !e.end; }).forEach(function (e) {
      if (P(e.start) < R0 || P(e.start) > R1) return;
      var x = gx(P(e.start)), y = G.lanes[laneOf(e)], hollow = e.exam === "act";
      var c = el("circle", { cx: x, cy: y, r: 6.5, fill: hollow ? "#fff" : "#1C4C9E", stroke: "#1C4C9E", "stroke-width": hollow ? 2.5 : 1.5, opacity: inAud(e, ax2) ? 1 : 0.16, "class": "mk mk-dot", tabindex: 0, role: "button", "data-ev": e.id, style: "--d:" + Math.round((x - G.x0) * 1.1) });
      c.appendChild(el("title", {}, nm(e.label) + " · " + range(e))); marks.appendChild(c);
    });
    var td = S.today;
    if (td >= R0) {
      var tx = Math.min(gx(td), G.x1);
      g.appendChild(el("rect", { x: G.x0, y: G.top - 6, width: tx - G.x0, height: G.bottom - G.top + 6, fill: "#FBFCFA", "fill-opacity": 0.68, "pointer-events": "none" }));
      if (td <= R1) {
        g.appendChild(el("line", { x1: tx, y1: G.top - 4, x2: tx, y2: G.bottom, stroke: "#232A2A", "stroke-width": 2, "class": "today-line" }));
        var tg = el("g", { "class": "today-tag" });
        tg.appendChild(el("text", { x: tx, y: G.bottom + 12, "text-anchor": "middle", "font-family": "Kalam, cursive", "font-size": 17, "font-weight": 700, fill: "#232A2A" }, t("today")));
        g.appendChild(tg);
      }
    }
    g.appendChild(lbl);
    if (!compact) g.appendChild(el("text", { x: G.x1, y: G.bottom + 12, "text-anchor": "end", "font-size": 11.5, fill: "#55605E" }, t("act")));
    marks.addEventListener("click", onMark);
    marks.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMark(e); } });
  }
  function onMark(e) {
    var id = e.target.getAttribute("data-ev"); if (!id) return;
    var ev = evById(id); if (status(ev).state === "past") return;
    S.filter = "all"; S.expanded = true;
    if (!inAud(ev, audExams())) S.aud = "all";
    renderFinder(false); renderChips(); renderLedger(); drawYear(false);
    var row = $("ev-" + id);
    if (row) { row.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" }); row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
  }

  /* ---------- coming up ---------- */
  function renderChips() {
    var box = $("chips"); if (!box) return; box.innerHTML = "";
    ["all", "state", "satact", "ap", "college"].forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = t(k);
      b.setAttribute("aria-pressed", S.filter === k ? "true" : "false");
      b.onclick = function () { S.filter = k; S.expanded = false; renderChips(); renderLedger(); track("exam_filter", k); };
      box.appendChild(b);
    });
  }
  function renderLedger() {
    var box = $("ledger"); if (!box) return;
    var ax = audExams();
    var list = upcoming().filter(function (e) { return (S.filter === "all" || laneOf(e) === S.filter) && inAud(e, ax); });
    var note = $("audNote");
    if (note) {
      if (ax) {
        note.hidden = false;
        note.innerHTML = "<span>" + esc(t("showingFor", { g: nm(audById(S.aud).label) })) + '</span><button type="button" id="audClear">' + esc(t("showEvery")) + "</button>";
        $("audClear").onclick = function () { S.aud = "all"; renderFinder(true); renderLedger(); drawYear(false); syncURL(); };
      } else { note.hidden = true; note.innerHTML = ""; }
    }
    if (!upcoming().length) {
      box.innerHTML = '<div class="empty"><h3>' + esc(t("emptyH", { y: nextYear() })) + "</h3><p>" + esc(t("emptyP", { y0: D.schoolYear })) + esc(nm(D.nextYear.note)) + "</p></div>";
      return;
    }
    var LIMIT = 7, shown = S.expanded ? list : list.slice(0, LIMIT), first = true, html = "<ol>";
    shown.forEach(function (e) {
      var st = status(e), a = P(e.start), ex = examOf(e.exam), dl = e.type === "reg" || e.type === "late";
      var cnt = esc(st.text); if (first) { cnt = '<span class="hl">' + cnt + "</span>"; first = false; }
      html += '<li class="row" id="ev-' + e.id + '">' +
        '<div class="when"><span class="mon">' + esc(mon(a)) + '</span><span class="day">' + a.getDate() + '</span><span class="dow">' + esc(dow(a)) + "</span></div>" +
        '<div class="what"><p class="title">' + esc(nm(e.label)) + "</p>" +
        '<p class="meta"><span class="tag' + (dl ? " dl" : "") + '">' + esc(t(e.type)) + "</span><span>" + esc(e.end ? range(e) : nm(ex.name)) + "</span></p>" +
        (e.note ? '<p class="note">' + esc(nm(e.note)) + "</p>" : "") +
        (e.verify ? '<p class="verify">' + ICON_WARN + esc(t("verify")) + "</p>" : "") + "</div>" +
        '<div class="side"><span class="count">' + cnt + '</span><div class="acts">' +
        '<button type="button" class="ibtn" data-ics="' + e.id + '">' + ICON_CAL + '<span class="lbl-long">' + esc(t("ics")) + '</span><span class="sr">' + esc(nm(e.label)) + "</span></button>" +
        '<a class="ibtn" href="' + esc(D.sources[e.src].url) + '" target="_blank" rel="noopener" title="' + esc(D.sources[e.src].label) + '">' + esc(t("source")) + "</a>" +
        "</div></div></li>";
    });
    html += "</ol>";
    if (list.length > LIMIT) html += '<div class="more"><button type="button" class="btn btn-ghost btn-sm" id="moreBtn">' + esc(S.expanded ? t("showLess") : t("showAll", { n: list.length })) + "</button></div>";
    box.innerHTML = html;
    var mb = $("moreBtn"); if (mb) mb.onclick = function () { S.expanded = !S.expanded; renderLedger(); };
  }

  /* ---------- add to calendar (.ics, generated in the browser) ---------- */
  function icsEsc(s) { return s.replace(/\\/g, "\\\\").replace(/[,;]/g, function (c) { return "\\" + c; }).replace(/\n/g, "\\n"); }
  function downloadICS(ev) {
    var f = function (d) { return iso(d).replace(/-/g, ""); };
    var a = P(ev.start), b = new Date(P(ev.end || ev.start).getTime() + 864e5), src = D.sources[ev.src], n = new Date();
    var stamp = n.getUTCFullYear() + String(n.getUTCMonth() + 1).padStart(2, "0") + String(n.getUTCDate()).padStart(2, "0") + "T" + String(n.getUTCHours()).padStart(2, "0") + String(n.getUTCMinutes()).padStart(2, "0") + "00Z";
    var txt = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jose Diaz Tutoring//Exam calendar//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      "UID:" + ev.id + "-" + D.schoolYear + "@josediaztutoring.com", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + f(a), "DTEND;VALUE=DATE:" + f(b), "SUMMARY:" + icsEsc(nm(ev.label)),
      "DESCRIPTION:" + icsEsc((ev.note ? nm(ev.note) + "\n" : "") + (LANG === "es" ? "Fuente: " : "Source: ") + src.label + " " + src.url + "\n" + SITE + HUB),
      "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(nm(ev.label)), "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    var url = URL.createObjectURL(new Blob([txt], { type: "text/calendar" }));
    var l = document.createElement("a"); l.href = url; l.download = ev.id + ".ics"; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    track("exam_calendar_add", ev.id);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-ics]"); if (b) { downloadICS(evById(b.getAttribute("data-ics"))); return; }
    var r = e.target.closest("[data-res]"); if (r) { track("exam_resource", r.getAttribute("data-res")); return; }
    var c = e.target.closest("#claudeBtn"); if (c) { track("summarize_claude", document.body.getAttribute("data-exam") || "page"); }
  });

  /* ---------- exam guide page ---------- */
  var EXAM = document.body.getAttribute("data-exam");
  function examWins() { var x = examOf(EXAM); return (x && x.windows || []).map(evById).filter(Boolean); }
  function nextWin() { return examWins().filter(function (e) { return status(e).state !== "past"; })[0]; }
  function renderExam() {
    if (!EXAM) return;
    var w = nextWin(), st = $("examStatus");
    if (st) {
      if (!w) st.innerHTML = esc(t("stNone", { y: nextYear() }));
      else {
        var s = status(w);
        st.innerHTML = (s.state === "open" ? esc(nm(w.short) + " · " + range(w)) : esc(t("stNext", { r: nm(w.short) + ", " + range(w) }))) + ' <span class="hand">' + esc(s.text) + "</span>";
      }
    }
    var nw = document.querySelector("[data-nextwin]");
    if (nw) nw.textContent = w ? t("nextWinText", { w: nm(w.short).toLowerCase(), r: range(w) }) : t("nextWinNone", { y: nextYear() });
    var ol = $("winList");
    if (ol) {
      ol.innerHTML = "";
      examWins().forEach(function (e) {
        var s = status(e), li = document.createElement("li");
        li.className = s.state === "past" ? "past" : (s.state === "open" ? "now" : "");
        li.innerHTML = '<div class="w-name">' + esc(nm(e.short)) + '<span class="hand">' + esc(s.state === "past" ? t("done") : s.text) + '</span></div><div class="w-when">' + esc(range(e)) + ", " + P(e.start).getFullYear() + "</div>" + (e.verify ? '<p class="verify">' + ICON_WARN + esc(t("verify")) + "</p>" : "");
        ol.appendChild(li);
      });
    }
    var hr = $("heroRuler"); if (hr) drawRuler(hr, testById(EXAM) || D.algebra1Requirement.tests[0], null, true);
    renderChecker();
    var bl = $("brkList"), x = examOf(EXAM);
    if (bl && x.breaks) {
      bl.innerHTML = "";
      x.breaks.forEach(function (b, i) {
        var r = document.createElement("div"); r.className = "brk";
        r.innerHTML = '<span class="n">' + (i + 1) + '</span><div><p class="skill">' + esc(b[LANG][0]) + '</p><p class="why">' + esc(b[LANG][1]) + '</p></div><span class="ex">' + esc(b.ex) + "</span>";
        bl.appendChild(r);
      });
    }
    var wf = $("waffle");
    if (wf && !wf.childNodes.length) { var pr = D.stats.alg1PassRate2026.grades9to12; for (var i = 0; i < 100; i++) { var c = document.createElement("i"); if (i < pr) c.className = "on"; wf.appendChild(c); } wf.setAttribute("aria-label", t("waffle", { n: pr })); }
    var ll = $("examLinks");
    if (ll && x.resources) ll.innerHTML = x.resources.map(function (k) { var r = D.resources[k]; return '<a href="' + esc(r.url) + '" target="_blank" rel="noopener" data-res="' + k + '"><span>' + esc(nm(r.label)) + "<br><small>" + esc(r.by) + '</small></span><span aria-hidden="true">↗</span></a>'; }).join("");
    claudeLink();
  }
  function testById(id) { return D.algebra1Requirement.tests.filter(function (T) { return T.id === id; })[0]; }
  function drawRuler(svg, T, score, hero) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var compact = svg.getBoundingClientRect().width < 470;
    var W = compact ? 320 : 640, x0 = compact ? 12 : 24, x1 = W - (compact ? 12 : 24), y = hero ? 58 : 52, h = compact ? 30 : 26, fs = compact ? 13.5 : 12.5;
    svg.setAttribute("viewBox", "0 0 " + W + " " + (hero ? 150 : 120));
    var step = compact ? T.step * (T.step === 25 ? 2 : 1) : T.step;
    function X(v) { return x0 + (x1 - x0) * (v - T.min) / (T.max - T.min); }
    var g = el("g", { "font-family": "Atkinson Hyperlegible, sans-serif" }); svg.appendChild(g);
    if (T.levels) {
      T.levels.forEach(function (lv, i) {
        var a = X(lv[0]), b = X(i === T.levels.length - 1 ? lv[1] : T.levels[i + 1][0]);
        g.appendChild(el("rect", { x: a, y: y, width: b - a, height: h, fill: i >= 2 ? "#E9F2E4" : "#fff", stroke: "#A9B5B1", "stroke-width": 1 }));
        g.appendChild(el("text", { x: (a + b) / 2, y: y + h / 2 + 5, "text-anchor": "middle", "font-size": compact ? 13.5 : 13, "font-weight": 700, fill: i >= 2 ? "#1C4C9E" : "#55605E" }, ((b - a) < (compact ? 64 : 70) ? "" : t("lvl") + " ") + (i + 1)));
      });
    } else {
      g.appendChild(el("rect", { x: x0, y: y, width: X(T.cut) - x0, height: h, fill: "#fff", stroke: "#A9B5B1" }));
      g.appendChild(el("rect", { x: X(T.cut), y: y, width: x1 - X(T.cut), height: h, fill: "#E9F2E4", stroke: "#A9B5B1" }));
    }
    for (var v = Math.ceil(T.min / step) * step; v <= T.max; v += step) {
      var xx = X(v); g.appendChild(el("line", { x1: xx, y1: y + h, x2: xx, y2: y + h + 7, stroke: "#55605E" }));
      if (Math.abs(v - T.cut) > (T.max - T.min) * 0.04) g.appendChild(el("text", { x: xx, y: y + h + 22, "text-anchor": "middle", "font-size": fs, fill: "#55605E" }, v));
    }
    [T.min, T.max].forEach(function (v) { if (v % step) g.appendChild(el("text", { x: X(v), y: y + h + 22, "text-anchor": v === T.min ? "start" : "end", "font-size": fs, fill: "#55605E" }, v)); });
    var cx = X(T.cut);
    if (hero) {
      g.appendChild(el("rect", { x: cx - 24, y: y + h + 8, width: 48, height: 22, rx: 4, fill: "#232A2A" }));
      g.appendChild(el("line", { x1: cx, y1: y - 16, x2: cx, y2: y + h + 8, stroke: "#232A2A", "stroke-width": 2.5 }));
      g.appendChild(el("text", { x: cx, y: y + h + 24, "text-anchor": "middle", "font-size": 15, "font-weight": 700, fill: "#fff" }, T.cut));
      // the note starts at the line and must end inside the card: shrink it on narrow cards
      var nfs = Math.min(compact ? 17 : 18, (W - cx - 14) / (t("passHere").length * 0.52));
      g.appendChild(el("text", { x: cx + 8, y: y - 22, "font-family": "Kalam, cursive", "font-size": Math.round(nfs * 10) / 10, "font-weight": 700, fill: "#1C4C9E" }, t("passHere")));
    } else {
      g.appendChild(el("line", { x1: cx, y1: y - 12, x2: cx, y2: y + h + 8, stroke: "#1C4C9E", "stroke-width": 2.5, "stroke-dasharray": "5 3" }));
      g.appendChild(el("text", { x: cx, y: y + h + 24, "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "#1C4C9E" }, t("passes", { c: T.cut })));
    }
    if (score != null) {
      var sx = X(Math.max(T.min, Math.min(T.max, score)));
      g.appendChild(el("line", { x1: sx, y1: y - 6, x2: sx, y2: y + h, stroke: "#1C4C9E", "stroke-width": 3.5, "stroke-linecap": "round" }));
      g.appendChild(el("path", { d: "M" + (sx - 8) + " " + (y - 14) + " h16 l-8 10 z", fill: "#1C4C9E" }));
      g.appendChild(el("text", { x: sx, y: y - 20, "text-anchor": "middle", "font-family": "Kalam, cursive", "font-size": 17, "font-weight": 700, fill: "#232A2A" }, t("yourScore") + ": " + score));
    }
  }
  function renderChecker() {
    var sel = $("chkTest"); if (!sel) return;
    var cur = sel.value; sel.innerHTML = "";
    D.algebra1Requirement.tests.forEach(function (T) { var o = document.createElement("option"); o.value = T.id; o.textContent = nm(T) + " (" + T.min + "–" + T.max + ")"; sel.appendChild(o); });
    if (cur) sel.value = cur;
    var T = testById(sel.value), i = $("chkScore"); i.min = T.min; i.max = T.max; i.placeholder = T.min + "–" + T.max;
    var note = $("chkNote"); if (note) note.textContent = nm(D.algebra1Requirement.note);
  }
  function runCheck(silent) {
    var T = testById($("chkTest").value), raw = $("chkScore").value, box = $("chkResult"), sc = parseFloat(raw);
    if (raw === "" || isNaN(sc) || sc < T.min || sc > T.max) { box.className = "result on"; box.innerHTML = '<p class="verdict no">' + esc(t("outRange", { a: T.min, b: T.max })) + "</p>"; return; }
    var ok = sc >= T.cut, gap = T.cut - sc;
    var html = '<p class="verdict' + (ok ? "" : " no") + '">' + (ok
      ? '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="#1C4C9E"/><path d="M7.5 13.4l3.6 3.6 7.6-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11.5" fill="none" stroke="#1C4C9E" stroke-width="2"/><path d="M8 13h10" stroke="#1C4C9E" stroke-width="2.4" stroke-linecap="round"/></svg>') +
      "<span>" + esc(ok ? t("met") : t("notMet", { n: gap, u: gap === 1 ? t("point") : t("points"), c: T.cut })) + "</span></p>" +
      '<svg class="ruler2" id="chkRuler" role="img" aria-label="' + esc(nm(T)) + '"></svg>';
    if (ok) html += '<p class="fine-note">' + esc(t("metFine")) + "</p>";
    else {
      var items = [], w = nextWin();
      if (w) items.push("<li><b>" + esc(t("nEoc")) + "</b><span>" + esc(nm(w.short) + ", " + range(w)) + '</span><span class="hand">' + esc(status(w).text) + "</span></li>");
      ["sat", "act"].forEach(function (k) {
        var tests = upcoming().filter(function (e) { return e.exam === k && e.type === "test"; });
        for (var i = 0; i < tests.length; i++) {
          var te = tests[i];
          var reg = D.events.filter(function (e) { return e.for === te.id && e.type === "reg"; })[0];
          var late = D.events.filter(function (e) { return e.for === te.id && e.type === "late"; })[0];
          var dl = reg && status(reg).state !== "past" ? t("regBy", { d: md(P(reg.start)) }) : (late && status(late).state !== "past" ? t("lateBy", { d: md(P(late.start)) }) : null);
          if (dl || (!reg && !late)) { items.push("<li><b>" + esc(t(k === "sat" ? "nSat" : "nAct", { d: md(P(te.start)) })) + "</b>" + (dl ? "<span>" + esc(dl) + "</span>" : "") + '<span class="hand">' + esc(status(te).text) + "</span></li>"); break; }
        }
      });
      if (items.length) html += '<h3 class="nexts-h">' + esc(t("nextTitle")) + '</h3><ul class="nexts">' + items.join("") + "</ul>";
    }
    box.className = "result on"; box.innerHTML = html;
    drawRuler($("chkRuler"), T, sc, false);
    if (!silent) track("score_check", T.id);
  }
  var form = $("chkForm");
  if (form) {
    form.addEventListener("submit", function (e) { e.preventDefault(); runCheck(); });
    $("chkTest").addEventListener("change", function () { var T = testById(this.value), i = $("chkScore"); i.min = T.min; i.max = T.max; i.placeholder = T.min + "–" + T.max; if ($("chkResult").classList.contains("on")) runCheck(true); }); // only an explicit check is counted
  }

  /* ---------- Summarize with Claude (prefilled claude.ai link; nothing is sent from this site) ---------- */
  function claudeLink() {
    var btn = $("claudeBtn"); if (!btn) return;
    var lis = [].slice.call(document.querySelectorAll("#takeaways li")).map(function (li) { return "- " + li.textContent.replace(/\s+/g, " ").trim(); });
    var canon = document.querySelector('link[rel="canonical"]'), page = canon ? canon.href : location.origin + location.pathname;
    var p = t("claudeIntro", { e: nm(examOf(EXAM).name) }) + "\n\n" + t("page") + page + "\n\n" + t("claudeFacts", { y: D.schoolYear, d: mdy(P(D.checked)) }) + "\n" + lis.join("\n") + "\n\n" + t("claudeEnd");
    btn.href = "https://claude.ai/new?q=" + encodeURIComponent(p);
  }

  /* ---------- init ---------- */
  if (q.get("for") && audById(q.get("for"))) S.aud = q.get("for");
  [].forEach.call(document.querySelectorAll("[data-checked]"), function (b) { b.textContent = mdy(P(D.checked)); });
  renderFinder(false); drawYear(true); renderChips(); renderLedger(); renderExam();
  var rz;
  window.addEventListener("resize", function () {
    clearTimeout(rz);
    rz = setTimeout(function () { drawYear(false); var hr = $("heroRuler"); if (hr) drawRuler(hr, testById(EXAM) || D.algebra1Requirement.tests[0], null, true); if ($("chkRuler")) runCheck(true); }, 150);
  });
})();
