#!/usr/bin/env node
/**
 * Sends ONE English and ONE Spanish client confirmation to a single address,
 * through the real SMTP server, so you can check them in a real inbox.
 * Only the confirmation is sent (not the notification to Jose).
 *
 *   SMTP_HOST=mail.smtp2go.com SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... \
 *   SMTP_FROM='Jose Diaz Tutoring <hello@josediaztutoring.com>' \
 *   node scripts/send-test-email.js you@example.com
 *
 * SMTP_PORT 465 uses implicit TLS; any other port requires STARTTLS.
 * Optional: TEST_NAME (the name typed in the form, default "Jose Diaz").
 */
"use strict";

const nodemailer = require("nodemailer");
const { renderConfirmation } = require("../server.js");

const to = process.argv[2];
const env = (k) => process.env[k] || "";
const missing = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].filter((k) => !env(k));
if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) || missing.length) {
  console.error("Usage: SMTP_HOST=... SMTP_USER=... SMTP_PASS=... SMTP_FROM=... node scripts/send-test-email.js you@example.com");
  if (missing.length) console.error("Missing: " + missing.join(", "));
  process.exit(2);
}

(async () => {
  const port = Number(env("SMTP_PORT")) || 587;
  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST"), port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") }, connectionTimeout: 20000,
  });
  try {
    for (const lang of ["en", "es"]) {
      const m = renderConfirmation(lang, env("TEST_NAME") || "Jose Diaz");
      const info = await transport.sendMail({ from: env("SMTP_FROM"), to, replyTo: env("SMTP_FROM"), ...m });
      console.log(`${lang}: sent "${m.subject}" to ${to} (${info.messageId})`);
    }
  } finally {
    transport.close();
  }
})().catch((err) => {
  console.error("Send failed:", err.message);
  process.exit(1);
});
