/**
 * The uploaded tool itself (/frame/<id>/v<N>): headers, the injected prelude, and the upload checks.
 *
 * Isolation does NOT depend on the prelude: it comes from the Content-Security-Policy `sandbox`
 * header (without allow-same-origin), which gives the document an opaque origin even when it is
 * opened directly, plus the parent's <iframe sandbox>. The prelude only keeps tools working inside
 * that sandbox (storage shim) and tells the parent page when the tool's #hash changes (bridge).
 */
"use strict";

// allow-popups-to-escape-sandbox: a tab the tool opens (target="_blank", e.g. its printable PDFs) is an
// ordinary tab, as if the student had clicked a normal link; Chrome won't show a PDF in a sandboxed one.
// The tool itself stays sandboxed. Never add allow-same-origin or allow-top-navigation.
const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock";

const FRAME_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `sandbox ${SANDBOX}; frame-ancestors 'self'`,
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "public, max-age=31536000, immutable", // the version is in the URL
};

// Runs first in the tool's document. ES5, no dependencies, never throws.
const PRELUDE = `(function(){
/* jdt prelude: storage shim + state bridge (added by josediaztutoring.com; the tool runs in a sandbox) */
function mem(){var d=Object.create(null);var api={
  getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},
  setItem:function(k,v){d[String(k)]=String(v);},
  removeItem:function(k){delete d[String(k)];},
  clear:function(){d=Object.create(null);},
  key:function(i){var k=Object.keys(d);return i>=0&&i<k.length?k[i]:null;}};
  Object.defineProperty(api,"length",{get:function(){return Object.keys(d).length;}});
  if(typeof Proxy!=="function")return api;
  return new Proxy(api,{get:function(t,p){return p in t?t[p]:(typeof p==="string"&&Object.prototype.hasOwnProperty.call(d,p)?d[p]:undefined);},
    set:function(t,p,v){if(p in t)return false;d[String(p)]=String(v);return true;},
    deleteProperty:function(t,p){delete d[String(p)];return true;}});}
["localStorage","sessionStorage"].forEach(function(n){var ok=false;
  try{var s=window[n];s.setItem("__jdt__","1");s.removeItem("__jdt__");ok=true;}catch(e){}
  if(!ok){try{Object.defineProperty(window,n,{value:mem(),configurable:true,enumerable:true,writable:true});}catch(e){}}});
var cookieOk=false;try{var c0=document.cookie;cookieOk=true;}catch(e){}
if(!cookieOk){var jar=Object.create(null);try{Object.defineProperty(document,"cookie",{configurable:true,
  get:function(){return Object.keys(jar).map(function(k){return k+"="+jar[k];}).join("; ");},
  set:function(v){var p=String(v).split(";")[0],i=p.indexOf("=");if(i<1)return;var k=p.slice(0,i).trim(),val=p.slice(i+1).trim();
    if(/max-age=0|expires=thu, 01 jan 1970/i.test(String(v)))delete jar[k];else jar[k]=val;}});}catch(e){}}
var P=window.parent,last=null;
function post(type){try{var h=String(location.hash||"");if(h.length>2000)return;if(type==="state"&&h===last)return;last=h;
  if(P&&P!==window)P.postMessage({source:"jdt-tool",type:type,hash:h},"*");}catch(e){}}
window.addEventListener("hashchange",function(){post("state");});
try{["pushState","replaceState"].forEach(function(m){var o=history[m];if(typeof o!=="function")return;
  history[m]=function(){var r=o.apply(this,arguments);post("state");return r;};});}catch(e){}
if(document.readyState==="complete")post("ready");else window.addEventListener("load",function(){post("ready");});
})();`;

const PRELUDE_TAG = `<script>${PRELUDE}</script>`;

/**
 * Puts the prelude first: right after <head ...>, else after <html ...>, else after the doctype,
 * else at the very start. Strips a UTF-8 BOM. Case-insensitive; <header> never counts as <head>.
 */
