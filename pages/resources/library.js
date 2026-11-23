/* Library filters (/resources/, /es/recursos/): one subject and one level at a time ("All" = no
   filter). The list is server-rendered and complete without this script; the chips only appear with it. */
(function () {
  var box = document.getElementById("lib-filters"), list = document.getElementById("lib-list");
  if (!box || !list) return;
  var count = document.getElementById("lib-count"), none = document.getElementById("lib-nomatch");
  var cards = [].slice.call(list.querySelectorAll(".tool-card"));
  var pick = { subject: "", level: "" };
  function apply() {
    var n = 0;
    cards.forEach(function (c) {
      var ok = (!pick.subject || c.getAttribute("data-subject") === pick.subject) &&
        (!pick.level || (" " + c.getAttribute("data-levels") + " ").indexOf(" " + pick.level + " ") >= 0);
      c.hidden = !ok;
      if (ok) n++;
    });
    if (count) count.textContent = n === 1 ? count.getAttribute("data-one") : count.getAttribute("data-many").replace("{n}", n);
    if (none) none.hidden = n > 0;
  }
  [].forEach.call(box.querySelectorAll("[data-group]"), function (g) {
    var group = g.getAttribute("data-group");
    g.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-value]");
      if (!b) return;
      pick[group] = b.getAttribute("data-value");
      [].forEach.call(g.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      apply();
    });
  });
  box.hidden = false;
})();
