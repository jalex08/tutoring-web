# josediaztutoring.com

Static one-page site (EN/ES) served from Google App Engine standard.
There is no server code: every URL is matched by a static handler in `app.yaml`,
so App Engine never starts an instance.

```
app.yaml        App Engine config (handlers, caching, security headers, scaling)
.gcloudignore   uploads only app.yaml and www/
www/
  index.html    the whole site: HTML, CSS, JS and the photo (base64) in one file
  og-image.png  1200x630 link-preview image (WhatsApp, Facebook, LinkedIn)
  robots.txt
  sitemap.xml
```

## Editing the site

1. Edit `www/index.html`.
2. Deploy (always check the project first; it must be `josediaz-tutoring`, never the GetEmbedded project):

   ```bash
   gcloud config get-value project
   ```

   ```bash
   gcloud app deploy app.yaml --project=josediaz-tutoring
   ```

The homepage is cached for 10 minutes, so changes show up within ~10 min
(hard-refresh to see them sooner). `og-image.png` is cached for 7 days; if you
replace it, rename it (e.g. `og-image-2.png`) and update the three meta tags
and the handler in `app.yaml`, or WhatsApp/Facebook will keep the old one.

## CONFIG (email, WhatsApp, LinkedIn)

Near the bottom of `www/index.html`, inside the `<script>` block:

```js
const CONFIG = {
  email: "...",       // where booking requests go (the form opens a mailto: to this)
  whatsapp: "...",    // country code + number, digits only
  linkedin: "..."     // LinkedIn profile URL
};
```

## Caching and headers

| Path | Cache | Notes |
|---|---|---|
| `/` and any unknown URL | 10 min | unknown URLs serve the homepage (canonical tag points to `/`) |
| `/og-image.png` | 7 days | |
| `/robots.txt`, `/sitemap.xml` | 10 min | |

Every handler: `secure: always` (HTTP → 301 to HTTPS), `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
There is deliberately **no Content-Security-Policy**: the page uses inline
`<script>`/`<style>` and Google Fonts, and a strict CSP would break the language
toggle, the form and the WhatsApp button.

## Google Cloud

- Project: `josediaz-tutoring` (separate from GetEmbedded)
- App Engine region: `us-east1` (permanent)
- Default URL: https://josediaz-tutoring.ue.r.appspot.com

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

Confirm against `gcloud app domain-mappings describe josediaztutoring.com --project=josediaz-tutoring`,
which prints the authoritative records.

`josediaz.academy` → 301 redirect to `https://josediaztutoring.com` via the
registrar's URL forwarding (App Engine can't redirect by hostname without code).
