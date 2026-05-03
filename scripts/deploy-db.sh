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

# ── 3b. Diff against current production + merge task tables ──────────────────
# Read current prod DB name from .env.local
CURRENT_DB=$(grep '^DATABASE_URL=' .env.local 2>/dev/null | sed 's/.*libsql:\/\///;s/-'"$ORG"'.*//' | tr -d '"')
if [[ -z "$CURRENT_DB" ]]; then
  warn "Could not determine current DB from .env.local — skipping diff + task table merge"
else
  if [[ "${DEPLOY_DB_SKIP_DIFF:-}" == "1" ]]; then
    warn "DEPLOY_DB_SKIP_DIFF=1 — skipping diff (assumes externally validated)"
  else
    log "Diffing new extract against current production ($CURRENT_DB)..."
    # diff_extracts.ts exits non-zero if churn threshold exceeded — set -e halts.
    # Override with: DEPLOY_DB_FORCE=1 bash scripts/deploy-db.sh
    # Bypass entirely with: DEPLOY_DB_SKIP_DIFF=1 bash scripts/deploy-db.sh
    pnpm tsx scripts/diff_extracts.ts "$CURRENT_DB"
  fi

  log "Merging task tables from production..."
  pnpm tsx scripts/merge_task_tables.ts "$CURRENT_DB"
fi

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
# Vercel CLI v53+: stdin-piped env add is unreliable (silently stores empty
# value). Use --value flag for non-interactive set. --no-sensitive keeps it
# readable via `vercel env pull` for local diagnostics.
NEW_DB_URL="libsql://${DB_NAME}-${ORG}.${REGION}.turso.io"
log "Updating Vercel DATABASE_URL → $NEW_DB_URL"
npx vercel env rm DATABASE_URL production --yes 2>&1 | grep -v "^npm warn"
npx vercel env add DATABASE_URL production --value "$NEW_DB_URL" --no-sensitive --yes 2>&1 | grep -v "^npm warn"
ok "DATABASE_URL updated"

# ── 8. Redeploy and wait for it to go live ───────────────────────────────────
# Vercel CLI v53+: --prod was removed from redeploy (use --target). Without
# --no-wait, redeploy blocks until the deployment is aliased — which is
# what we want, so we don't need the brittle polling loop the script used to
# carry (it parsed `vercel ls` columns that have since shifted).
log "Triggering Vercel redeploy..."
LATEST_DEPLOY=$(npx vercel ls 2>&1 | grep -v "^npm warn" | grep "● Ready" | grep "Production" | head -1 | awk '{print $3}')
[[ -n "$LATEST_DEPLOY" ]] || die "Could not find latest production deployment URL"
npx vercel redeploy "$LATEST_DEPLOY" --target production 2>&1 | grep -v "^npm warn"
ok "Deployment is live"

# ── 10. Smoke test production API ─────────────────────────────────────────────
# API response shape: {"fields":{"description":[...]}}.  Older parser checked
# `d.get('results', [])` which always returned 0 — silent false-negative for
# years until we caught it.
log "Smoke-testing production API..."
sleep 5  # brief grace period for DNS/edge propagation
RESPONSE=$(curl -s --max-time 30 "${PROD_URL}/api/formulary/search?q=acetaminophen&fields=description&limit=3&showInactive=false" 2>/dev/null)
COUNT=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    total = sum(len(v) for v in d.get('fields', {}).values())
except: total = 0
print(total)
" 2>/dev/null || echo "0")

