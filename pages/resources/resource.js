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

  // Copy link: this page with the tool's current setup
  var copy = document.getElementById("res-copy");
  if (copy) {
    var label = copy.querySelector(".res-lbl"), idle = label ? label.textContent : "";
    var done = function (ok) {
      var msg = ok ? copy.getAttribute("data-copied") : copy.getAttribute("data-failed");
      if (label && ok) { label.textContent = msg; setTimeout(function () { label.textContent = idle; }, 2000); }
      copy.classList.toggle("is-done", ok);
      say(msg);
    };
    copy.addEventListener("click", function () {
      var url = location.origin + baseUrl() + toolHash;
      var fallback = function () {
        try {
          var ta = document.createElement("textarea");
          ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand("copy"); ta.remove(); done(ok);
        } catch (err) { done(false); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, fallback);
      else fallback();
      track("resource_link_copy", { resource_id: id, has_state: !!toolHash });
    });
  }

  // Full screen: the tool area (hidden where the Fullscreen API isn't available, e.g. iPhone)
  var fs = document.getElementById("res-fs"), stage = document.getElementById("tool");
  var req = stage && (stage.requestFullscreen || stage.webkitRequestFullscreen);
  var enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (fs && req && enabled) {
    fs.hidden = false;
    var enter = fs.getAttribute("aria-label"), exit = fs.getAttribute("data-exit");
    var current = function () { return document.fullscreenElement || document.webkitFullscreenElement; };
    fs.addEventListener("click", function () {
      if (current()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      try { var p = req.call(stage); if (p && p.catch) p.catch(function () {}); } catch (err) {}
      track("resource_fullscreen", { resource_id: id });
    });
    var sync = function () { var on = !!current(); fs.setAttribute("aria-label", on ? exit : enter); fs.title = on ? exit : enter; };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
  }

  // EN/ES: the lang-switch block's own click handler runs first and adds a #section; this one runs
  // after it and puts the tool's setup there instead (the two pages show the same tool).
  [].forEach.call(document.querySelectorAll(".res-bar .lang a[data-lang]"), function (a) {
    a.addEventListener("click", function () {
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

  // booking clicks (bar and the CTA at the bottom)
  [].forEach.call(document.querySelectorAll('a[data-loc="bar"], a[data-loc="cta"]'), function (a) {
    a.addEventListener("click", function () { track("resource_book_click", { resource_id: id, link_location: a.getAttribute("data-loc") }); });
  });
})();
