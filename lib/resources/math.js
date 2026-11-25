/**
 * Text with LaTeX -> HTML, server-side (KaTeX), so the resource pages need no math script.
 * In the admin text fields: $...$ = inline math, $$...$$ = display math, \$ = a literal dollar sign.
 * Everything else is plain text (escaped). A formula KaTeX can't parse is shown as red source text
 * (throwOnError: false) and listed by mathErrors() so the admin can flag it before publishing.
 */
"use strict";

const katex = require("katex");

const KATEX_VERSION = require("katex/package.json").version;
// served by the site itself (resources.js: /resources/katex/<version>/...), from node_modules/katex/dist
const KATEX_CSS = `/resources/katex/${KATEX_VERSION}/katex.min.css`;

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Splits text into [{ text } | { math, display }] parts. */
function parts(src) {
  const out = [];
  let buf = "", i = 0;
  const s = String(src || "");
  while (i < s.length) {
    if (s[i] === "\\" && s[i + 1] === "$") { buf += "$"; i += 2; continue; }
    if (s[i] === "$") {
      const display = s[i + 1] === "$";
      const open = display ? 2 : 1;
      let j = i + open, found = -1;
      while (j < s.length) {
        if (s[j] === "\\") { j += 2; continue; }
        if (s[j] === "$" && (!display || s[j + 1] === "$")) { found = j; break; }
        j++;
      }
      const math = found > 0 ? s.slice(i + open, found) : "";
      if (found > 0 && math.trim()) {
        if (buf) out.push({ text: buf });
        buf = "";
        out.push({ math, display });
        i = found + open;
        continue;
      }
    }
    buf += s[i++];
  }
  if (buf) out.push({ text: buf });
  return out;
}

const hasMath = (s) => parts(s).some((p) => p.math !== undefined);

/** One line of text -> HTML (math rendered, the rest escaped). */
function inline(src) {
  return parts(src)
    .map((p) => (p.math === undefined ? escapeHtml(p.text) : katex.renderToString(p.math, { displayMode: p.display, throwOnError: false, trust: false, output: "htmlAndMathml", strict: "ignore" })))
    .join("");
}

/** Multi-paragraph text (blank line = new paragraph; single newlines -> <br>) -> <p>s. */
function paragraphs(src) {
  return String(src || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split("\n").map(inline).join("<br>")}</p>`)
    .join("\n");
}

/** Plain text for meta tags and JSON-LD: the formulas' LaTeX without the dollar signs. */
function plain(src) {
  return parts(src).map((p) => (p.math === undefined ? p.text : p.math.trim())).join("").replace(/\s+/g, " ").trim();
}

/** Formulas KaTeX can't parse: [{ math, error }]. */
function mathErrors(src) {
  const out = [];
  for (const p of parts(src)) {
    if (p.math === undefined) continue;
    try { katex.renderToString(p.math, { displayMode: p.display, throwOnError: true, trust: false, strict: "ignore" }); }
    catch (e) { out.push({ math: p.math, error: String(e.message || e).replace(/^KaTeX parse error: /, "") }); }
  }
  return out;
}

module.exports = { KATEX_VERSION, KATEX_CSS, escapeHtml, parts, hasMath, inline, paragraphs, plain, mathErrors };
