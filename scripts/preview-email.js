#!/usr/bin/env node
/**
 * Renders the client confirmation email in both languages with sample data,
 * exactly as server.js sends it. Nothing is sent.
 *
 *   npm run preview-email                 -> /tmp/preview-en.html, /tmp/preview-es.html
 *   npm run preview-email -- "Ana María"  -> with that name in the form's name field
 *   npm run preview-email -- ""           -> the no-name version
 */
"use strict";

const fs = require("node:fs");
const { renderConfirmation } = require("../server.js");

const name = process.argv.length > 2 ? process.argv[2] : "María José O'Neil-Pérez";
for (const lang of ["en", "es"]) {
  const m = renderConfirmation(lang, name);
  const out = `/tmp/preview-${lang}.html`;
  fs.writeFileSync(out, m.html);
  console.log(`${out}\n  Subject: ${m.subject}\n  --- text part ---\n  ${m.text.trimEnd().split("\n").join("\n  ")}\n`);
}
