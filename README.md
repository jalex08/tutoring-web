# josediaztutoring.com

One-page site (EN/ES) on Google App Engine standard. The pages are static
files; the only code is `main.py`, which receives the booking form
(`POST /api/contact`) and sends two emails through Gmail: the request to Jose
(Reply-To = the client) and a fixed confirmation to the client.

```
app.yaml          App Engine config (handlers, caching, security headers, scaling)
main.py           booking-form endpoint (Flask)
requirements.txt  Python dependencies for main.py
.gcloudignore     uploads only app.yaml, main.py, requirements.txt and www/
www/
  index.html    the whole site: HTML, CSS, JS and the photo (base64) in one file
  og-image.png  1200x630 link-preview image (WhatsApp, Facebook, LinkedIn)
  robots.txt
  sitemap.xml
```

## Editing the site

1. Edit `www/index.html`.
2. Deploy (always check the project first; it must be `jalex-hub`):

   ```bash
   gcloud config get-value project
   ```

   ```bash
   gcloud app deploy app.yaml --project=jalex-hub
   ```

The homepage is cached for 10 minutes, so changes show up within ~10 min
(hard-refresh to see them sooner). `og-image.png` is cached for 7 days; if you
replace it, rename it (e.g. `og-image-2.png`) and update the three meta tags
and the handler in `app.yaml`, or WhatsApp/Facebook will keep the old one.

## CONFIG (WhatsApp, LinkedIn)

Near the bottom of `www/index.html`, inside the `<script>` block:

```js
const CONFIG = {
  whatsapp: "...",    // country code + number, digits only
  linkedin: "..."     // LinkedIn profile URL
};
```

The form's on-page messages (sending / sent / failed) are in `FORM_MSG` just
below the Spanish translations.

## Booking form (email)

Mail is sent from a Gmail account using an App Password. Credentials are in
Secret Manager, never in this repo:

| Secret | Value |
|---|---|
| `smtp-user` | the Gmail address that sends the mail; requests go here too |
| `smtp-password` | a 16-character Gmail App Password for that account |
| `owner-email` | optional: send requests to this address instead |

Change the password (e.g. after revoking an App Password):

```bash
printf '%s' 'NEW-APP-PASSWORD' | gcloud secrets versions add smtp-password --data-file=- --project=jalex-hub
```

Then redeploy, or wait for the instance to restart, since secrets are cached in memory.

Abuse protection: a hidden honeypot field, max 3 requests per visitor per hour
and 40 per day in total, and the client confirmation never repeats the free-text
message (so the form can't be used to send arbitrary text to someone).
Delivery failures are in Logs Explorer (search "Failed to send booking email").

Edit the email wording in `CONFIRM` and `LABELS` in `main.py`.

## Caching and headers

| Path | Cache | Notes |
|---|---|---|
| `/` and any unknown URL | 10 min | unknown URLs serve the homepage (canonical tag points to `/`) |
| `/og-image.png` | 7 days | |
| `/robots.txt`, `/sitemap.xml` | 10 min | |
| `/api/*` | never | handled by `main.py` |

Every handler: `secure: always` (HTTP → 301 to HTTPS), `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
There is deliberately **no Content-Security-Policy**: the page uses inline
`<script>`/`<style>` and Google Fonts, and a strict CSP would break the language
toggle, the form and the WhatsApp button.

## Google Cloud

- Project: `jalex-hub`
- App Engine region: `us-east1` (permanent)

## Custom domain / DNS

`josediaztutoring.com` and `www.josediaztutoring.com` are mapped in
App Engine → Settings → Custom domains, with Google-managed SSL.

DNS at the registrar for josediaztutoring.com:

| Host | Type | Value |
|---|---|---|
| `@` | A | 216.239.32.21 |
| `@` | A | 216.239.34.21 |
| `@` | A | 216.239.36.21 |
| `@` | A | 216.239.38.21 |
| `@` | AAAA | 2001:4860:4802:32::15 |
| `@` | AAAA | 2001:4860:4802:34::15 |
| `@` | AAAA | 2001:4860:4802:36::15 |
| `@` | AAAA | 2001:4860:4802:38::15 |
| `www` | CNAME | ghs.googlehosted.com. |
| `@` | TXT | `google-site-verification=…` (from Search Console; keep it) |

Confirm against `gcloud app domain-mappings describe josediaztutoring.com --project=jalex-hub`,
which prints the authoritative records.

`josediaz.academy` → 301 redirect to `https://josediaztutoring.com` via the
registrar's URL forwarding (App Engine can't redirect by hostname without code).
