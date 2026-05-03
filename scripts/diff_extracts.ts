/**
 * Compare a freshly built local staging_formulary.db against the current
 * production Turso database. Outputs per-domain delta (groups added /
 * removed / modified) and exits non-zero if any domain exceeds a churn
 * threshold (default 25%), unless DEPLOY_DB_FORCE=1 is set.
 *
 * Run after scripts/build_local_sqlite.ts — wired into scripts/deploy-db.sh
 * as the sanity gate before the Turso import + cutover.
 *
 * Also writes data/last_extract_delta.json so the numbers can be reviewed
 * later or surfaced in the app footer alongside extract freshness.
 *
 * Usage:
 *   pnpm tsx scripts/diff_extracts.ts <turso-db-name>
 *   DEPLOY_DB_FORCE=1 pnpm tsx scripts/diff_extracts.ts <turso-db-name>
 */

import { createClient } from '@libsql/client'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const STAGING_DB = path.join(process.cwd(), 'data', 'staging_formulary.db')
const DELTA_OUT = path.join(process.cwd(), 'data', 'last_extract_delta.json')
const TURSO_DB_NAME = process.argv[2]
const CHURN_THRESHOLD = 0.25
const FORCE = process.env.DEPLOY_DB_FORCE === '1'
const SEP = ''

if (!TURSO_DB_NAME) {
  console.error('Usage: pnpm tsx scripts/diff_extracts.ts <turso-db-name>')
  process.exit(1)
}

if (!fs.existsSync(STAGING_DB)) {
  console.error(`Staging DB not found: ${STAGING_DB}`)
  console.error('Run `pnpm tsx scripts/build_local_sqlite.ts` first.')
  process.exit(1)
}

// Fields included in the row signature. Excludes extracted_at (always changes
// per build) and id (auto-increment, not stable across builds).
// JSON_COLS are canonicalized (parse + sort keys + restringify) before
// comparison — otherwise key-order or whitespace changes in buildGroupRow
// trip every row as "modified" even when underlying data is identical.
const SCALAR_COLS = [
  'description', 'generic_name', 'mnemonic', 'charge_number',
  'brand_name', 'brand_name2', 'brand_name3', 'pyxis_id',
  'status', 'formulary_status', 'strength', 'strength_unit',
  'dosage_form', 'legal_status',
  'route', 'dispense_category', 'therapeutic_class',
  'dispense_strength', 'dispense_strength_unit',
  'dispense_volume', 'dispense_volume_unit',
]
const JSON_COLS = [
  'identifiers_json', 'oe_defaults_json', 'dispense_json',
  'clinical_json', 'inventory_json',
]
const SIG_COLS = [...SCALAR_COLS, ...JSON_COLS]

const SELECT_SQL = `SELECT domain, group_id, ${SIG_COLS.join(', ')} FROM formulary_groups`

type AnyRow = Record<string, unknown>

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const obj = value as Record<string, unknown>
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

function canonicalizeJson(raw: unknown): string {
  if (raw == null || raw === '') return ''
  try { return stableStringify(JSON.parse(String(raw))) } catch { return String(raw) }
}

function rowSig(row: AnyRow): string {
  const parts: string[] = []
  for (const c of SCALAR_COLS) parts.push(String(row[c] ?? ''))
  for (const c of JSON_COLS) parts.push(canonicalizeJson(row[c]))
  return parts.join(SEP)
}

function buildIndex(rows: AnyRow[]): Map<string, Map<string, string>> {
  const idx = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const domain = row.domain as string
    const groupId = row.group_id as string
    let domainMap = idx.get(domain)
    if (!domainMap) {
      domainMap = new Map()
      idx.set(domain, domainMap)
    }
    domainMap.set(groupId, rowSig(row))
  }
  return idx
}

