#!/usr/bin/env bash
# Change the prices on josediaztutoring.com: no rebuild, no redeploy.
#
#   scripts/set-pricing.sh pricing.json
#
# 1. Validates the file with the same rules the server uses (pricing.js) and
#    prints what the page will show. An invalid file is refused: nothing is sent.
# 2. Adds it as a new version of the secret `site-pricing` (project jalex-hub only).
# 3. Pings IndexNow for / and /es/.
#
# The live pages pick up the new version within ~10 minutes (server cache), and
# every visitor sees it within ~20 minutes (plus 10 minutes of browser cache).
# Format: see README.md, "Prices".
set -euo pipefail

PROJECT="jalex-hub"   # the tutoring project. Never another one.
SECRET="site-pricing"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: scripts/set-pricing.sh pricing.json" >&2
  exit 2
fi
FILE="$1"

echo "== Checking $FILE"
node "$ROOT/pricing.js" "$FILE"   # exits non-zero (and prints every problem) if invalid

echo
echo "== Adding a new version of secret $SECRET in project $PROJECT"
if ! gcloud secrets describe "$SECRET" --project="$PROJECT" >/dev/null 2>&1; then
  echo "Secret $SECRET doesn't exist in $PROJECT (or you can't see it). Create it first (README.md, \"Prices\")." >&2
  exit 1
fi
gcloud secrets versions add "$SECRET" --data-file="$FILE" --project="$PROJECT"

echo
echo "== IndexNow"
(cd "$ROOT" && node scripts/indexnow.js --urls / /es/)

echo
echo "Done. The site shows the new prices within ~10 minutes (server cache); visitors with the page cached see them within ~20."
