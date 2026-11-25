# Tool generation snippet

Paste this into any AI prompt when you create a tool for `/resources/`. It's what the site expects. The
tool runs full screen in a sandboxed iframe (no cookies, no storage, no access to the page around it).
The page's **Copy link** button shares the tool's setup only if the tool keeps its values in the URL #hash.

The admin warns, without blocking, when a file breaks one of these rules.

```text
Build this as ONE self-contained HTML file (inline CSS and JS; libraries from a public CDN
are fine). It will run full screen inside a sandboxed iframe on my tutoring site.

Requirements:
- Works on phones (360 px wide) and desktops. No site header, footer, logo or links to
  other sites. No forms that send data anywhere and no calls to external APIs.
- Keep every adjustable value in the URL hash (for example #angle=30&r=1&unit=deg).
  Read the hash on load; update it with history.replaceState whenever a value changes.
- Don't rely on localStorage, sessionStorage or cookies.
- Language: English by default. If you can, include Spanish UI text too and use it when
  the page URL has ?lang=es (Spanish uses "tú").
- Look: light background; ink blue #1C4C9E for controls and the main curve/vector;
  graphite #232A2A for text; highlighter yellow #F6E15A at most once, for the key result.
  Fonts from Google Fonts: Bricolage Grotesque (headings), Atkinson Hyperlegible (body).
- Every control has a visible label and units; keyboard accessible; touch targets at least
  44 px; respects prefers-reduced-motion.
- Show the math: the formula being used, with the live substituted values, so students see
  why the result is what it is.
- Include a "Reset" button that returns to the default values.
```

## What the site does with the file

- It serves the file at `/frame/<id>/v<N>` with `Content-Security-Policy: sandbox …` (no
  `allow-same-origin`) and `frame-ancestors 'self'`. The tool runs at an opaque origin: it can't read
  the site's cookies, pages or forms, even when opened directly. Other sites can't embed it.
- It adds one small script at the very top of the file:
  - **Storage shim:** `localStorage`, `sessionStorage` and `document.cookie` work in memory, so tools
    that use them don't crash. Nothing is kept between visits.
  - **Bridge:** when the tool's `#hash` changes (`hashchange`, `history.replaceState`/`pushState`), it
    tells the page, which copies the hash into its own address bar. Copy link and the EN/ES switch
    carry it, and opening that link restores the setup.
- The Spanish page loads the same file with `?lang=es`.
- Links the tool opens in a new tab (`target="_blank"`) open as ordinary tabs: the sandbox has
  `allow-popups-to-escape-sandbox`, so a PDF shows in the browser's viewer. The tool itself stays
  sandboxed (no `allow-same-origin`, no `allow-top-navigation`).

## Printable PDFs

A resource can have up to 20 PDFs (10 MB each), served at `/resources/<EN slug>/files/<name>` — the
same URL from the English and the Spanish page. The tool can link to them directly:

```js
const PDF_BASE = location.protocol === "file:" ? "" : "/resources/<EN slug>/files/";
// <a href="${PDF_BASE}My_Unit.pdf" target="_blank" rel="noopener">
```

- Names: letters, numbers, dots, hyphens and underscores, ending in lowercase `.pdf`
  (`PHY2053_Newtons_Laws_Formula_Cards.pdf`). Upper case is kept; two names can't differ only in case.
- The page lists them under "How to use it" ("Printable PDFs" / "PDF para imprimir"): label · size, in
  the config's order, opening in a new tab. Clicks on that list send `resource_file_open`
  (`resource_slug`, `file_name`); clicks inside the tool can't be counted (sandbox).
- The PDFs are `noindex` and not in the sitemap: the page is what should rank.
- In the admin, drop the .html, the .json and every PDF at once. PDFs are matched to the config's
  `files` by exact name; a checklist shows each listed file found or missing, and any dropped PDF the
  config doesn't list (with labels to fill in and an Add button). Publish waits until every listed PDF
  is uploaded. The Files section reorders, relabels, replaces (same URL) and deletes them.

## The config file (`<name>.json`, version 1)

The config is everything a resource's page shows except the HTML tool and the PDF bytes. It's defined by
one JSON Schema, `schemas/resource-config.schema.json` (draft 2020-12), and the admin checks it with that
schema everywhere: the upload of a tool pair, a .json on its own, and the **Config (.json)** tab.

The live config is on the server (Firestore), not in a file. A `.json` is only a way to import or
export it: download the current one from the Config (.json) tab (**Download .json**) before you edit, so
your copy matches the live one. `npm run export-configs` downloads all of them (read-only).

Ask the AI for a second file with the same base name as the tool: `trigonometry-playground.html` and
`trigonometry-playground.json`. Drop both on the admin's file box, at once and in any order. The JSON
fills every field of the page text. Example: `test/fixtures/trigonometry-playground.json`; the live
configs are in `test/fixtures/live-configs/`.