function inject(html) {
  const s = String(html).replace(/^﻿/, "");
  const after = (m) => s.slice(0, m.index + m[0].length) + PRELUDE_TAG + s.slice(m.index + m[0].length);
  // skip leading comments / doctype when looking for the first real tag
  let m = s.match(/<head(?=[\s>/])[^>]*>/i);
  if (m && !insideComment(s, m.index)) return after(m);
  m = s.match(/<html(?=[\s>/])[^>]*>/i);
  if (m && !insideComment(s, m.index)) return after(m);
  m = s.match(/^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i);
  if (m) return after(m);
  return PRELUDE_TAG + s;
}
function insideComment(s, at) {
  const open = s.lastIndexOf("<!--", at);
  return open >= 0 && s.indexOf("-->", open) > at;
}

// --- upload checks (admin) ----------------------------------------------------------------------
const CDN_HOSTS = new Set([
  "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "code.jquery.com", "cdn.tailwindcss.com", "esm.sh", "cdn.plot.ly", "d3js.org", "cdn.skypack.dev",
  "ajax.googleapis.com", "www.gstatic.com", "polyfill.io",
]);
// hosts that only appear as identifiers (namespaces), never fetched
const IGNORE_HOSTS = new Set(["www.w3.org", "w3.org", "schema.org", "localhost"]);

/** Throws an Error with a plain message if the upload can't be used at all. */
function validateUpload(buf, maxBytes) {
  if (!buf || !buf.length) throw new Error("The file is empty.");
  if (buf.length > maxBytes) throw new Error(`The file is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${(maxBytes / 1048576).toFixed(1)} MB.`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { throw new Error("The file isn't UTF-8 text. Save it as UTF-8 and try again."); }
  if (!/<(!doctype\s+html|html|head|body|script)\b/i.test(text)) throw new Error("This doesn't look like an HTML page (no <html>, <body> or <script> tag).");
  return text.replace(/^﻿/, "");
}

/** Warnings in plain words (they never block the upload). */
function analyze(text, { size = Buffer.byteLength(text) } = {}) {
  const w = [];
  const urls = [...text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)(?::\d+)?/gi)].map((m) => m[1].toLowerCase());
  const scriptHosts = [...new Set([...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))];
  const other = [...new Set(urls.filter((h) => !CDN_HOSTS.has(h) && !IGNORE_HOSTS.has(h)))];
  const network = /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource\s*\(|sendBeacon/.test(text);
  if (other.length && network) w.push(`It may send or load data from other sites: ${other.slice(0, 6).join(", ")}${other.length > 6 ? "…" : ""}. Check that it doesn't need them.`);
  else if (network) w.push("It uses fetch/XMLHttpRequest/WebSocket. Tools should work without calling other services.");
  const nonCdnScripts = scriptHosts.filter((h) => !CDN_HOSTS.has(h));
  if (nonCdnScripts.length) w.push(`It loads scripts from hosts that aren't common CDNs: ${nonCdnScripts.join(", ")}.`);
  for (const m of text.matchAll(/<form\b[^>]*\baction\s*=\s*["']?(https?:)?\/\/([a-z0-9.-]+)/gi)) {
    w.push(`It has a form that sends data to ${m[2].toLowerCase()}.`);
  }
  if (/\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie/.test(text)) w.push("It uses localStorage, sessionStorage, indexedDB or cookies. It won't crash, but nothing is saved between visits.");
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(text)) w.push("No viewport meta tag: it may look tiny on phones.");
  if (size > 1048576) w.push(`It's large (${(size / 1048576).toFixed(1)} MB): slow on mobile data.`);
  if (!/location\.hash|hashchange|replaceState\s*\(\s*[^)]*#/.test(text)) w.push("It doesn't keep its values in the URL #hash, so Copy link will share the default setup only.");
  if (/\b(window\.)?top\.location|parent\.location/.test(text)) w.push("It tries to change the parent page's address; the sandbox blocks that.");
  return [...new Set(w)];
}

/** Script hosts, for the admin's info line. */
const scriptHostsOf = (text) => [...new Set([...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))];

module.exports = { SANDBOX, FRAME_HEADERS, PRELUDE, inject, validateUpload, analyze, scriptHostsOf, CDN_HOSTS };
