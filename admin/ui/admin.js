/* Resources admin: list page ("New resource") and the editor. No framework, no build step. */
(function () {
  "use strict";
  var msg = document.getElementById("msg");
  function say(text, kind) { if (!msg) return; msg.textContent = text || ""; msg.className = "msg" + (kind ? " " + kind : ""); }

  function api(method, url, body, raw, extraHeaders) {
    var tokenEl = document.querySelector('meta[name="csrf-token"]');
    var opts = { method: method, headers: { "X-JDT-Admin": "1", "X-CSRF-Token": tokenEl ? tokenEl.content : "" }, credentials: "same-origin" };
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
  var doc = data.doc, MAX = data.maxBytes, MAX_FILE = data.maxFileBytes, MAX_FILES = data.maxFiles, PUBLISHED = data.published || [];
  var form = document.getElementById("edit");
  var checked = document.getElementById("checked");
  var $ = function (id) { return document.getElementById(id); };
  var dirty = false;
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };

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
      courseTags: commas($("courseTags").value), related: related.slice() };
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
    files.forEach(function (x) {
      if (!x.path) p.push("PDF " + x.name + " is listed but not uploaded. Drop it, or remove it from Files.");
      if (!x.labelEn || !x.labelEs) p.push("PDF " + x.name + " needs an EN and an ES label.");
    });
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
  window.addEventListener("beforeunload", function (e) { if (dirty || filesDirty) { e.preventDefault(); e.returnValue = ""; } });
  // for the Config (.json) tab (config-editor.js): the form and the JSON edit the same data
  window.JDTAdmin = {
    isDirty: function () { return dirty || filesDirty; },
    // back to the last saved data (the form and the files list)
    discard: function () {
      fillForm(doc); clearConfigProblems(); $("cfg-banner").hidden = true;
      files = clone(doc.files || []); renderFiles(); setFilesDirty(false);
      dirty = false; refresh();
    },
  };

  function apply(j, text) {
    doc = j.doc;
    serverProblems = j.problems || [];
    dirty = false;
    if (!filesDirty) { files = clone(doc.files || []); renderFiles(); }
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
    if (e.data && e.data.stale) {
      // someone saved in between: list what this save would have changed, then offer a reload
      var d = e.data.diff, fields = [];
      if (d) { d.shared.forEach(function (r) { fields.push(r.label); }); d.text.forEach(function (r) { fields.push(r.label + " (" + (r.en && r.es ? "EN, ES" : r.en ? "EN" : "ES") + ")"); }); }
      showProblems(fields.length ? ["Your version differs from the current one in: " + fields.join(", ") + ". Copy what you need, then reload the page."] : ["Reload the page to get the current version."]);
      say(e.message, "err");
      return;
    }
    say(e.message, "err");
    if (e.data && e.data.problems) { serverProblems = e.data.problems; showProblems(e.data.problems); }
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); }

  $("save").addEventListener("click", function () {
    var b = this; busy(b, true); say("Saving…");
    saveFilesIfDirty().then(function () { return api("PUT", "/api/resources/" + doc.id, { doc: collect(), checked: checked.checked, rev: doc.rev }); })
      .then(function (j) { apply(j, doc.status === "published" ? "Saved. The live page updates within about 30 seconds." : "Draft saved."); }, fail)
      .then(function () { busy(b, false); refresh(); });
  });
  $("publish").addEventListener("click", function () {
    var b = this; busy(b, true); say("Publishing (making the preview cards)…");
    saveFilesIfDirty().then(function () { return api("POST", "/api/resources/" + doc.id + "/publish", { doc: collect(), checked: checked.checked, rev: doc.rev }); })
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
  var kindOf = function (n) { return /\.html?$/i.test(n) ? "html" : /\.json$/i.test(n) ? "json" : /\.pdf$/i.test(n) ? "pdf" : ""; };

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

  function uploadConfig(file, htmlName, fill, pdfNames) {
    say("Reading " + file.name + "…");
    return file.arrayBuffer().then(function (buf) {
      var h = { "X-File-Name": encodeURIComponent(file.name) };
      if (htmlName) h["X-Html-Name"] = encodeURIComponent(htmlName);
      if (pdfNames && pdfNames.length) h["X-Pdf-Names"] = pdfNames.map(encodeURIComponent).join("/");
      return api("POST", "/api/resources/" + doc.id + "/config", undefined, buf, h);
    }).then(function (j) {
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
    var all = [].slice.call(list || []);
    if (!all.length) return;
    var bad = all.filter(function (f) { return !kindOf(f.name); });
    if (bad.length) { say("Only .html, .htm, .json and .pdf files: " + bad.map(function (f) { return f.name; }).join(", "), "err"); return; }
    var pdfList = all.filter(function (f) { return kindOf(f.name) === "pdf"; });
    var tool = all.filter(function (f) { return kindOf(f.name) !== "pdf"; });
    var html = null, cfg = null;
    if (tool.length) {
      var groups = {};
      tool.forEach(function (f) { var k = stemOf(f.name).toLowerCase(); (groups[k] = groups[k] || {})[kindOf(f.name)] = f; });
      var keys = Object.keys(groups);
      if (keys.length > 1) { say("Drop one tool at a time: these files have different names (" + tool.map(function (f) { return f.name; }).join(", ") + ").", "err"); return; }
      if (tool.filter(function (f) { return kindOf(f.name) === "html"; }).length > 1 || tool.filter(function (f) { return kindOf(f.name) === "json"; }).length > 1) {
        say("Drop one .html and at most one .json (plus its PDFs).", "err"); return;
      }
      html = groups[keys[0]].html || null; cfg = groups[keys[0]].json || null;
    }
    // a .json alone on a resource that has its tool: into the Config (.json) tab (validate -> diff -> save)
    if (cfg && !html && !pdfList.length && doc.file && window.JDTConfigEditor) { window.JDTConfigEditor.loadFile(cfg); return; }
    var hasText = !!(doc.file || $("en-title").value.trim() || $("es-title").value.trim());
    if (html && doc.status === "published" && !confirm("This resource is live. The new tool file goes live right away. Continue?")) return;
    clearConfigProblems();
    // a new resource: fill without asking. Replacing: ask (OK = yes, the default). A config alone: fill.
    var fill = html && cfg ? (!hasText || confirm("Update the page text from the config?\n\n" + cfg.name + "\n\nOK = yes (recommended). Cancel = replace only the tool; the page text and the files list stay as they are.")) : true;
    var listedByConfig = false;
    var chain = Promise.resolve();
    if (html) chain = chain.then(function () { return uploadHtml(html); }).then(function (j) { if (!cfg && j.configProblems && j.configProblems.length) showConfigProblems(j.configProblems); });
    if (cfg) chain = chain.then(function () { return uploadConfig(cfg, html ? html.name : doc.file && doc.file.name, fill, pdfList.map(function (f) { return f.name; })); }).then(function (j) {
      // the config's "files": its order and labels become the list (uploaded files it doesn't name stay, at the end)
      if (fill && j && j.fields && j.fields.files) { listedByConfig = true; return putFiles(j.fields.files); }
    });
    chain.then(function () { if (pdfList.length || listedByConfig) return uploadPdfs(pdfList, cfg ? cfg.name : ""); }).catch(fail);
  }
  drop.addEventListener("click", function (e) { if (e.target.tagName !== "LABEL") input.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { var f = input.files; handleFiles(f); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });

  // ---- files (PDFs) ----------------------------------------------------------------------------
  // `files` = the list as shown (order, labels), saved with "Save order and labels" (or before Save /
  // Publish). Uploads, replacements and deletes are saved right away, one request per file.
  var files = clone(doc.files || []), filesDirty = false;
  var PDF_NAME = /^(?!\.)[A-Za-z0-9._-]+\.pdf$/;
  var nameProblem = function (n) { return PDF_NAME.test(n) && n.length <= 120 ? "" : n + ": use only letters, numbers, dots, hyphens and underscores, ending in .pdf."; };
  var kb = function (b) { return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(1) + " MB"; };
  var fileHref = function (name) { return "/resources/" + doc.slugEn + "/files/" + encodeURIComponent(name); };
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function setFilesDirty(on) { filesDirty = on; $("files-save").disabled = !on; refresh(); }
  function renderFiles() {
    var ol = $("files-list");
    ol.innerHTML = "";
    $("files-empty").hidden = files.length > 0;
    files.forEach(function (f, i) {
      var li = el("li", { "class": "file-row", "data-name": f.name });
      var head = el("div", { "class": "fr-head" });
      head.appendChild(el("span", { "class": "fr-n" }, (i + 1) + "."));
      if (f.path && doc.slugEn) { var a = el("a", { "class": "fr-name", href: fileHref(f.name), target: "_blank", rel: "noopener" }, f.name); head.appendChild(a); }
      else head.appendChild(el("span", { "class": "fr-name" }, f.name));
      head.appendChild(f.path ? el("span", { "class": "hint" }, kb(f.sizeBytes) + " · uploaded " + String(f.uploadedAt).slice(0, 16).replace("T", " ") + " UTC")
        : el("span", { "class": "badge badge-missing" }, "Not uploaded"));
      li.appendChild(head);
      ["En", "Es"].forEach(function (L) {
        var id = "file-" + i + "-label" + L, wrap = el("div");
        wrap.appendChild(el("label", { "for": id }, "Label " + L.toUpperCase()));
        var inp = el("input", { id: id, "data-label": L, value: f["label" + L] || "" });
        inp.value = f["label" + L] || "";
        inp.addEventListener("input", function () { files[i]["label" + L] = inp.value.trim(); setFilesDirty(true); });
        wrap.appendChild(inp); li.appendChild(wrap);
      });
      var tools = el("div", { "class": "fr-tools" });
      var btn = function (label, fn, extra) { var b = el("button", { type: "button", "class": "btn btn-small" + (extra || "") }, label); b.addEventListener("click", fn); tools.appendChild(b); return b; };
      btn("↑", function () { move(i, -1); }).disabled = i === 0;
      btn("↓", function () { move(i, 1); }).disabled = i === files.length - 1;
      btn(f.path ? "Replace…" : "Upload…", function () { pickFor = f.name; $("pdf-input").click(); });
      btn(f.path ? "Delete" : "Remove", function () { removeFile(f); }, " btn-quiet");
      li.appendChild(tools);
      ol.appendChild(li);
    });
  }
  function move(i, d) { var x = files.splice(i, 1)[0]; files.splice(i + d, 0, x); renderFiles(); setFilesDirty(true); }
  function applyFiles(j) {
    // keep unsaved label / order edits for the files that were already listed
    var local = filesDirty ? files : null;
    doc = j.doc; serverProblems = j.problems || serverProblems;
    files = clone(doc.files || []);
    if (local) {
      var order = local.map(function (f) { return f.name; });
      files.forEach(function (f) { var l = local.filter(function (x) { return x.name === f.name; })[0]; if (l) { f.labelEn = l.labelEn; f.labelEs = l.labelEs; } });
      files.sort(function (a, b) { var ia = order.indexOf(a.name), ib = order.indexOf(b.name); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); });
    }
    renderFiles(); refresh();
    return j;
  }
  function putFiles(list) {
    return api("PUT", "/api/resources/" + doc.id + "/files", { files: list.map(function (f) { return { name: f.name, labelEn: f.labelEn, labelEs: f.labelEs }; }) })
      .then(function (j) { filesDirty = false; $("files-save").disabled = true; return applyFiles(j); });
  }
  function saveFilesIfDirty() { return filesDirty ? putFiles(files) : Promise.resolve(); }
  $("files-save").addEventListener("click", function () {
    var b = this; busy(b, true);
    putFiles(files).then(function () { say("Files saved." + (doc.status === "published" ? " The live page updates within about 30 seconds." : ""), "ok"); }, fail)
      .then(function () { busy(b, false); $("files-save").disabled = !filesDirty; });
  });
  function uploadPdf(file, name, labels) {
    var err = nameProblem(name);
    if (err) return Promise.reject(new Error(err));
    if (file.size > MAX_FILE) return Promise.reject(new Error(file.name + " is " + (file.size / 1048576).toFixed(1) + " MB; the limit is " + Math.round(MAX_FILE / 1048576) + " MB."));
    say("Uploading " + name + "…");
    return file.arrayBuffer().then(function (buf) {
      var h = {};
      if (labels && labels.labelEn) h["X-Label-En"] = encodeURIComponent(labels.labelEn);
      if (labels && labels.labelEs) h["X-Label-Es"] = encodeURIComponent(labels.labelEs);
      return api("POST", "/api/resources/" + doc.id + "/files/" + encodeURIComponent(name), undefined, buf, h);
    }).then(applyFiles);
  }
  function removeFile(f) {
    var live = doc.status === "published" && f.path;
    if (!confirm((f.path ? "Delete " : "Remove ") + f.name + "?" + (live ? "\n\nIt's live: its link (on the page and inside the tool) stops working." : ""))) return;
    api("DELETE", "/api/resources/" + doc.id + "/files/" + encodeURIComponent(f.name)).then(function (j) { applyFiles(j); say("Removed " + f.name + ".", "ok"); }, fail);
  }
  var pickFor = "";
  $("pdf-input").addEventListener("change", function () {
    var f = this.files[0], name = pickFor; this.value = ""; pickFor = "";
    if (!f || !name) return;
    var row = files.filter(function (x) { return x.name === name; })[0];
    if (row && row.path && doc.status === "published" && !confirm("Replace " + name + " on the live page? Its URL stays the same.")) return;
    uploadPdf(f, name).then(function () { say((row && row.path ? "Replaced " : "Uploaded ") + name + (f.name !== name ? " (from " + f.name + ")" : "") + ".", "ok"); }, fail);
  });

  // dropped PDFs vs. the list: same rule as toolconfig.matchFiles (exact names)
  function matchFiles(listed, dropped) {
    return {
      found: listed.filter(function (n) { return dropped.indexOf(n) >= 0; }),
      missing: listed.filter(function (n) { return dropped.indexOf(n) < 0; }),
      extra: dropped.filter(function (n) { return listed.indexOf(n) < 0; }),
    };
  }
  function uploadPdfs(pdfList, cfgName) {
    var byName = {};
    pdfList.forEach(function (f) { byName[f.name] = f; });
    var m = matchFiles(files.map(function (f) { return f.name; }), Object.keys(byName));
    var results = {}; // name -> "" (ok) or an error
    var replacing = m.found.filter(function (n) { return files.some(function (f) { return f.name === n && f.path; }); });
    var skip = replacing.length && doc.status === "published" && !confirm("This resource is live. Replace " + replacing.length + " PDF(s) on the live page? Their URLs stay the same.") ? replacing : [];
    var seq = Promise.resolve();
    m.found.forEach(function (n) {
      if (skip.indexOf(n) >= 0) { results[n] = "kept the current file"; return; }
      seq = seq.then(function () { return uploadPdf(byName[n], n).then(function () { results[n] = ""; }, function (e) { results[n] = e.message; }); });
    });
    return seq.then(function () { showChecklist(m, results, byName, cfgName); });
  }
  function showChecklist(m, results, byName, cfgName) {
    var box = $("files-check");
    box.innerHTML = "";
    var src = cfgName ? "in " + cfgName : "in the list";
    box.appendChild(el("p", {}, "PDFs: " + m.found.filter(function (n) { return results[n] === ""; }).length + " uploaded" +
      (m.missing.length ? ", " + m.missing.length + " listed but not dropped" : "") + (m.extra.length ? ", " + m.extra.length + " not " + src : "") + "."));
    var ul = el("ul");
    files.forEach(function (f) {
      var n = f.name, li = el("li", { "data-check": n });
      if (m.found.indexOf(n) >= 0) li.appendChild(el("span", { "class": results[n] ? "bad" : "ok" }, (results[n] ? "✗ " : "✓ ") + n + (results[n] ? ": " + results[n] : ": uploaded")));
      else if (f.path) li.appendChild(el("span", { "class": "ok" }, "✓ " + n + ": already uploaded"));
      else li.appendChild(el("span", { "class": "bad" }, "✗ " + n + ": listed " + src + " but not dropped. Drop it, or remove it below."));
      ul.appendChild(li);
    });
    m.extra.forEach(function (n) {
      var li = el("li", { "data-check": n, "class": "extra" });
      var bad = nameProblem(n);
      li.appendChild(el("span", { "class": "bad" }, "+ " + n + ": not " + src + (bad ? ". " + bad : ". Add it with these labels:")));
      if (!bad) {
        var row = el("div", { "class": "extra-labels" });
        var guess = n.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
        var en = el("input", { "aria-label": "EN label for " + n, placeholder: "EN label" }), es = el("input", { "aria-label": "ES label for " + n, placeholder: "ES label" });
        en.value = guess; es.value = guess;
        var add = el("button", { type: "button", "class": "btn btn-small" }, "Add");
        add.addEventListener("click", function () {
          add.disabled = true;
          uploadPdf(byName[n], n, { labelEn: en.value.trim(), labelEs: es.value.trim() }).then(function () {
            li.innerHTML = ""; li.appendChild(el("span", { "class": "ok" }, "✓ " + n + ": added"));
          }, function (e) { add.disabled = false; fail(e); });
        });
        row.appendChild(en); row.appendChild(es); row.appendChild(add); li.appendChild(row);
      }
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.hidden = false;
    say(m.missing.some(function (n) { return files.some(function (f) { return f.name === n && !f.path; }); }) || m.extra.length ? "Check the PDF list under Files." : "Files uploaded.", "ok");
  }
  renderFiles();

  // ---- related resources (EN slugs, in order) ---------------------------------------------------
  var related = (doc.related || []).slice();
  function renderRelated() {
    var ol = $("related-list"), sel = $("related-add");
    ol.innerHTML = "";
    related.forEach(function (slug, i) {
      var p = PUBLISHED.filter(function (x) { return x.slugEn === slug; })[0];
      var li = el("li", { "data-slug": slug });
      li.appendChild(el("span", {}, p ? p.title : slug));
      li.appendChild(el("span", { "class": "hint" }, p ? "/" + slug + "/" : "/" + slug + "/ · not published: skipped until it is"));
      [["↑", -1], ["↓", 1]].forEach(function (x) {
        var b = el("button", { type: "button", "class": "btn btn-small btn-quiet", "aria-label": (x[1] < 0 ? "Move up " : "Move down ") + slug }, x[0]);
        b.disabled = i + x[1] < 0 || i + x[1] >= related.length;
        b.addEventListener("click", function () { var v = related.splice(i, 1)[0]; related.splice(i + x[1], 0, v); renderRelated(); dirty = true; refresh(); });
        li.appendChild(b);
      });
      var rm = el("button", { type: "button", "class": "btn btn-small btn-quiet", "aria-label": "Remove " + slug }, "Remove");
      rm.addEventListener("click", function () { related.splice(i, 1); renderRelated(); dirty = true; refresh(); });
      li.appendChild(rm);
      ol.appendChild(li);
    });
    sel.innerHTML = "";
    sel.appendChild(el("option", { value: "" }, "Add a published resource…"));
    PUBLISHED.forEach(function (p) { if (related.indexOf(p.slugEn) < 0) sel.appendChild(el("option", { value: p.slugEn }, p.title + " (" + p.slugEn + ")")); });
  }
  $("related-add").addEventListener("change", function () {
    var v = this.value;
    if (v && related.indexOf(v) < 0) { related.push(v); renderRelated(); dirty = true; refresh(); }
  });
  renderRelated();

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
    $("relatedExamPage").value = f.relatedExamPage || "";
    if (f.related) { related = f.related.slice(); renderRelated(); }
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
    if (field === "subject" || field === "courseTags" || field === "relatedExamPage") return $(field);
    if (field === "related") return $("related-list");
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
    else if (!filled) p.textContent = "Didn't use " + name + ". The page text wasn't changed.";
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