```json
{
  "version": 1,
  "file": "trigonometry-playground.html",
  "subject": "geometry-trig",
  "levels": ["high-school", "college"],
  "courseTags": ["Geometry", "Algebra 2"],
  "relatedExamPage": "/exams/",
  "related": ["projectile-motion-lab", "motion-graphs-lab"],
  "files": [
    { "file": "My_Unit_1.pdf", "en": "Unit 1: vectors", "es": "Unidad 1: vectores" }
  ],
  "en": {
    "title": "…", "slug": "…", "description": "… (155 characters max)",
    "intro": "First paragraph.\n\nSecond paragraph.",
    "howTo": ["Step one.", "Step two.", "Step three."],
    "keyIdeas": ["$\\sin^2\\theta + \\cos^2\\theta = 1$", "…", "…"],
    "faq": [{ "q": "…", "a": "…" }, { "q": "…", "a": "…" }, { "q": "…", "a": "…" }],
    "keywords": ["…", "…", "…", "…", "…"]
  },
  "es": { "the same keys": "…" }
}
```

| Field | Required | Rules |
|---|---|---|
| `version` | yes | `1`. Read-only. |
| `file` | yes | The tool's `.html` name (`""` before one is uploaded). Read-only: to change the tool, use Replace file. |
| `subject` | yes | algebra, geometry-trig, precalc, calculus, physics, circuits, digital-logic, programming, embedded, other |
| `levels` | yes | 1–3 of high-school, college, engineering |
| `courseTags` | yes (may be `[]`) | Up to 20, one line each, no commas |
| `relatedExamPage` | no | `/exams/` or `/exams/algebra-1-eoc/` (the "See also" link) |
| `related` | no | Up to 10 EN slugs, in display order (below) |
| `files` | no | The resource's uploaded PDFs, in display order, each `{ "file", "en", "es" }` (below) |
| `en`, `es` | yes | The same 8 keys in each, all required: |
| `.title` | | 1–200 characters |
| `.slug` | | lowercase letters, numbers and single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique across every resource's current and old slugs |
| `.description` | | 1–155 characters (search results) |
| `.intro` | | a blank line (`\n\n`) between paragraphs |
| `.howTo` | | 3–6 steps, one line each |
| `.keyIdeas` | | 3–5, one line each; every `$…$` must render with KaTeX |
| `.faq` | | 3–5 `{ "q", "a" }` |
| `.keywords` | | 5–8, no commas |

Any text may use `$…$` (inline) or `$$…$$` (display) math; `\$` is a literal dollar sign. Unknown keys
are errors (a typo like `keyIdea` would otherwise lose that text). A key left out of the optional ones
means "none": no `related` clears the list, no `relatedExamPage` removes the link.

### Checks

First the schema; once it passes, the cross-checks. Errors block saving; warnings don't. Every message
names the field path, in plain words, and the editor jumps to its line:
`es.description is 171 characters; max 155.`

- **Errors:** anything the schema rejects (missing or unknown fields, counts, lengths, values); a slug
  that's reserved or already used (current or old slug of another resource; a free `slug-2` is
  suggested); `related` listing this resource itself; a `files` entry that isn't uploaded for this
  resource, or (in the editor) an uploaded PDF missing from `files`; a `$…$` in `keyIdeas` KaTeX can't
  render (with KaTeX's message); a `file` or `version` other than the resource's.
- **Warnings:** a `related` slug no resource has (yet), or one that isn't published, or an old slug;
  EN and ES with a different number of `howTo`, `keyIdeas` or `faq` items.

### Related resources (`related`)

Optional: EN slugs of other resources, in the order to show them. Store the slug you see in the URL; a
renamed resource is still found through its old slugs. Links work in both directions: listing B on A also
shows A on B's page (if B has room). Each page shows up to 3, picked in this order:

1. its own `related`, in order;
2. reverse links: published resources whose `related` names this one (current or old slug), newest first;
3. resources sharing at least one course tag, most shared first, then newest;
4. the same subject, newest first.

Unpublished resources, the resource itself and duplicates are skipped. The Spanish page shows the same
resources with their Spanish titles and `/es/recursos/` links.

### PDFs (`files`)

Optional: the printable PDFs, in display order, each with an EN and an ES label (see "Printable PDFs").
The config sets their order and labels only. The PDFs themselves are uploaded (drop them with the tool,
or in the Files section) and deleted in the admin. In the Config (.json) tab, `files` must list exactly
the uploaded PDFs. When a tool pair is uploaded, PDFs dropped with it count as present.

### In the admin

- **A tool pair (.html + .json):** the .json fills the form (problems shown next to each field); Save or
  Publish saves it. Replacing a live tool with a new pair asks "Update the page text from the config?".
- **A .json on its own, on an existing resource:** opens the **Config (.json)** tab with it loaded (not
  saved). From there it goes through the same steps as any edit.
- **Config (.json) tab:** the current config in a code editor. Validate (also ~0.5 s after you stop
  typing); click a problem to jump to its line. **Save** is off while there are errors; it shows every
  changed field (EN and ES side by side, changes highlighted) and asks for confirmation. On a published
  resource it asks for "I checked the formulas and the Spanish" again; the page updates within ~30 s. A
  slug change says the old URL will 301 to the new one (tell Search Console). **Download .json** saves the
  current config; **Upload .json** loads a file into the editor without saving.
- **History:** every save (form, JSON tab, .json upload, tool upload, PDF changes) keeps the previous
  config: when, who, from where. The last 20 are listed with **View diff** and **Restore** (Restore loads
  it into the editor; then the same validate → diff → confirm).
- **Two tabs or devices:** a save carries the version it started from. If someone saved since, it's
  refused and shows the difference from the current version.
- The form and the JSON tab edit the same data; switching with unsaved changes asks first.
