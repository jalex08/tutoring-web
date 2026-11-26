/* Booking page: Cal.com's official inline embed (https://cal.com/help/embedding/embed-instructions).
   - Light theme, brand color = the site's ink blue (cssVarsPerTheme, https://cal.com/help/embedding/customize-embed-css-variables).
   - utm_* from this page's URL go into the embed config, which Cal.com passes to the booking
     (https://cal.com/help/embedding/utm-tracking-embed). Only utm_* keys: nothing else from the URL is forwarded.
   - bookingSuccessfulV2 (https://cal.com/help/embedding/embed-events) -> dataLayer generate_lead with
     contact_method "cal_booking". No personal data: the event's own fields are never pushed.
   - Language: Cal.com documents no way to set the scheduler's language in an embed, so it's the same on /es/.
   LANG and track() come from the page's analytics block (scripts/build.js). */
(function () {
  var box = document.querySelector(".cal-box"), el = document.getElementById("cal-inline");
  if (!box || !el) return;
  var NS = "20min", LINK = "josediaztutoring/20min", ORIGIN = "https://app.cal.com";
  var BRAND = { "cal-brand": "#1C4C9E", "cal-brand-emphasis": "#143A7A", "cal-brand-text": "#FFFFFF" };
  var failed = function () { box.classList.add("is-failed"); };
  try {
    // Cal.com's loader snippet, unchanged
    (function (C, A, L) { var p = function (a, ar) { a.q.push(ar); }; var d = C.document; C.Cal = C.Cal || function () { var cal = C.Cal; var ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; var s = d.createElement("script"); s.src = A; s.onerror = failed; d.head.appendChild(s); cal.loaded = true; } if (ar[0] === L) { var api = function () { p(api, arguments); }; var namespace = ar[1]; api.q = api.q || []; if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); } else p(cal, ar); return; } p(cal, ar); }; })(window, ORIGIN + "/embed/embed.js", "init");

    Cal("init", NS, { origin: ORIGIN });
    var config = { layout: "month_view", theme: "light" };
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (/^utm_[a-z0-9_]{1,40}$/i.test(k) && v) config[k.toLowerCase()] = v.slice(0, 200);
    });
    var cal = Cal.ns[NS];
    cal("inline", { elementOrSelector: "#cal-inline", config: config, calLink: LINK });
    cal("ui", { theme: "light", cssVarsPerTheme: { light: BRAND, dark: BRAND }, hideEventTypeDetails: false, layout: "month_view" });
    cal("on", { action: "linkReady", callback: function () { el.classList.add("is-ready"); } });
    cal("on", { action: "linkFailed", callback: failed });
    var counted = {};
    cal("on", {
      action: "bookingSuccessfulV2",
      callback: function (e) {
        var d = (e && e.detail && e.detail.data) || {}, key = d.uid || "booking";
        if (counted[key]) return;
        counted[key] = true;
        track("generate_lead", { contact_method: "cal_booking" });
      },
    });
  } catch (err) {
    failed();
  }
})();
