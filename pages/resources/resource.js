/* A resource page's bar and frame (scripts/build.js inlines it after the analytics and lang-switch
   blocks, so `track` and `LANG` exist). The tool keeps its values in its own #hash; the prelude the
   server injects into the tool posts {source:"jdt-tool", type:"state"|"ready", hash} to this page,
   which mirrors that hash into its own address bar (replaceState: no reload, no history entries).
   Copy link and the EN/ES switch use it, so a shared link opens the same setup. */
(function () {
  var frame = document.getElementById("res-frame");
  if (!frame) return;
  var id = document.body.getAttribute("data-resource-id") || "";
  var status = document.getElementById("res-status");
  var toolHash = window.__jdtToolHash || "";
  var MAX = 2000;

  function say(msg) { if (status) { status.textContent = ""; setTimeout(function () { status.textContent = msg; }, 30); } }
  function baseUrl() {
    var q = new URLSearchParams(location.search);
    q.delete("lang");
    q = q.toString();
    return location.pathname + (q ? "?" + q : "");
  }

  // tool -> page: only messages from this frame's window, with the expected shape
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== "object" || d.source !== "jdt-tool" || (d.type !== "state" && d.type !== "ready")) return;
    var h = typeof d.hash === "string" ? d.hash : "";
    if (h.length > MAX || (h && h.charAt(0) !== "#")) return;
    if (h === "#") h = "";
    toolHash = h;
    try { history.replaceState(history.state, "", baseUrl() + h); } catch (err) {}
  });

  // the visitor edits the #hash in the address bar: reload the tool with it (our own replaceState
  // calls never fire hashchange; the page's section anchors aren't tool state)
  window.addEventListener("hashchange", function () {
    var h = location.hash;
    if (h === toolHash || h.length > MAX || /^#(main|tool|how|ideas|faq|related|get-help)$/.test(h)) return;
    toolHash = h;
    frame.src = frame.src.split("#")[0] + h;
  });

  // Share: the share sheet where there is one (phones), else copy the link. Either way the URL carries
  // the tool's setup (#hash). One event, resource_link_copy, with method: share | copy.
  var share = document.getElementById("res-share"), toast = document.getElementById("res-toast");
  if (share) {
    var label = share.querySelector(".res-lbl"), idle = label ? label.textContent : "", timer = null;
    var copied = function (ok) {
      var msg = ok ? share.getAttribute("data-copied") : share.getAttribute("data-failed");
      say(msg);
      if (!ok) return;
      if (label) label.textContent = msg;
      if (toast) toast.hidden = false;
      clearTimeout(timer);
      timer = setTimeout(function () { if (label) label.textContent = idle; if (toast) toast.hidden = true; }, 2000);
      track("resource_link_copy", { resource_id: id, has_state: !!toolHash, method: "copy" });
    };
    var copy = function (url) {
      var fallback = function () {
        try {
          var ta = document.createElement("textarea");
          ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand("copy"); ta.remove(); copied(ok);
        } catch (err) { copied(false); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { copied(true); }, fallback);
      else fallback();
    };
    share.addEventListener("click", function () {
      var url = location.origin + baseUrl() + toolHash;
      if (navigator.share) {
        navigator.share({ title: document.title, url: url }).then(function () {
          track("resource_link_copy", { resource_id: id, has_state: !!toolHash, method: "share" });
        }, function (err) { if (!err || err.name !== "AbortError") copy(url); }); // closed the sheet: nothing
      } else copy(url);
    });
  }

  // Full screen: the tool area. Offered only where the Fullscreen API works for it (not iPhone Safari):
  // the icon in the bar (600px+) and the item in the ⋯ menu (under 600px).
  var stage = document.getElementById("tool"), fsBtns = [document.getElementById("res-fs"), document.getElementById("res-menu-fs")].filter(Boolean);
  var req = stage && (stage.requestFullscreen || stage.webkitRequestFullscreen);
  var fsOk = !!(req && (document.fullscreenEnabled || document.webkitFullscreenEnabled));
  var inFs = function () { return document.fullscreenElement || document.webkitFullscreenElement; };
  var toggleFs = function () {
    if (inFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    try { var p = req.call(stage); if (p && p.catch) p.catch(function () {}); } catch (err) {}
    track("resource_fullscreen", { resource_id: id });
  };
  if (fsOk) {
    var syncFs = function () {
      fsBtns.forEach(function (b) {
        var t = inFs() ? b.getAttribute("data-exit") : b.getAttribute("data-enter");
        if (b.id === "res-menu-fs") b.textContent = t; else { b.setAttribute("aria-label", t); b.title = t; }
      });
    };
    fsBtns.forEach(function (b) { b.hidden = false; b.addEventListener("click", toggleFs); });
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);
  }

  // ⋯ menu (under 600px): a disclosure button + panel. Esc, a tap outside or a choice closes it;
  // arrows move between the items; focus goes back to the button when it closes from the keyboard.
  var more = document.getElementById("res-more"), menu = document.getElementById("res-menu");
  if (more && menu) {
    var items = function () { return [].filter.call(menu.querySelectorAll("a, button"), function (el) { return !el.hidden; }); };
    var open = function () { menu.hidden = false; more.setAttribute("aria-expanded", "true"); var f = items()[0]; if (f) f.focus(); };
    var close = function (refocus) { if (menu.hidden) return; menu.hidden = true; more.setAttribute("aria-expanded", "false"); if (refocus) more.focus(); };
    more.addEventListener("click", function () { if (menu.hidden) open(); else close(false); });
    menu.addEventListener("click", function (e) { if (e.target.closest("a, button")) close(false); });
    document.addEventListener("keydown", function (e) {
      if (menu.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        var list = items(), i = list.indexOf(document.activeElement);
        if (i < 0 && document.activeElement !== more) return;
        e.preventDefault();
        var n = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        list[n].focus();
      }
    });
    document.addEventListener("pointerdown", function (e) { if (!menu.hidden && !e.target.closest(".res-more")) close(false); });
    // a tap on the tool happens inside its iframe (no pointerdown here): the page loses focus instead
    window.addEventListener("blur", function () { close(false); });
    menu.addEventListener("focusout", function (e) { if (!menu.hidden && e.relatedTarget && !e.relatedTarget.closest(".res-more")) close(false); });
    if (window.matchMedia) { var mq = matchMedia("(min-width: 600px)"); var onMq = function () { if (mq.matches) close(false); }; mq.addEventListener ? mq.addEventListener("change", onMq) : mq.addListener(onMq); }
  }

  // EN/ES (the switch from 600px, the ⋯ menu below): save the choice like the site's switch does, then go
  // to the other page with the tool's setup (#hash) instead of a #section (the two pages show the same tool).
  [].forEach.call(document.querySelectorAll(".res-bar a[data-lang]"), function (a) {
    a.addEventListener("click", function () {
      try { if (window.switchLanguage) window.switchLanguage(a.getAttribute("data-lang"), false); } catch (err) {}
      var q = new URLSearchParams(location.search);
      q.delete("lang");
      q = q.toString();
      a.setAttribute("href", a.getAttribute("href").split(/[?#]/)[0] + (q ? "?" + q : "") + toolHash);
    });
  });

  // "How it works": scroll without touching the #hash (it belongs to the tool)
  var cue = document.querySelector(".res-cue");
  if (cue) cue.addEventListener("click", function (e) {
    var target = document.getElementById("how");
    if (!target) return;
    e.preventDefault();
    var smooth = !(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
  });

  // printable PDFs (the list under "How to use it"; links inside the tool can't be counted: sandbox)
  var filesSec = document.getElementById("files");
  if (filesSec) [].forEach.call(filesSec.querySelectorAll("a[data-file]"), function (a) {
    a.addEventListener("click", function () { track("resource_file_open", { resource_slug: filesSec.getAttribute("data-resource-slug"), file_name: a.getAttribute("data-file") }); });
  });

  // booking clicks (bar and the CTA at the bottom)
  [].forEach.call(document.querySelectorAll('a[data-loc="bar"], a[data-loc="cta"]'), function (a) {
    a.addEventListener("click", function () { track("resource_book_click", { resource_id: id, link_location: a.getAttribute("data-loc") }); });
  });
})();