async function main() {
  const SNAPSHOT_DB = path.join(process.cwd(), 'data', 'last_deployed_staging.db')

  // Load "old" side: prefer last-deployed local snapshot (~1s) over Turso read (~90s).
  // Snapshot is saved by deploy-db.sh after a successful smoke test, so it
  // matches what's currently in production byte-for-byte (modulo extracted_at,
  // which the signature already excludes).
  let oldRows: AnyRow[]
  let oldSource: string
  if (fs.existsSync(SNAPSHOT_DB)) {
    console.log(`Diffing staging ↔ last-deployed snapshot\n`)
    const snap = new Database(SNAPSHOT_DB, { readonly: true })
    const t = Date.now()
    oldRows = snap.prepare(SELECT_SQL).all() as AnyRow[]
    snap.close()
    oldSource = `snapshot (${SNAPSHOT_DB})`
    console.log(`  old:  ${oldRows.length} rows from snapshot (${Date.now() - t}ms)`)
  } else {
    const envFile = path.join(process.cwd(), '.env.local')
    const envContent = fs.readFileSync(envFile, 'utf8')
    const tokenMatch = envContent.match(/TURSO_AUTH_TOKEN="([^"]+)"/)
    if (!tokenMatch) {
      console.error('Could not find TURSO_AUTH_TOKEN in .env.local')
      process.exit(1)
    }
    const url = `libsql://${TURSO_DB_NAME}-kpessa.aws-us-east-1.turso.io`
    console.log(`Diffing staging ↔ ${TURSO_DB_NAME} (no snapshot — first run)\n`)
    const turso = createClient({ url, authToken: tokenMatch[1] })
    const t = Date.now()
    const prodResult = await turso.execute(SELECT_SQL)
    turso.close()
    oldRows = prodResult.rows as unknown as AnyRow[]
    oldSource = `prod (${TURSO_DB_NAME})`
    console.log(`  old:  ${oldRows.length} rows from Turso (${Date.now() - t}ms)`)
  }

  const local = new Database(STAGING_DB, { readonly: true })
  const t1 = Date.now()
  const stagingRows = local.prepare(SELECT_SQL).all() as AnyRow[]
  local.close()
  console.log(`  new:  ${stagingRows.length} rows from staging (${Date.now() - t1}ms)\n`)

  const oldIdx = buildIndex(oldRows)
  const newIdx = buildIndex(stagingRows)
  const allDomains = new Set([...oldIdx.keys(), ...newIdx.keys()])

  type DomainDelta = {
    domain: string
    oldCount: number
    newCount: number
    added: number
    removed: number
    modified: number
    churnPct: number
  }
  const deltas: DomainDelta[] = []
  let exceeded = false

  for (const domain of [...allDomains].sort()) {
    const oldMap = oldIdx.get(domain) ?? new Map<string, string>()
    const newMap = newIdx.get(domain) ?? new Map<string, string>()
    let added = 0, removed = 0, modified = 0

    for (const [gid, newSig] of newMap) {
      const oldSig = oldMap.get(gid)
      if (oldSig === undefined) added++
      else if (oldSig !== newSig) modified++
    }
    for (const gid of oldMap.keys()) {
      if (!newMap.has(gid)) removed++
    }

    const baseline = oldMap.size || newMap.size || 1
    const churnPct = (added + removed + modified) / baseline
    if (churnPct > CHURN_THRESHOLD) exceeded = true

    deltas.push({ domain, oldCount: oldMap.size, newCount: newMap.size, added, removed, modified, churnPct })
  }

  const pad = (s: string | number, n: number) => String(s).padStart(n)
  console.log('  Domain          old →    new    added  removed  modified  churn%')
  console.log('  ────────────  ──────  ──────  ───────  ───────  ────────  ──────')
  for (const d of deltas) {
    console.log(
      `  ${d.domain.padEnd(12)}  ${pad(d.oldCount, 6)}  ${pad(d.newCount, 6)}  ${pad(d.added, 7)}  ${pad(d.removed, 7)}  ${pad(d.modified, 8)}  ${pad((d.churnPct * 100).toFixed(1) + '%', 6)}`
    )
  }
  console.log()

  fs.writeFileSync(DELTA_OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    old_source: oldSource,
    threshold: CHURN_THRESHOLD,
    deltas,
  }, null, 2))
  console.log(`  Wrote ${DELTA_OUT}`)

  if (exceeded && !FORCE) {
    console.error(`\n✗ One or more domains exceeded the ${CHURN_THRESHOLD * 100}% churn threshold.`)
    console.error('  This is a sanity check against malformed extracts. Review the')
    console.error('  numbers above. To proceed anyway, re-run deploy with DEPLOY_DB_FORCE=1.')
    process.exit(2)
  }
  if (exceeded) {
    console.warn(`⚠ Churn threshold exceeded but DEPLOY_DB_FORCE=1 — proceeding.`)
  } else {
    console.log(`✓ All domains within churn threshold (≤${CHURN_THRESHOLD * 100}%).`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
