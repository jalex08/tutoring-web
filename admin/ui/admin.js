/* Resources admin: list page ("New resource") and the editor. No framework, no build step. */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  function say(text, kind) { if (!msg) return; msg.textContent = text || ""; msg.className = "msg" + (kind ? " " + kind : ""); }

  function api(method, url, body, raw) {
    var opts = { method: method, headers: { "X-JDT-Admin": "1" }, credentials: "same-origin" };
    if (raw) { opts.body = raw; opts.headers["Content-Type"] = "application/octet-stream"; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "HTTP " + r.status + " (not JSON; is the IAP session expired? Reload the page)." }; })
        .then(function (j) { if (!r.ok || !j.ok) { var e = new Error(j.error || "HTTP " + r.status); e.data = j; throw e; } return j; });
    });
  }

  // ---- list page -------------------------------------------------------------------------------
  var newBtn = document.getElementById("new-resource");
  if (newBtn) newBtn.addEventListener("click", function () {
    newBtn.disabled = true;
    api("POST", "/api/resources", {}).then(function (j) { location.href = "/edit/" + j.id; }, function (e) { newBtn.disabled = false; say(e.message, "err"); });
  });

  // ---- editor ----------------------------------------------------------------------------------
  var dataEl = document.getElementById("doc-data");
  if (!dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var doc = data.doc, MAX = data.maxBytes;
  var form = document.getElementById("edit");
  var checked = document.getElementById("checked");
  var $ = function (id) { return document.getElementById(id); };
  var dirty = false;

  // slugs: lowercase ASCII with hyphens (same rule as lib/resources/model.js slugify)
  function slugify(t) {
    return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ø/g, "o").replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
  }
  ["en", "es"].forEach(function (l) {
    var title = $(l + "-title"), slug = $(l + "-slug");
    title.addEventListener("input", function () { if (slug.getAttribute("data-auto") === "1" && !doc.publishedAt) slug.value = slugify(title.value); });
    slug.addEventListener("input", function () { slug.setAttribute("data-auto", "0"); });
    slug.addEventListener("blur", function () { slug.value = slugify(slug.value); });
  });

  // description counters
  [].forEach.call(document.querySelectorAll(".count"), function (c) {
    var input = $(c.getAttribute("data-for")), max = Number(c.getAttribute("data-max"));
    var upd = function () { var n = input.value.trim().length; c.textContent = n + " / " + max; c.classList.toggle("over", n > max); };
    input.addEventListener("input", upd); upd();
  });

  // KaTeX preview (rendered by the server with the same code as the public pages)
  var timers = {};
  function mathPreview(ta) {
    var out = document.querySelector('.math-preview[data-for="' + ta.id + '"]');
    if (!out) return;
    if (!/\$/.test(ta.value)) { out.innerHTML = ""; return; }
    clearTimeout(timers[ta.id]);
    timers[ta.id] = setTimeout(function () {
      var text = ta.name.split(".")[1] === "intro" ? ta.value : ta.value.split("\n").filter(Boolean).join("\n\n");
      api("POST", "/api/math", { text: text }).then(function (j) {
        out.innerHTML = j.html + j.errors.map(function (e) { return '<p class="err">Can’t render <code></code>: </p>'; }).join("");
        [].forEach.call(out.querySelectorAll(".err"), function (p, i) { p.querySelector("code").textContent = j.errors[i].math; p.appendChild(document.createTextNode(j.errors[i].error)); });
      }, function () {});
    }, 350);
  }
  [].forEach.call(document.querySelectorAll("textarea[data-math]"), function (ta) { ta.addEventListener("input", function () { mathPreview(ta); }); mathPreview(ta); });

  // FAQ items
  function faqItem() {
    var d = document.createElement("div");
    d.className = "faq-item";
    d.innerHTML = '<input aria-label="Question" placeholder="Question" class="faq-q"><textarea aria-label="Answer" placeholder="Answer" class="faq-a" rows="2"></textarea><button type="button" class="btn btn-small btn-quiet remove-faq">Remove</button>';
    return d;
  }
  document.addEventListener("click", function (e) {
    var add = e.target.closest(".add-faq");
    if (add) { var list = document.querySelector('.faq-list[data-lang="' + add.getAttribute("data-lang") + '"]'); var it = faqItem(); list.appendChild(it); it.querySelector("input").focus(); dirty = true; refresh(); }
    var rm = e.target.closest(".remove-faq");
    if (rm) { rm.closest(".faq-item").remove(); dirty = true; refresh(); }
  });

  // the form -> the fields the server accepts
  function lines(v) { return v.split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
  function commas(v) { return v.split(",").map(function (s) { return s.trim(); }).filter(Boolean); }
  function collect() {
    var out = { slugEn: $("en-slug").value.trim(), slugEs: $("es-slug").value.trim(), subject: $("subject").value, relatedExamPage: $("relatedExamPage").value,
      levels: [].map.call(form.querySelectorAll('input[name="levels"]:checked'), function (c) { return c.value; }),
      courseTags: commas($("courseTags").value) };
    ["en", "es"].forEach(function (l) {
      out[l] = {
        title: $(l + "-title").value.trim(), description: $(l + "-description").value.trim(), intro: $(l + "-intro").value.trim(),
        howTo: lines($(l + "-howTo").value), keyIdeas: lines($(l + "-keyIdeas").value), keywords: commas($(l + "-keywords").value),
        faq: [].map.call(document.querySelectorAll('.faq-list[data-lang="' + l + '"] .faq-item'), function (it) {
          return { q: it.querySelector(".faq-q").value.trim(), a: it.querySelector(".faq-a").value.trim() };
        }).filter(function (f) { return f.q || f.a; }),
      };
    });
    return out;
  }

  // what's missing, worked out in the browser for the Publish button (the server checks again)
  function localProblems() {
    var f = collect(), p = [];
    if (!doc.file) p.push("Upload the tool's HTML file.");
    ["en", "es"].forEach(function (l) {
      var t = f[l], L = l.toUpperCase();
      if (!t.title) p.push(L + ": title is required.");
      if (!(l === "en" ? f.slugEn : f.slugEs)) p.push(L + ": slug is required.");
      if (!t.description) p.push(L + ": description is required.");
      else if (t.description.length > 155) p.push(L + ": description is over 155 characters.");
      if (!t.intro) p.push(L + ": intro is required.");
      if (!t.howTo.length) p.push(L + ': add at least one "how to use it" step.');
      if (!t.keyIdeas.length) p.push(L + ": add at least one key idea.");
      t.faq.forEach(function (x) { if (!x.q || !x.a) p.push(L + ": every FAQ item needs a question and an answer."); });
    });
    if (!f.levels.length) p.push("Pick at least one level.");
    return p.filter(function (x, i) { return p.indexOf(x) === i; });
  }
  var serverProblems = data.problems || [];
  function showProblems(list) {
    var ul = $("problems");
    ul.innerHTML = "";
    list.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
  }
  function refresh() {
    var probs = localProblems();
    // server-only checks (slug uniqueness, formulas) stay listed until the next save
    serverProblems.forEach(function (s) { if (/already used|doesn't render/.test(s) && probs.indexOf(s) < 0) probs.push(s); });
    showProblems(probs);
    var ready = !probs.length && checked.checked;
    $("publish").disabled = !ready;
    if (doc.status === "published") $("save").disabled = !ready;
  }
  form.addEventListener("input", function () { dirty = true; refresh(); });
  form.addEventListener("change", function () { dirty = true; refresh(); });
  checked.addEventListener("change", refresh);
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function apply(j, text) {
    doc = j.doc;
    serverProblems = j.problems || [];
    dirty = false;
    $("status-badge").textContent = { draft: "Draft", published: "Published", unpublished: "Unpublished" }[doc.status];
    $("status-badge").className = "badge badge-" + doc.status;
    $("publish").hidden = doc.status === "published";
    $("unpublish").hidden = doc.status !== "published";
    $("delete").hidden = !!doc.publishedAt;
    $("save").textContent = doc.status === "published" ? "Update live page" : "Save draft";
    var ll = $("live-links");
    ll.textContent = "";
    if (doc.status === "published") {
      ll.appendChild(document.createTextNode("Live: "));
      [["en", "/resources/", doc.slugEn], ["es", "/es/recursos/", doc.slugEs]].forEach(function (x, i) {
        if (i) ll.appendChild(document.createTextNode(" · "));
        var a = document.createElement("a"); a.href = "https://josediaztutoring.com" + x[1] + x[2] + "/"; a.target = "_blank"; a.rel = "noopener"; a.textContent = x[1] + x[2] + "/";
        ll.appendChild(a);
      });
    }
    if (text) say(text, "ok");
    refresh();
  }
  function fail(e) {
    say(e.message, "err");
    if (e.data && e.data.problems) { serverProblems = e.data.problems; showProblems(e.data.problems); }
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); }

  $("save").addEventListener("click", function () {
    var b = this; busy(b, true); say("Saving…");
    api("PUT", "/api/resources/" + doc.id, { doc: collect(), checked: checked.checked })
      .then(function (j) { apply(j, doc.status === "published" ? "Saved. The live page updates within about 30 seconds." : "Draft saved."); }, fail)
      .then(function () { busy(b, false); refresh(); });
  });
  $("publish").addEventListener("click", function () {
    var b = this; busy(b, true); say("Publishing (making the preview cards)…");
    api("POST", "/api/resources/" + doc.id + "/publish", { doc: collect(), checked: checked.checked })
      .then(function (j) { checked.checked = false; apply(j, "Published. Live within about 30 seconds."); }, fail)
      .then(function () { busy(b, false); refresh(); });
  });
  $("unpublish").addEventListener("click", function () {
    if (!confirm("Unpublish? Visitors will get “gone” (410) and it leaves the library and the sitemap.")) return;
    var b = this; busy(b, true);
    api("POST", "/api/resources/" + doc.id + "/unpublish", {}).then(function (j) { apply(j, "Unpublished."); }, fail).then(function () { busy(b, false); });
  });
  $("delete").addEventListener("click", function () {
    if (!confirm("Delete this draft and its files? This can't be undone.")) return;
    api("DELETE", "/api/resources/" + doc.id).then(function () { dirty = false; location.href = "/"; }, fail);
  });

  // file upload: drag and drop or the file picker
  var drop = $("drop"), input = $("file-input");
  function upload(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) { say("Choose an .html or .htm file.", "err"); return; }
    if (file.size > MAX) { say("The file is " + (file.size / 1048576).toFixed(1) + " MB; the limit is " + (MAX / 1048576).toFixed(1) + " MB.", "err"); return; }
    if (doc.status === "published" && !confirm("This resource is live. The new file goes live right away. Continue?")) return;
    say("Uploading " + file.name + "…");
    file.arrayBuffer().then(function (buf) { return api("POST", "/api/resources/" + doc.id + "/file", undefined, buf); }).then(function (j) {
      var w = $("warnings"); w.innerHTML = "";
      j.warnings.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; w.appendChild(li); });
      var f = j.doc.file;
      $("file-info").textContent = "Version " + f.version + " · " + Math.round(f.sizeBytes / 1024) + " KB · just uploaded" +
        (j.scriptHosts.length ? " · scripts from " + j.scriptHosts.join(", ") : "");
      $("tool-preview").hidden = false; $("preview-en").hidden = false; $("preview-es").hidden = false;
      var keepDirty = dirty;
      apply(j, j.warnings.length ? "Uploaded, with warnings (see the list)." : "Uploaded.");
      dirty = keepDirty;
      previewLang("en");
    }, fail);
  }
  drop.addEventListener("click", function (e) { if (e.target.tagName !== "LABEL") input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { upload(input.files[0]); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { upload(e.dataTransfer.files[0]); });

  // live preview language (?lang=es, like the Spanish page)
  function previewLang(l) {
    if (!doc.file) return;
    $("tool-frame").src = "/frame/" + doc.id + "/v" + doc.file.version + (l === "es" ? "?lang=es" : "");
    [].forEach.call(document.querySelectorAll("[data-preview-lang]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-preview-lang") === l ? "true" : "false"); });
  }
  [].forEach.call(document.querySelectorAll("[data-preview-lang]"), function (b) { b.addEventListener("click", function () { previewLang(b.getAttribute("data-preview-lang")); }); });

  refresh();
})();
