# Exam calendar

Four pages, built from one JSON file per school year:

| Page | English | Spanish |
|---|---|---|
| Exam calendar (hub) | `/exams/` | `/es/examenes/` |
| Algebra 1 EOC guide | `/exams/algebra-1-eoc/` | `/es/examenes/eoc-algebra-1/` |

Everything that changes during the year (dates, grade-by-grade summaries, free resources,
passing scores, pass rates, field notes, sources) lives in the data. **Updating it needs no
rebuild and no redeploy**, exactly like the prices.

## How the data flows

```
data/exams/2026-27.json  ──(scripts/set-exams.sh)──▶  Secret Manager: site-exams (latest version)
        │                                                      │
        │ npm run build: checked, then written into            │ server.js reads it, cached 10 min
        ▼ each page template as the fallback copy              ▼
www/exams.html, www/exams/algebra-1-eoc.html,  ──▶  exam-calendar.js fills the {{x:…}} tokens and the
www/es/examenes.html, www/es/examenes/…           <script id="exam-data"> block, for today in Florida
                                                                │
                                                                ▼
                                    /exams/ … (HTML, 10-min cache)    /exams/data.json (same data)
                                                                │
                                                                ▼
                                    pages/exams/exams.js in the browser: grade picker, year graph,
                                    "Coming up", .ics, score checker, Summarize with Claude
```

- **Templates.** `pages/exams/hub.html` and `pages/exams/algebra-1-eoc.html` (English, with
  `data-i18n` keys; Spanish in `i18n/es.js`, keys `ex*` and `eg*`), plus `pages/exams/exams.css`
  and `pages/exams/exams.js`, are built by `scripts/build.js` into self-contained pages with the
  site's header, footer, GTM and WhatsApp button. Don't edit the `www/` output.
- **Server-rendered content.** Every `{{x:name}}` token is filled by `exam-calendar.js` at request
  time: the school year, the checked date, passing scores (`{{x:cut.sat}}` …), pass rates, the
  hub's "All exams" list and full date list, and the guide's status line, next window, windows,
  field notes, resources, sources, score list and ruler. So the pages work without JavaScript
  and search engines see the real content. The script then replaces those containers with the
  interactive versions. Date math on the server uses today in America/New_York.
