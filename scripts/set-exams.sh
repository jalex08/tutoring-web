#!/usr/bin/env bash
# Change the exam calendar (dates, summaries, resources, scores) on josediaztutoring.com:
# no rebuild, no redeploy.
#
#   scripts/set-exams.sh data/exams/2026-27.json
#   scripts/set-exams.sh --create data/exams/2026-27.json        first time only: creates the secret
#                                                                and lets the app read it
#   scripts/set-exams.sh --no-indexnow data/exams/2026-27.json   skip the IndexNow ping (e.g. before
#                                                                the pages are deployed)
#
# 1. Checks the file with scripts/check-exams.js (errors stop here, warnings print) and with the
#    rules the server uses (exam-calendar.js).
# 2. Minifies it and refuses it if it's over 60 KB (Secret Manager's limit is 64 KiB).
# 3. Confirms the target is the tutoring project (jalex-hub), then adds a new version of the
#    secret `site-exams`. Nothing else in the project is touched.
# 4. Pings IndexNow for the four exam pages.
#
# The live pages pick up the new version within ~10 minutes (server cache), and every visitor sees
# it within ~20 minutes (plus 10 minutes of browser cache). Format and workflow: docs/exam-calendar.md.
set -euo pipefail

PROJECT="jalex-hub"   # the tutoring project. Never another one.
SECRET="site-exams"
APP_SA="jalex-hub@appspot.gserviceaccount.com"
MAX_BYTES=60000
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CREATE=0
INDEXNOW=1
FILE=""
for arg in "$@"; do
  case "$arg" in
    --create) CREATE=1 ;;
    --no-indexnow) INDEXNOW=0 ;;
    -*) echo "unknown option $arg" >&2; exit 2 ;;
    *) FILE="$arg" ;;
  esac
done
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: scripts/set-exams.sh [--create] [--no-indexnow] data/exams/<year>.json" >&2
  exit 2
fi

echo "== Checking $FILE"
node "$ROOT/scripts/check-exams.js" "$FILE"   # exits non-zero on errors; warnings only print
node "$ROOT/exam-calendar.js" "$FILE"         # the server's own rules (what the pages need)

TMP="$(mktemp -t site-exams.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT
node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[2], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))));' "$FILE" "$TMP"
BYTES=$(wc -c < "$TMP" | tr -d ' ')
echo "Minified: $BYTES bytes (limit $MAX_BYTES)"
if (( BYTES > MAX_BYTES )); then
  echo "Refused: $BYTES bytes is over the $MAX_BYTES-byte limit for $SECRET. Shorten the file (old changelog entries, notes)." >&2
  exit 1
fi

echo
echo "== Target project"
if [[ "$(gcloud projects describe "$PROJECT" --format='value(projectId)' 2>/dev/null)" != "$PROJECT" ]]; then
  echo "Can't see project $PROJECT with the current gcloud account. Run: gcloud auth login" >&2
  exit 1
fi
ACTIVE="$(gcloud config get-value project 2>/dev/null || true)"
echo "Project: $PROJECT (the tutoring project; every command below passes --project=$PROJECT)"
if [[ -n "$ACTIVE" && "$ACTIVE" != "$PROJECT" ]]; then
  echo "Note: your gcloud default project is $ACTIVE; it's not used here."
fi

echo
if ! gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  if (( CREATE )); then
    echo "== Creating secret $SECRET in $PROJECT"
    gcloud secrets create "$SECRET" --data-file="$TMP" --replication-policy=automatic --project="$PROJECT"
    gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" \
      --member="serviceAccount:$APP_SA" --role=roles/secretmanager.secretAccessor >/dev/null
    echo "Created; the app's service account can read it."
  else
    echo "Secret $SECRET doesn't exist in $PROJECT (or you can't see it). First time: run again with --create." >&2
    exit 1
  fi
else
  if (( CREATE )); then echo "(Secret $SECRET already exists: adding a version.)"; fi
  echo "== Adding a new version of secret $SECRET in project $PROJECT"
  gcloud secrets versions add "$SECRET" --data-file="$TMP" --project="$PROJECT"
fi

if (( INDEXNOW )); then
  echo
  echo "== IndexNow"
  (cd "$ROOT" && node scripts/indexnow.js --urls /exams/ /es/examenes/ /exams/algebra-1-eoc/ /es/examenes/eoc-algebra-1/) || true
fi

echo
node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(`Done: revision ${d.revision}, dates checked ${d.checked} (school year ${d.schoolYear}).`);' "$FILE"
echo "The pages show it within ~10 minutes (server cache); visitors with a page cached see it within ~20."
echo "Check: curl -s https://josediaztutoring.com/exams/data.json | grep -o '\"revision\":[0-9]*'"
