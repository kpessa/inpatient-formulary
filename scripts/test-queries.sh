#!/usr/bin/env bash
# Test search API response times for representative query types.
#
# Usage:
#   bash scripts/test-queries.sh              # hits localhost:3000
#   bash scripts/test-queries.sh prod         # hits DATABASE_URL host via Vercel (set BASE_URL)
#
# Requirements: curl, jq

BASE_URL="${BASE_URL:-http://localhost:3000}"

# curl timing format — prints wall time, connect time, and time-to-first-byte
TIMING='\n  connect: %{time_connect}s  ttfb: %{time_starttransfer}s  total: %{time_total}s\n'

# ─── colours ────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

run_query() {
  local label="$1"
  local url="$2"
  local description="$3"

  echo ""
  echo -e "${BOLD}${CYAN}── ${label}${RESET}"
  echo -e "   ${description}"
  echo -e "   ${url}"
  echo ""

  # Capture body and timing separately
  body=$(curl -s "$url")
  timing=$(curl -s -o /dev/null -w "$TIMING" "$url")

  # Parse each NDJSON line
  local total_results=0
  local db_ms=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    field=$(echo "$line" | jq -r '.field // "—"')
    count=$(echo "$line" | jq -r '.rawCount // (.results | length) // 0')
    ms=$(echo "$line" | jq -r '.ms // "—"')
    first=$(echo "$line" | jq -r '.results[0].description // .results[0].genericName // "—"' 2>/dev/null)
    total_results=$((total_results + count))
    db_ms=$ms

    if [[ "$field" == "—" ]]; then
      total=$(echo "$line" | jq -r '.total // "—"')
      echo -e "   ${GREEN}total:${RESET} $total results  ${GREEN}db:${RESET} ${ms}ms"
    else
      echo -e "   ${GREEN}field=${field}${RESET}  count=${count}  db=${ms}ms  first=\"${first}\""
    fi
  done <<< "$body"

  echo -e "${YELLOW}${timing}${RESET}"
}

echo -e "${BOLD}PharmNet Search API — query benchmarks${RESET}"
echo -e "Target: ${BASE_URL}"
echo -e "Time: $(date)"

# ─── 1. Drug name: text query → description + generic_name + brand_name + mnemonic ───
run_query \
  "Drug name — acetaminophen" \
  "${BASE_URL}/api/formulary/search?q=acetaminophen&fields=description,generic_name,brand_name,mnemonic&limit=50&showInactive=false" \
  "Text query → UNION ALL over 4 indexed columns"

# ─── 2. CDM / charge number: all-digits → charge_number + pyxis_id ───────────────────
run_query \
  "CDM / charge# — 54000591" \
  "${BASE_URL}/api/formulary/search?q=54000591&fields=charge_number,pyxis_id&limit=50&showInactive=false" \
  "Numeric query → charge_number + pyxis_id indexes"

# ─── 3. NDC — 10-digit number ────────────────────────────────────────────────────────
run_query \
  "NDC — 0143314401" \
  "${BASE_URL}/api/formulary/search?q=0143314401&fields=ndc&limit=50&showInactive=false" \
  "NDC prefix scan + JOIN to formulary_groups"

# ─── 4. Wildcard ─────────────────────────────────────────────────────────────────────
run_query \
  "Wildcard — amox*" \
  "${BASE_URL}/api/formulary/search?q=amox*&limit=50&showInactive=false" \
  "Wildcard → single-query path (no field index)"

# ─── 5. Short prefix (high result volume) ────────────────────────────────────────────
run_query \
  "High-volume prefix — am" \
  "${BASE_URL}/api/formulary/search?q=am&fields=description,generic_name,brand_name,mnemonic&limit=50&showInactive=false" \
  "Short prefix — tests LIMIT behaviour under large result sets"

# ─── 6. Inventory / details (secondary fetch) ────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}── Inventory detail fetch (secondary phase)${RESET}"
echo -e "   Fetches JSON blobs for a sample of group IDs — simulates loadDetails()"
# First grab some group IDs from the acetaminophen search
group_ids=$(curl -s "${BASE_URL}/api/formulary/search?q=acetaminophen&fields=description&limit=10&showInactive=false" \
  | jq -r '.results[].groupId' | head -10 | paste -sd ',' -)
if [[ -n "$group_ids" ]]; then
  inv_url="${BASE_URL}/api/formulary/inventory?groupIds=${group_ids}&environment=prod"
  echo -e "   ${inv_url}"
  timing=$(curl -s -o /dev/null -w "$TIMING" "$inv_url")
  count=$(curl -s "$inv_url" | jq 'keys | length')
  echo -e "   ${GREEN}returned:${RESET} ${count} inventory records"
  echo -e "${YELLOW}${timing}${RESET}"
else
  echo -e "   ${YELLOW}(skipped — no group IDs from acetaminophen search)${RESET}"
fi

echo ""
echo -e "${BOLD}Done.${RESET}"