- **Date notice.** `notice` in the data (EN/ES): `short` (top band), `title` + `body` + `report`
  (the "A note about these dates" box), `checker` (under the score checker), `claude` (under
  "Summarize with Claude") and `ics` (added to every downloaded calendar file). The server renders
  them into `data-notice` slots; if the data has no `notice`, `NOTICE_FALLBACK` in
  `exam-calendar.js` is used. The WhatsApp/Email links after `report` come from `CONFIG` in
  `www/index.html` at build time (no Email link if `CONFIG.email` isn't set).
- **Strings.** `STRINGS` in `exam-calendar.js` is the only copy of the EN/ES interface text
  ("Testing window", "opens in 11 days" …); the build writes it into the page script.
- **Fallback.** If `site-exams` is missing, unreadable or invalid, the server uses the data built
  into the templates (the file named by `EXAM_DATA` in `scripts/build.js`) and logs an `Exams: …`
  warning. A failed refresh after a good read keeps the last good data. If filling a page ever
  fails, the template is sent as is; the script still renders everything from its built-in data.
- **Monitoring copy.** `/exams/data.json` serves the data the pages are using right now
  (`Cache-Control: public, max-age=600`, `X-Robots-Tag: noindex`). Compare its `revision` with
  the latest approved file.

## Update dates or content (no redeploy)

1. Edit the JSON (for this year: `data/exams/2026-27.json`). Bump `revision` by 1, set `checked`
   to today if you re-checked the dates, add a `changelog` line.
2. Check it:

   ```bash
   node scripts/check-exams.js data/exams/2026-27.json              # structure, EN/ES text, ids, freshness
   node scripts/check-exams.js data/exams/2026-27.json --links      # also opens every URL
   node scripts/check-exams.js data/exams/2026-27.json --today=2027-06-01   # as if it were that day
   ```

   Errors stop everything; warnings (dates marked "confirm with your school", checks older
   than 150 days, fewer than 75 days of dates left) only print. Some sites block bots: a 403 or
   429 from `--links` is a warning; open the link in a browser before changing it.
3. Send it:

   ```bash
   scripts/set-exams.sh data/exams/2026-27.json
   ```

   It runs both checks, minifies the file, refuses it over 60 KB (Secret Manager's limit is
   64 KiB), confirms the project is `jalex-hub`, adds a new version of `site-exams`, and pings
   IndexNow for the four pages. It prints the `revision` and `checked` date at the end.
   The pages change within ~10 minutes (server cache), ~20 for visitors with a cached page.
4. Commit the JSON so the repo matches the live secret. The next deploy then also refreshes
   the bundled fallback; until then the fallback is the older revision, which is fine.

First time only: `scripts/set-exams.sh --create data/exams/2026-27.json` creates the secret and
lets the app's service account read it. Use `--no-indexnow` when the pages aren't deployed yet.

Try a file locally without touching the secret:

```bash
EXAMS_FILE=my-copy.json npm run dev      # http://localhost:8080/exams/ ; re-read when the file changes
```

Test any day in the browser: `?debug=1&today=2027-05-12`. Pre-select a grade: `?for=g11`
(`ms`, `g9` … `g12`, `college`).

## Start next year's file

1. Copy this year's file to `data/exams/2027-28.json`. Set `schoolYear` to `"2027-28"`, `range`
   to Aug 1 – Jul 31, `revision` back to 1, a fresh `changelog`, and `nextYear` to 2028-29.
2. Replace every date from the official source listed for it in `sources` (FDOE's statewide
   assessment schedule, College Board SAT and AP pages, ACT, each registrar). Update `checked`
   on each event you verified and the top-level `checked`. Keep `verify: true` on anything
   the source marks as tentative.
3. Update `algebra1Requirement`, `stats` (new results each summer; the page text "spring 2026"
   is in the template, so a new results year also needs a template edit) and the resource
   `checked` dates.
4. `node scripts/check-exams.js data/exams/2027-28.json --links`, then
   `scripts/set-exams.sh data/exams/2027-28.json`. The pages switch years with no deploy
   (titles and headings take the year from the data).
5. At the next deploy, change `EXAM_DATA` in `scripts/build.js` to the new file so the fallback
   is the new year, and update the year mentions in `www/llms.txt` (hand-written).

## When a deploy IS needed

- Template or layout changes: anything in `pages/exams/`, or text that isn't in the data
  (headings, FAQ, "At a glance", the stat sentence).
- A new guide page (see below).
- A new bundled fallback file (`EXAM_DATA`).
- New interface strings (`STRINGS` in `exam-calendar.js`).

Deploy the usual way: `npm run build` → `gcloud app deploy app.yaml --project=jalex-hub` →
confirm 100% traffic → `npm run indexnow` → commit `seo/published-pages.json` + `www/sitemap.xml`.

## Make another guide live (e.g. the Geometry EOC)

1. Add `pages/exams/<page>.html` (copy `algebra-1-eoc.html`; `<meta name="exam" content="geo">`
   sets `<body data-exam>`) and its Spanish keys in `i18n/es.js`.
2. Add it to `EXAM_PAGES` in `scripts/build.js` and in `server.js`, and the sources list to
   `GUIDE_SOURCES` in `exam-calendar.js`. The exam needs `windows` (events with a `short` name).
3. Build, test (`npm test`), deploy.
4. Then set `pageLive: true` for that exam in the data and send it with `set-exams.sh`: the
   "Read the guide" links appear on the hub. Never set `pageLive` before the page is deployed
   (the link would 404). There is no "coming soon" state.

## Analytics

`exams.js` pushes one event, `select_content` (no new tags or scripts), with
`content_type`, `content_id` and `page_language`:

| `content_type` | When | `content_id` |
|---|---|---|
| `exam_grade` | a grade chip is picked | `ms`, `g9` … `g12`, `college`, `all` |
| `exam_filter` | a "Coming up" filter chip is picked | `all`, `state`, `satact`, `ap`, `college` |
| `exam_calendar_add` | "Add to calendar" (.ics made in the browser) | the event id, e.g. `sat-dec` |
| `exam_resource` | a free-resource link is opened | the resource id, e.g. `bluebook` |
| `score_check` | "Check score" is pressed | the test id only (`alg1`, `sat` …), **never the score** |
| `summarize_claude` | "Summarize with Claude" is opened | the exam id, e.g. `alg1` |

Nothing typed into the score checker leaves the page. The .ics file is generated in the
browser; claude.ai and wa.me are plain outbound links (the Claude link carries only the page's
"short version" bullets and its URL, which are public page text).
