#!/usr/bin/env bash
# deploy-db.sh — Rebuild local SQLite from CSVs and deploy to Turso + Vercel.
#
# Usage:
#   bash scripts/deploy-db.sh
#
# What it does:
#   1. Rebuilds staging_formulary.db from all CSVs in data/
#   2. Runs ANALYZE so SQLite statistics are embedded
#   3. Imports to a new timestamped Turso database (zero downtime)
#   4. Verifies row counts in the new DB
#   5. Flips DATABASE_URL in Vercel production and redeploys
#   6. Waits for the deployment to go live
#   7. Smoke-tests the production API
#   8. Deletes the old Turso database
#
# Requirements: turso CLI (~/.turso/turso), vercel CLI (npx vercel), sqlite3, curl, jq

set -euo pipefail

BOLD='\033[1m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; CYAN='\033[36m'; RESET='\033[0m'

log()  { echo -e "${BOLD}${CYAN}▶ $*${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()  { echo -e "${RED}✗ $*${RESET}" >&2; exit 1; }

TURSO="${HOME}/.turso/turso"
PROD_URL="https://inpatient-formulary.vercel.app"
REGION="aws-us-east-1"
ORG="kpessa"

# ── 1. Generate unique DB name ────────────────────────────────────────────────
BASE_NAME="formulary-$(date +%Y%m%d)"
DB_NAME="$BASE_NAME"
# Avoid collision if run multiple times on same day
EXISTING=$("$TURSO" db list 2>/dev/null | awk 'NR>1 {print $1}')
SUFFIX=1
while echo "$EXISTING" | grep -qx "$DB_NAME"; do
  DB_NAME="${BASE_NAME}-$((++SUFFIX))"
done
log "New database name: $DB_NAME"

# ── 2. Build local SQLite ─────────────────────────────────────────────────────
log "Building local SQLite from CSVs..."
pnpm tsx scripts/build_local_sqlite.ts
ok "Build complete: $(du -h data/staging_formulary.db | cut -f1)"

# ── 3. ANALYZE ────────────────────────────────────────────────────────────────
log "Running ANALYZE..."
sqlite3 data/staging_formulary.db "ANALYZE;"
ok "ANALYZE done"

# ── 4. Get current DATABASE_URL (to know which old DB to delete later) ────────
log "Reading current production DATABASE_URL..."
npx vercel env pull /tmp/deploy-db-env.txt --environment production --yes 2>/dev/null | grep -v "^npm warn" || true
OLD_DB_URL=$(grep '^DATABASE_URL=' /tmp/deploy-db-env.txt | cut -d'"' -f2 | tr -d '\n\r')
OLD_DB_NAME=$(echo "$OLD_DB_URL" | sed "s|libsql://||;s|-${ORG}\..*||")
ok "Current DB: $OLD_DB_NAME"

# ── 5. Import to new Turso DB ─────────────────────────────────────────────────
log "Copying SQLite for import..."
cp data/staging_formulary.db "/tmp/${DB_NAME}.db"

log "Importing to Turso (this takes ~1-5 min for large DBs)..."
"$TURSO" db import "/tmp/${DB_NAME}.db"
rm -f "/tmp/${DB_NAME}.db"
ok "Import complete"

# ── 6. Verify new DB ──────────────────────────────────────────────────────────
log "Verifying new database..."
COUNTS=$("$TURSO" db shell "$DB_NAME" "SELECT domain, COUNT(*) as cnt FROM formulary_groups GROUP BY domain ORDER BY domain;" 2>/dev/null)
echo "$COUNTS"
TOTAL=$(echo "$COUNTS" | awk 'NR>1 && /[0-9]/ {sum += $NF} END {print sum}')
[[ "$TOTAL" -gt 0 ]] || die "No rows found in new database — aborting"
ok "Total groups: $TOTAL"

# ── 7. Flip DATABASE_URL in Vercel ────────────────────────────────────────────
NEW_DB_URL="libsql://${DB_NAME}-${ORG}.${REGION}.turso.io"
log "Updating Vercel DATABASE_URL → $NEW_DB_URL"
npx vercel env rm DATABASE_URL production --yes 2>/dev/null | grep -v "^npm warn" || true
printf '%s' "$NEW_DB_URL" | npx vercel env add DATABASE_URL production 2>/dev/null | grep -v "^npm warn" || true
ok "DATABASE_URL updated"

# ── 8. Redeploy (picks up new env var, no file upload) ───────────────────────
log "Triggering Vercel redeploy..."
LATEST_DEPLOY=$(npx vercel ls 2>/dev/null | grep -v "^npm warn" | grep -v "^Retrieving" | grep -v "^Fetching" | grep -v "^>" | grep -v "^  Age" | grep "Ready" | head -1 | awk '{print $3}')
[[ -n "$LATEST_DEPLOY" ]] || die "Could not find latest deployment URL"
npx vercel redeploy "$LATEST_DEPLOY" --prod --no-wait 2>/dev/null | grep -v "^npm warn" || true
ok "Redeploy triggered"

# ── 9. Wait for deployment to go live ────────────────────────────────────────
log "Waiting for deployment to go live..."
ATTEMPTS=0
MAX_ATTEMPTS=24  # 2 minutes max
while [[ $ATTEMPTS -lt $MAX_ATTEMPTS ]]; do
  sleep 5
  STATUS=$(npx vercel ls 2>/dev/null | grep -v "^npm warn" | grep -v "^Retrieving" | grep -v "^Fetching" | grep -v "^>" | grep -v "^  Age" | head -1 | awk '{print $4}')
  echo -n "  status: $STATUS"
  if [[ "$STATUS" == "Ready" ]]; then
    echo ""
    break
  elif [[ "$STATUS" == "Error" ]]; then
    die "Deployment failed with Error status"
  fi
  echo " (waiting...)"
  ATTEMPTS=$((ATTEMPTS + 1))
done
[[ $ATTEMPTS -lt $MAX_ATTEMPTS ]] || die "Deployment did not complete in time"
ok "Deployment is live"

# ── 10. Smoke test production API ─────────────────────────────────────────────
log "Smoke-testing production API..."
sleep 5  # brief grace period for DNS/edge propagation
RESPONSE=$(curl -s --max-time 30 "${PROD_URL}/api/formulary/search?q=acetaminophen&fields=description&limit=3&showInactive=false" 2>/dev/null)
COUNT=$(echo "$RESPONSE" | python3 -c "
import sys, json
total = 0
for line in sys.stdin.read().strip().split('\n'):
    try:
        d = json.loads(line)
        total += len(d.get('results', []))
    except: pass
print(total)
" 2>/dev/null || echo "0")

if [[ "$COUNT" -gt 0 ]]; then
  ok "Smoke test passed — $COUNT results for 'acetaminophen'"
else
  warn "Smoke test returned 0 results — check production before deleting old DB"
  warn "Old DB '$OLD_DB_NAME' has NOT been deleted"
  echo ""
  echo "If production looks good, run:"
  echo "  ~/.turso/turso db destroy $OLD_DB_NAME --yes"
  exit 0
fi

# ── 11. Delete old DB ─────────────────────────────────────────────────────────
if [[ "$OLD_DB_NAME" == "$DB_NAME" ]]; then
  warn "Old and new DB names are the same — skipping delete"
elif [[ -z "$OLD_DB_NAME" ]]; then
  warn "Could not determine old DB name — skipping delete"
else
  log "Deleting old database: $OLD_DB_NAME"
  "$TURSO" db destroy "$OLD_DB_NAME" --yes
  ok "Deleted $OLD_DB_NAME"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Done!${RESET}"
echo -e "  Active DB:  $DB_NAME"
echo -e "  URL:        $NEW_DB_URL"
echo -e "  Production: $PROD_URL"
