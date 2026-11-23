/* Resources admin: list page ("New resource") and the editor. No framework, no build step. */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  function say(text, kind) { if (!msg) return; msg.textContent = text || ""; msg.className = "msg" + (kind ? " " + kind : ""); }

  function api(method, url, body, raw, extraHeaders) {
    var opts = { method: method, headers: { "X-JDT-Admin": "1" }, credentials: "same-origin" };
    for (var h in (extraHeaders || {})) opts.headers[h] = extraHeaders[h];
    if (raw) { opts.body = raw; opts.headers["Content-Type"] = "application/octet-stream"; }
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "HTTP " + r.status + " (not JSON; is your sign-in expired? Reload the page)." }; })
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

  // ---- files: <name>.html (the tool) + <name>.json (its page text) ---------------------------------
  // Dropped or picked together (any order) or one at a time. Paired by base name.
  var drop = $("drop"), input = $("file-input");
  var stemOf = function (n) { return String(n).replace(/\.(html?|json)$/i, ""); };
  var kindOf = function (n) { return /\.html?$/i.test(n) ? "html" : /\.json$/i.test(n) ? "json" : ""; };

  function uploadHtml(file) {
    if (file.size > MAX) return Promise.reject(new Error(file.name + " is " + (file.size / 1048576).toFixed(1) + " MB; the limit is " + (MAX / 1048576).toFixed(1) + " MB."));
    say("Uploading " + file.name + "…");
    return file.arrayBuffer().then(function (buf) {
      return api("POST", "/api/resources/" + doc.id + "/file", undefined, buf, { "X-File-Name": encodeURIComponent(file.name) });
    }).then(function (j) {
      var w = $("warnings"); w.innerHTML = "";
      j.warnings.forEach(function (t) { var li = document.createElement("li"); li.textContent = t; w.appendChild(li); });
      var f = j.doc.file;
      $("file-info").textContent = "Version " + f.version + " · " + f.name + " · " + Math.round(f.sizeBytes / 1024) + " KB · just uploaded" +
        (j.scriptHosts.length ? " · scripts from " + j.scriptHosts.join(", ") : "");
      $("tool-preview").hidden = false; $("preview-en").hidden = false; $("preview-es").hidden = false;
      var keepDirty = dirty;
      apply(j, j.warnings.length ? "Uploaded " + file.name + ", with warnings (see the list)." : "Uploaded " + file.name + ".");
      dirty = keepDirty;
      previewLang("en");
      return j;
    });
  }

  function uploadConfig(file, htmlName, fill) {
    say("Reading " + file.name + "…");
    return file.arrayBuffer().then(function (buf) {
      var h = { "X-File-Name": encodeURIComponent(file.name) };
      if (htmlName) h["X-Html-Name"] = encodeURIComponent(htmlName);
      return api("POST", "/api/resources/" + doc.id + "/config", undefined, buf, h);
    }).then(function (j) {
      doc.configs = j.doc.configs;
      showConfigs();
      if (fill && j.fields) fillForm(j.fields);
      showConfigProblems(j.problems);
      banner(file.name, j, fill);
      return j;
    }, function (e) {
      // not JSON at all: nothing stored, nothing filled; say why next to the drop zone
      showConfigProblems((e.data && e.data.problems) || [{ field: "json", message: e.message }]);
      banner(file.name, { problems: (e.data && e.data.problems) || [], fields: null, failed: e.message }, fill);
      say(e.message, "err");
    });
  }

  function handleFiles(list) {
    var files = [].slice.call(list || []);
    if (!files.length) return;
    var bad = files.filter(function (f) { return !kindOf(f.name); });
    if (bad.length) { say("Only .html, .htm and .json files: " + bad.map(function (f) { return f.name; }).join(", "), "err"); return; }
    var groups = {};
    files.forEach(function (f) { var k = stemOf(f.name).toLowerCase(); (groups[k] = groups[k] || {})[kindOf(f.name)] = f; });
    var keys = Object.keys(groups);
    if (keys.length > 1) { say("Drop one tool at a time: these files have different names (" + files.map(function (f) { return f.name; }).join(", ") + ").", "err"); return; }
    if (files.filter(function (f) { return kindOf(f.name) === "html"; }).length > 1 || files.filter(function (f) { return kindOf(f.name) === "json"; }).length > 1) {
      say("Drop one .html and at most one .json.", "err"); return;
    }
    var g = groups[keys[0]], html = g.html, cfg = g.json;
    var hasText = !!(doc.file || $("en-title").value.trim() || $("es-title").value.trim());
    if (html && doc.status === "published" && !confirm("This resource is live. The new tool file goes live right away. Continue?")) return;
    clearConfigProblems();
    if (html && cfg) {
      // a new resource: fill without asking. Replacing: ask (OK = yes, the default)
      var fill = !hasText || confirm("Update the page text from the config?\n\n" + cfg.name + "\n\nOK = yes (recommended). Cancel = replace only the tool; the page text stays as it is.");
      uploadHtml(html).then(function () { return uploadConfig(cfg, html.name, fill); }).catch(fail);
    } else if (html) {
      uploadHtml(html).then(function (j) { if (j.configProblems && j.configProblems.length) showConfigProblems(j.configProblems); }).catch(fail);
    } else {
      // a config alone: updates only the page text (checked against the tool already uploaded, if any)
      uploadConfig(cfg, doc.file && doc.file.name, true).catch(fail);
    }
  }
  drop.addEventListener("click", function (e) { if (e.target.tagName !== "LABEL") input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { var f = input.files; handleFiles(f); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });

  // the config's fields -> the form (same shape as collect())
  function setVal(id, v) { var el = $(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }
  function fillForm(f) {
    ["en", "es"].forEach(function (l) {
      var t = f[l] || {};
      setVal(l + "-title", t.title || "");
      setVal(l + "-description", t.description || "");
      setVal(l + "-intro", t.intro || "");
      setVal(l + "-howTo", (t.howTo || []).join("\n"));
      setVal(l + "-keyIdeas", (t.keyIdeas || []).join("\n"));
      setVal(l + "-keywords", (t.keywords || []).join(", "));
      var slug = $(l + "-slug");
      slug.value = (l === "en" ? f.slugEn : f.slugEs) || "";
      slug.setAttribute("data-auto", slug.value ? "0" : "1");
      var listEl = document.querySelector('.faq-list[data-lang="' + l + '"]');
      listEl.innerHTML = "";
      (t.faq && t.faq.length ? t.faq : [{ q: "", a: "" }]).forEach(function (x) {
        var it = faqItem(); it.querySelector(".faq-q").value = x.q; it.querySelector(".faq-a").value = x.a; listEl.appendChild(it);
      });
    });
    if (f.subject) $("subject").value = f.subject;
    [].forEach.call(form.querySelectorAll('input[name="levels"]'), function (c) { c.checked = (f.levels || []).indexOf(c.value) >= 0; });
    $("courseTags").value = (f.courseTags || []).join(", ");
    [].forEach.call(document.querySelectorAll("textarea[data-math]"), mathPreview);
    checked.checked = false; // the check is about this text: tick it again after reviewing
    dirty = true;
    refresh();
  }

  // problems in place: next to the field they belong to
  var FIELD_EL = function (field) {
    var m = field.match(/^(en|es)\.(\w+)$/);
    if (m) return m[2] === "faq" ? document.querySelector('.faq-list[data-lang="' + m[1] + '"]') : $(m[1] + "-" + m[2]);
    if (field === "en" || field === "es") return document.querySelector('fieldset[data-lang="' + field + '"] legend');
    if (field === "levels") return form.querySelector(".checks");
    if (field === "subject" || field === "courseTags") return $(field);
    return null; // json, version, file: next to the drop zone
  };
  function clearConfigProblems() {
    [].forEach.call(document.querySelectorAll("[data-cfg-err]"), function (el) { el.remove(); });
    [].forEach.call(document.querySelectorAll(".cfg-invalid"), function (el) { el.classList.remove("cfg-invalid"); });
    $("cfg-file-problems").innerHTML = "";
  }
  function showConfigProblems(problems) {
    (problems || []).forEach(function (p) {
      var el = FIELD_EL(p.field);
      var note = document.createElement(el ? "p" : "li");
      note.className = "field-err" + (p.level === "warning" ? " warn" : "");
      note.setAttribute("data-cfg-err", p.field);
      note.textContent = p.message;
      if (p.suggestion) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn btn-small use-suggestion"; b.textContent = "Use " + p.suggestion;
        b.addEventListener("click", function () { var i = FIELD_EL(p.field); i.value = p.suggestion; i.setAttribute("data-auto", "0"); i.dispatchEvent(new Event("input", { bubbles: true })); });
        note.appendChild(document.createTextNode(" ")); note.appendChild(b);
      }
      if (!el) { $("cfg-file-problems").appendChild(note); return; }
      var field = el.closest(".field") || el.closest("fieldset") || el.parentNode;
      field.classList.add("cfg-invalid");
      if (p.level !== "warning") el.classList.add("cfg-invalid");
      field.appendChild(note);
    });
  }
  // editing a field clears its config problem
  form.addEventListener("input", function (e) {
    var field = e.target.closest(".field");
    if (!field || !field.classList.contains("cfg-invalid")) return;
    [].forEach.call(field.querySelectorAll("[data-cfg-err]"), function (n) { n.remove(); });
    field.classList.remove("cfg-invalid"); e.target.classList.remove("cfg-invalid");
  });

  function banner(name, j, filled) {
    var b = $("cfg-banner"), errs = (j.problems || []).filter(function (p) { return p.level !== "warning"; }).length, warns = (j.problems || []).length - errs;
    b.innerHTML = "";
    var p = document.createElement("p");
    if (j.failed) p.textContent = "Couldn't use " + name + ": " + j.failed;
    else if (!j.fields) p.textContent = "Didn't fill the form from " + name + ". See the problem next to the file box.";
    else if (!filled) p.textContent = "Kept " + name + " (download it below the file box). The page text wasn't changed.";
    else {
      p.textContent = "Filled from " + name + ". Review it, tick the check, then publish.";
      if (!doc.file) p.textContent += " Then drop the tool's .html too.";
    }
    b.appendChild(p);
    if (errs || warns) {
      var q = document.createElement("p");
      q.className = "banner-problems";
      q.textContent = (errs ? errs + (errs === 1 ? " problem" : " problems") : "") + (errs && warns ? " and " : "") + (warns ? warns + (warns === 1 ? " note" : " notes") : "") + " marked in red below.";
      b.appendChild(q);
    }
    b.className = "banner" + (j.failed || !j.fields ? " banner-err" : errs ? " banner-warn" : "");
    b.hidden = false;
    b.scrollIntoView({ block: "nearest" });
  }

  function showConfigs() {
    var box = $("configs"), ul = $("config-list");
    ul.innerHTML = "";
    (doc.configs || []).slice().reverse().forEach(function (c) {
      var li = document.createElement("li"), a = document.createElement("a"), s = document.createElement("span");
      a.href = "/download/" + doc.id + "/config/" + c.n; a.setAttribute("download", ""); a.textContent = c.name || ("config-" + c.n + ".json");
      s.className = "hint"; s.textContent = " · for " + (c.file || "?") + " · tool v" + (c.fileVersion || "–") + " · " + c.uploadedAt.slice(0, 16).replace("T", " ") + " UTC";
      li.appendChild(a); li.appendChild(s); ul.appendChild(li);
    });
    box.hidden = !(doc.configs || []).length;
  }

  // live preview language (?lang=es, like the Spanish page)
  function previewLang(l) {
    if (!doc.file) return;
    $("tool-frame").src = "/frame/" + doc.id + "/v" + doc.file.version + (l === "es" ? "?lang=es" : "");
    [].forEach.call(document.querySelectorAll("[data-preview-lang]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-preview-lang") === l ? "true" : "false"); });
  }
  [].forEach.call(document.querySelectorAll("[data-preview-lang]"), function (b) { b.addEventListener("click", function () { previewLang(b.getAttribute("data-preview-lang")); }); });

  refresh();
})();