if [[ "$COUNT" -gt 0 ]]; then
  ok "Smoke test passed — $COUNT results for 'acetaminophen'"

  # ── 10b. Save staging as last-deployed snapshot (fast next-time diff) ──
  # last_deployed_staging.db is overwritten each deploy and used by
  # compute_extract_changes.ts as the "old" side for the next run's diff.
  # The .meta.json records which run it represents.
  log "Saving staging DB as last-deployed snapshot..."
  cp data/staging_formulary.db data/last_deployed_staging.db
  printf '{"run_id":"%s","saved_at":"%s"}\n' "$DB_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > data/last_deployed_staging.meta.json
  ok "Snapshot saved → data/last_deployed_staging.db (run_id=$DB_NAME)"

  # ── 10b'. Archive snapshot per run_id (for future pair-wise compare) ────
  # Long-term goal is to allow comparing any two extract runs git-commit-style
  # (see project_extract_changeset_viewer.md). The historical record has to
  # start being saved NOW to have history later. ~400MB uncompressed per run;
  # at weekly cadence that's ~20GB/year. Compress with gzip (~80MB → ~4GB/yr)
  # if disk pressure becomes a concern.
  ARCHIVE_DIR="$(pwd)/data/snapshots"
  mkdir -p "$ARCHIVE_DIR"
  ARCHIVE_PATH="${ARCHIVE_DIR}/${DB_NAME}.db"
  if [[ ! -f "$ARCHIVE_PATH" ]]; then
    log "Archiving snapshot for pair-wise compare..."
    cp data/staging_formulary.db "$ARCHIVE_PATH"
    ok "Archived → $ARCHIVE_PATH ($(du -h "$ARCHIVE_PATH" | cut -f1))"
  else
    warn "Archive already exists at $ARCHIVE_PATH — leaving as-is"
  fi

  # ── 10c. Compute per-drug extract changes for /admin/extract-changes ───────
  log "Computing extract changes (admin viewer feed)..."
  pnpm tsx scripts/compute_extract_changes.ts "$DB_NAME"
else
  warn "Smoke test returned 0 results — check production before deleting old DB"
  warn "Old DB '$OLD_DB_NAME' has NOT been deleted"
  echo ""
  echo "If production looks good, run:"
  echo "  ~/.turso/turso db destroy $OLD_DB_NAME --yes"
  exit 0
fi

# ── 11. Update .env.local + restart dev server ───────────────────────────────
log "Updating .env.local..."
ENV_FILE="$(pwd)/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  # Replace DATABASE_URL line in-place (works on both macOS and Linux)
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"${NEW_DB_URL}\"|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  ok "Updated .env.local → $NEW_DB_URL"
fi

log "Restarting local dev server..."
DEV_PID=$(pgrep -f "next dev" 2>/dev/null || true)
if [[ -n "$DEV_PID" ]]; then
  kill "$DEV_PID" 2>/dev/null || true
  sleep 1
  ok "Stopped dev server (PID $DEV_PID)"
  # Restart in background, log to /tmp/next-dev.log
  pnpm dev > /tmp/next-dev.log 2>&1 &
  ok "Dev server restarted on http://localhost:3000 (log: /tmp/next-dev.log)"
else
  warn "No dev server running — start it with: pnpm dev"
fi

# ── 13. Retain old DB for rollback ────────────────────────────────────────────
# Old DB is intentionally NOT auto-deleted — keep it around so rollback stays
# trivial. Destroy it manually once confidence is high, e.g. after 24-48h.
if [[ -z "$OLD_DB_NAME" ]]; then
  warn "Could not determine old DB name — nothing to retain"
elif [[ "$OLD_DB_NAME" == "$DB_NAME" ]]; then
  warn "Old and new DB names are the same — nothing to retain"
else
  ok "Retained old database for rollback: $OLD_DB_NAME"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Done!${RESET}"
echo -e "  Active DB:  $DB_NAME"
echo -e "  URL:        $NEW_DB_URL"
echo -e "  Production: $PROD_URL"

if [[ -n "$OLD_DB_NAME" && "$OLD_DB_NAME" != "$DB_NAME" ]]; then
  OLD_DB_URL_RB="libsql://${OLD_DB_NAME}-${ORG}.${REGION}.turso.io"
  echo ""
  echo -e "${BOLD}Rollback (if needed):${RESET}"
  echo -e "  npx vercel env rm DATABASE_URL production --yes"
  echo -e "  printf '%s' '$OLD_DB_URL_RB' | npx vercel env add DATABASE_URL production"
  echo -e "  npx vercel redeploy \$(npx vercel ls 2>/dev/null | grep Ready | head -1 | awk '{print \$3}') --prod"
  echo -e "  sed -i '' \"s|^DATABASE_URL=.*|DATABASE_URL=\\\"$OLD_DB_URL_RB\\\"|\" .env.local"
  echo ""
  echo -e "${BOLD}Cleanup once confident:${RESET}"
  echo -e "  $TURSO db destroy $OLD_DB_NAME --yes"
fi
