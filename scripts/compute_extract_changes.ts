/**
 * Compute the per-drug delta between two extract states and persist to Turso
 * as clinically-meaningful events (flex / unflex / stack / new build / etc).
 *
 * Source of truth for the /admin/extract-changes dashboard. Runs at the end
 * of deploy-db.sh once both DBs are available. Inputs:
 *   - new staging:  data/staging_formulary.db
 *   - old snapshot: data/last_deployed_staging.db (preferred, fast local)
 *                   OR a Turso DB by name if no snapshot exists (bootstrap path)
 *
 * Diffs both formulary_groups AND supply_records — the latter is required to
 * detect 'stack' events (new NDC linked to an existing drug).
 *
 * Each (domain, group_id) can emit MULTIPLE rows (one per event_type), so a
 * drug that was flexed AND status-changed in the same run produces 2 rows.
 *
 * Usage:
 *   pnpm tsx scripts/compute_extract_changes.ts <new-run-id> [<prev-run-id>]
 */

import { createClient, type Client } from '@libsql/client'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const STAGING_DB = path.join(process.cwd(), 'data', 'staging_formulary.db')
const SNAPSHOT_DB = path.join(process.cwd(), 'data', 'last_deployed_staging.db')
const SNAPSHOT_META = path.join(process.cwd(), 'data', 'last_deployed_staging.meta.json')

const NEW_RUN_ID = process.argv[2]
const PREV_RUN_ID_ARG = process.argv[3]

if (!NEW_RUN_ID) {
  console.error('Usage: pnpm tsx scripts/compute_extract_changes.ts <new-run-id> [<prev-run-id>]')
  process.exit(1)
}
if (!fs.existsSync(STAGING_DB)) {
  console.error(`Staging DB not found: ${STAGING_DB}`)
  process.exit(1)
}

// Columns we read from formulary_groups for classification + display.
const SCALAR_COLS = [
  'description', 'generic_name', 'mnemonic', 'charge_number',
  'brand_name', 'brand_name2', 'brand_name3', 'pyxis_id',
  'status', 'formulary_status', 'strength', 'strength_unit',
  'dosage_form', 'legal_status',
  'route', 'dispense_category', 'therapeutic_class',
  'dispense_strength', 'dispense_strength_unit',
  'dispense_volume', 'dispense_volume_unit',
]
const JSON_COLS = ['identifiers_json', 'oe_defaults_json', 'dispense_json', 'clinical_json', 'inventory_json']
const ALL_GROUP_COLS = [...SCALAR_COLS, ...JSON_COLS]

const SELECT_GROUPS = `SELECT domain, group_id, ${ALL_GROUP_COLS.join(', ')} FROM formulary_groups`
const SELECT_SUPPLY = `SELECT domain, group_id, ndc FROM supply_records`

type AnyRow = Record<string, unknown>

// ── Helpers ────────────────────────────────────────────────────────────────
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
}
function canonicalizeJson(raw: unknown): string {
  if (raw == null || raw === '') return ''
  try { return stableStringify(JSON.parse(String(raw))) } catch { return String(raw) }
}
function parseJson(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(String(raw)) ?? {} } catch { return {} }
}

function loadEnv(): { url: string; token: string } {
  const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const url = env.match(/DATABASE_URL="([^"]+)"/)?.[1]
  const token = env.match(/TURSO_AUTH_TOKEN="([^"]+)"/)?.[1]
  if (!url || !token) throw new Error('DATABASE_URL or TURSO_AUTH_TOKEN missing from .env.local')
  return { url, token }
}

function dbNameFromUrl(url: string): string {
  return url.replace(/^libsql:\/\//, '').replace(/-kpessa\..*$/, '')
}

async function readLocalAll(dbPath: string, sql: string): Promise<AnyRow[]> {
  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare(sql).all() as AnyRow[]
  db.close()
  return rows
}

async function readRemoteAll(client: Client, sql: string): Promise<AnyRow[]> {
  const r = await client.execute(sql)
  return r.rows as unknown as AnyRow[]
}

// ── Facility-level inventory parsing ────────────────────────────────────────
function activeFacilities(inv: unknown): Set<string> {
  const f = parseJson(inv).facilities as Record<string, unknown> | undefined
  const out = new Set<string>()
  if (f) for (const [k, v] of Object.entries(f)) if (v) out.add(k)
  return out
}

function diffFacilities(oldInv: unknown, newInv: unknown): { flexed: string[]; unflexed: string[] } {
  const oldOn = activeFacilities(oldInv)
  const newOn = activeFacilities(newInv)
  const flexed: string[] = []
  const unflexed: string[] = []
  for (const f of newOn) if (!oldOn.has(f)) flexed.push(f)
  for (const f of oldOn) if (!newOn.has(f)) unflexed.push(f)
  return { flexed, unflexed }
}

// ── Event taxonomy ─────────────────────────────────────────────────────────
type EventType =
  | 'new_build' | 'cross_domain_add'
  | 'flex' | 'unflex'
  | 'facility_onboarding' | 'facility_offboarding'
  | 'stack'
  | 'status_change' | 'description_change'
  | 'other_modified' | 'removed'

type Change = {
  change_type: 'added' | 'cross_domain_added' | 'modified' | 'removed'
  event_type: EventType
  domain: string
  group_id: string
  description: string
  field_diffs: { field: string; old: string; new: string }[]
}

const DESCRIPTION_FIELDS = new Set(['description', 'generic_name', 'mnemonic'])

async function main() {
  console.log(`▶ Computing extract changes for run ${NEW_RUN_ID}`)
  const env = loadEnv()
  const turso = createClient({ url: env.url, authToken: env.token })

  // Idempotent schema. Order matters:
  //   1. CREATE TABLE (no-op if exists)
  //   2. ALTER TABLE ADD COLUMN event_type (only useful for pre-existing tables
  //      that were created before this column was added; new tables already
  //      have it from step 1). Wrapped in try/catch since ADD COLUMN errors
  //      when the column already exists.
  //   3. Then indexes — including the one on event_type, which would fail
  //      if attempted before the ALTER on a legacy table.
  await turso.batch([
    { sql: `CREATE TABLE IF NOT EXISTS extract_runs (id TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')), prev_run_id TEXT, summary_json TEXT NOT NULL DEFAULT '{}')`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS extract_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, change_type TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'other_modified', domain TEXT NOT NULL, group_id TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', field_diffs_json TEXT NOT NULL DEFAULT '[]')`, args: [] },
  ], 'write')
  try { await turso.execute(`ALTER TABLE extract_changes ADD COLUMN event_type TEXT NOT NULL DEFAULT 'other_modified'`) } catch { /* column already exists */ }
  await turso.batch([
    { sql: `CREATE INDEX IF NOT EXISTS idx_ec_run_type   ON extract_changes(run_id, change_type)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_ec_run_event  ON extract_changes(run_id, event_type)`,  args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_ec_run_domain ON extract_changes(run_id, domain)`,      args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_ec_run_group  ON extract_changes(run_id, group_id)`,    args: [] },
  ], 'write')

  // Resolve prev_run_id
  let prevRunId = PREV_RUN_ID_ARG
  if (!prevRunId) {
    const last = await turso.execute(`SELECT id FROM extract_runs ORDER BY ran_at DESC LIMIT 1`)
    if (last.rows.length) prevRunId = last.rows[0].id as string
  }
  if (!prevRunId) {
    prevRunId = dbNameFromUrl(env.url)
    if (prevRunId === NEW_RUN_ID) {
      console.error('No prev_run_id available — pass one explicitly as argv[3]')
      process.exit(1)
    }
  }
  console.log(`  prev: ${prevRunId}`)

  // ── Decide old data source ────────────────────────────────────────────────
  let snapshotIsUsable = false
  if (fs.existsSync(SNAPSHOT_DB)) {
    if (fs.existsSync(SNAPSHOT_META)) {
      const meta = JSON.parse(fs.readFileSync(SNAPSHOT_META, 'utf8')) as { run_id?: string }
      if (meta.run_id && meta.run_id !== NEW_RUN_ID) snapshotIsUsable = true
      else console.log(`  snapshot meta: run_id=${meta.run_id} matches NEW_RUN_ID — falling back to remote`)
    } else {
      console.log(`  snapshot present but no .meta.json — falling back to remote (bootstrap)`)
    }
  }

  // ── Read formulary_groups ────────────────────────────────────────────────
  const t0 = Date.now()
  const newGroups = await readLocalAll(STAGING_DB, SELECT_GROUPS)
  console.log(`  new groups:  ${newGroups.length} from staging (${Date.now() - t0}ms)`)

  let oldGroups: AnyRow[]
  let remoteClient: Client | null = null
  if (snapshotIsUsable) {
    const t = Date.now()
    oldGroups = await readLocalAll(SNAPSHOT_DB, SELECT_GROUPS)
    console.log(`  old groups:  ${oldGroups.length} from snapshot (${Date.now() - t}ms)`)
  } else {
    const url = `libsql://${prevRunId}-kpessa.aws-us-east-1.turso.io`
    remoteClient = createClient({ url, authToken: env.token })
    const t = Date.now()
    oldGroups = await readRemoteAll(remoteClient, SELECT_GROUPS)
    console.log(`  old groups:  ${oldGroups.length} from Turso ${prevRunId} (${Date.now() - t}ms)`)
  }

  // ── Read supply_records (NDC sets per domain+group) ──────────────────────
  const t1 = Date.now()
  const newSupply = await readLocalAll(STAGING_DB, SELECT_SUPPLY)
  console.log(`  new supply:  ${newSupply.length} from staging (${Date.now() - t1}ms)`)

  let oldSupply: AnyRow[]
  if (snapshotIsUsable) {
    const t = Date.now()
    oldSupply = await readLocalAll(SNAPSHOT_DB, SELECT_SUPPLY)
    console.log(`  old supply:  ${oldSupply.length} from snapshot (${Date.now() - t}ms)`)
  } else {
    const t = Date.now()
    oldSupply = await readRemoteAll(remoteClient!, SELECT_SUPPLY)
    console.log(`  old supply:  ${oldSupply.length} from Turso ${prevRunId} (${Date.now() - t}ms)`)
  }
  if (remoteClient) remoteClient.close()

  // ── Index ────────────────────────────────────────────────────────────────
  const key = (d: string, g: string) => `${d}|${g}`
  const oldByKey = new Map<string, AnyRow>()
  const oldGroupIds = new Set<string>()
  for (const r of oldGroups) {
    oldByKey.set(key(r.domain as string, r.group_id as string), r)
    oldGroupIds.add(r.group_id as string)
  }
  const newByKey = new Map<string, AnyRow>()
  for (const r of newGroups) newByKey.set(key(r.domain as string, r.group_id as string), r)

  // ── Facility classification ────────────────────────────────────────────────
  // A facility is classified as "onboarding" (i.e. likely a go-live) if it
  // meets BOTH of these:
  //   1. Volume:  gained ≥ ABS_THRESHOLD drugs this extract
  //   2. Ratio:   gained ≥ old_count  (the facility at least doubled in size)
  //
  // This single rule covers two cases cleanly:
  //   - Brand-new facility with significant population (o=0, n=200 → gained=200,
  //     passes both thresholds) — e.g. a major hospital go-live.
  //   - Existing placeholder facility that gets bulk-activated (o=47, n=1259 →
  //     gained=1212) — e.g. Phase 2 Chicago hospitals that had a few test
  //     drugs in the old extract and then absorbed thousands.
  //
  // Trivial new facilities (a small clinic / RTC / billing center with only
  // 1-17 drugs) deliberately do NOT qualify — they get classified as regular
  // `flex` events and blend into normal Cerner-pushed churn. Per Kurt's
  // feedback, those are themselves noise inside the onboarding panel.
  //
  // Symmetric rules for offboarding (decom).
  const ABS_THRESHOLD = 50

  // Tally per-facility drug counts from each side.
  const oldFacCount = new Map<string, number>()
  const newFacCount = new Map<string, number>()
  for (const r of oldGroups) for (const f of activeFacilities(r.inventory_json)) oldFacCount.set(f, (oldFacCount.get(f) ?? 0) + 1)
  for (const r of newGroups) for (const f of activeFacilities(r.inventory_json)) newFacCount.set(f, (newFacCount.get(f) ?? 0) + 1)

  const allFacilities = new Set([...oldFacCount.keys(), ...newFacCount.keys()])
  const onboardedFacilities = new Set<string>()
  const offboardedFacilities = new Set<string>()
  for (const f of allFacilities) {
    const o = oldFacCount.get(f) ?? 0
    const n = newFacCount.get(f) ?? 0
    const gained = n - o
    const lost = o - n
    if (gained >= ABS_THRESHOLD && gained >= o) onboardedFacilities.add(f)
    if (lost >= ABS_THRESHOLD && lost >= n) offboardedFacilities.add(f)
  }

  console.log(`  facility universes: old=${oldFacCount.size}, new=${newFacCount.size}, onboarded=${onboardedFacilities.size}, offboarded=${offboardedFacilities.size}`)
  if (onboardedFacilities.size > 0) {
    const sample = [...onboardedFacilities]
      .sort((a, b) => ((newFacCount.get(b) ?? 0) - (oldFacCount.get(b) ?? 0)) - ((newFacCount.get(a) ?? 0) - (oldFacCount.get(a) ?? 0)))
      .slice(0, 5)
      .map(f => `${f} (${(oldFacCount.get(f) ?? 0)}→${(newFacCount.get(f) ?? 0)})`)
    console.log(`  onboarded: ${sample.join(', ')}${onboardedFacilities.size > 5 ? '…' : ''}`)
  }
  if (offboardedFacilities.size > 0) {
    const sample = [...offboardedFacilities].slice(0, 5).map(f => `${f} (${(oldFacCount.get(f) ?? 0)}→${(newFacCount.get(f) ?? 0)})`)
    console.log(`  offboarded: ${sample.join(', ')}${offboardedFacilities.size > 5 ? '…' : ''}`)
  }

  // Per-facility drug counts (populated as we classify drug-level events)
  const onboardingCounts: Record<string, number> = {}
  const offboardingCounts: Record<string, number> = {}

  // NDC sets: (domain, group_id) → Set<ndc>
  const supplyIndex = (rows: AnyRow[]) => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      const k = key(r.domain as string, r.group_id as string)
      let s = m.get(k); if (!s) { s = new Set(); m.set(k, s) }
      s.add(String(r.ndc ?? ''))
    }
    return m
  }
  const oldNdcs = supplyIndex(oldSupply)
  const newNdcs = supplyIndex(newSupply)

  // ── Classify ─────────────────────────────────────────────────────────────
  const changes: Change[] = []
  const eventCounts: Record<string, number> = {}
  const perDomainEvents: Record<string, Record<string, number>> = {}
  const bumpEvent = (domain: string, ev: EventType) => {
    eventCounts[ev] = (eventCounts[ev] ?? 0) + 1
    perDomainEvents[domain] ??= {}
    perDomainEvents[domain][ev] = (perDomainEvents[domain][ev] ?? 0) + 1
  }

  for (const [k, newRow] of newByKey) {
    const oldRow = oldByKey.get(k)
    const domain = newRow.domain as string
    const gid = newRow.group_id as string
    const desc = String(newRow.description ?? '')

    if (!oldRow) {
      // New drug (or cross-domain add). Emit the structural new_build /
      // cross_domain_add event...
      const wasGroupKnown = oldGroupIds.has(gid)
      const ct: Change['change_type'] = wasGroupKnown ? 'cross_domain_added' : 'added'
      const ev: EventType = wasGroupKnown ? 'cross_domain_add' : 'new_build'
      changes.push({ change_type: ct, event_type: ev, domain, group_id: gid, description: desc, field_diffs: [] })
      bumpEvent(domain, ev)

      // ...AND emit a facility_onboarding event if any of this new drug's
      // facilities are go-live sites. Without this, a drug Cerner built
      // specifically for Streamwood/Riveredge/Lincoln Prairie would only
      // appear as `new_build` (in the regular maintenance pane), drastically
      // under-counting onboarding work and inflating regular new-build totals.
      const newFacs = activeFacilities(newRow.inventory_json)
      const onboardingTargets = [...newFacs].filter(f => onboardedFacilities.has(f))
      if (onboardingTargets.length) {
        changes.push({
          change_type: ct, event_type: 'facility_onboarding', domain, group_id: gid, description: desc,
          field_diffs: [{ field: 'facilities', old: '[]', new: JSON.stringify(onboardingTargets) }],
        })
        bumpEvent(domain, 'facility_onboarding')
        for (const f of onboardingTargets) onboardingCounts[f] = (onboardingCounts[f] ?? 0) + 1
      }
      continue
    }

    // ── Modified row: emit one event per detected category ────────────────
    // 1) Flex/unflex — diff inventory_json.facilities, then split each list
    //    into "regular" (facility was in prior universe) vs "onboarding"
    //    (facility is new to the formulary). Same for unflex/offboarding.
    //    A drug flexed to BOTH a new and an existing facility produces TWO
    //    rows — one `flex` and one `facility_onboarding` — so the main
    //    dashboard tile counts aren't drowned out by go-live noise.
    const fac = diffFacilities(oldRow.inventory_json, newRow.inventory_json)
    if (fac.flexed.length) {
      const onboarding: string[] = []
      const regular: string[] = []
      for (const f of fac.flexed) (onboardedFacilities.has(f) ? onboarding : regular).push(f)
      if (regular.length) {
        changes.push({
          change_type: 'modified', event_type: 'flex', domain, group_id: gid, description: desc,
          field_diffs: [{ field: 'facilities', old: '[]', new: JSON.stringify(regular) }],
        })
        bumpEvent(domain, 'flex')
      }
      if (onboarding.length) {
        changes.push({
          change_type: 'modified', event_type: 'facility_onboarding', domain, group_id: gid, description: desc,
          field_diffs: [{ field: 'facilities', old: '[]', new: JSON.stringify(onboarding) }],
        })
        bumpEvent(domain, 'facility_onboarding')
        for (const f of onboarding) onboardingCounts[f] = (onboardingCounts[f] ?? 0) + 1
      }
    }
    if (fac.unflexed.length) {
      const offboarding: string[] = []
      const regular: string[] = []
      for (const f of fac.unflexed) (offboardedFacilities.has(f) ? offboarding : regular).push(f)
      if (regular.length) {
        changes.push({
          change_type: 'modified', event_type: 'unflex', domain, group_id: gid, description: desc,
          field_diffs: [{ field: 'facilities', old: JSON.stringify(regular), new: '[]' }],
        })
        bumpEvent(domain, 'unflex')
      }
      if (offboarding.length) {
        changes.push({
          change_type: 'modified', event_type: 'facility_offboarding', domain, group_id: gid, description: desc,
          field_diffs: [{ field: 'facilities', old: JSON.stringify(offboarding), new: '[]' }],
        })
        bumpEvent(domain, 'facility_offboarding')
        for (const f of offboarding) offboardingCounts[f] = (offboardingCounts[f] ?? 0) + 1
      }
    }

    // 2) Status change
    const oldStatus = String(oldRow.formulary_status ?? '')
    const newStatus = String(newRow.formulary_status ?? '')
    if (oldStatus !== newStatus) {
      changes.push({
        change_type: 'modified', event_type: 'status_change', domain, group_id: gid, description: desc,
        field_diffs: [{ field: 'formulary_status', old: oldStatus, new: newStatus }],
      })
      bumpEvent(domain, 'status_change')
    }

    // 3) Description-family change
    const descDiffs: { field: string; old: string; new: string }[] = []
    for (const f of DESCRIPTION_FIELDS) {
      const o = String(oldRow[f] ?? ''), n = String(newRow[f] ?? '')
      if (o !== n) descDiffs.push({ field: f, old: o, new: n })
    }
    if (descDiffs.length) {
      changes.push({ change_type: 'modified', event_type: 'description_change', domain, group_id: gid, description: desc, field_diffs: descDiffs })
      bumpEvent(domain, 'description_change')
    }

    // 4) Other field changes — anything left that's not facilities, status, or descriptive.
    const otherDiffs: { field: string; old: string; new: string }[] = []
    for (const c of SCALAR_COLS) {
      if (c === 'formulary_status' || DESCRIPTION_FIELDS.has(c)) continue
      const o = String(oldRow[c] ?? ''), n = String(newRow[c] ?? '')
      if (o !== n) otherDiffs.push({ field: c, old: o, new: n })
    }
    for (const c of JSON_COLS) {
      // inventory_json's facility-level diff is captured in flex/unflex above.
      // If inventory_json has *non-facility* changes, fall through to other_modified.
      if (c === 'inventory_json') {
        const oCanon = canonicalizeJson({ ...parseJson(oldRow[c]), facilities: undefined })
        const nCanon = canonicalizeJson({ ...parseJson(newRow[c]), facilities: undefined })
        if (oCanon !== nCanon) otherDiffs.push({ field: c, old: canonicalizeJson(oldRow[c]), new: canonicalizeJson(newRow[c]) })
      } else {
        const o = canonicalizeJson(oldRow[c]), n = canonicalizeJson(newRow[c])
        if (o !== n) otherDiffs.push({ field: c, old: o, new: n })
      }
    }
    if (otherDiffs.length) {
      changes.push({ change_type: 'modified', event_type: 'other_modified', domain, group_id: gid, description: desc, field_diffs: otherDiffs })
      bumpEvent(domain, 'other_modified')
    }

    // 5) Stack — new NDCs in supply
    const oldNdcSet = oldNdcs.get(k) ?? new Set<string>()
    const newNdcSet = newNdcs.get(k) ?? new Set<string>()
    const stackedNdcs: string[] = []
    for (const n of newNdcSet) if (!oldNdcSet.has(n)) stackedNdcs.push(n)
    if (stackedNdcs.length) {
      changes.push({
        change_type: 'modified', event_type: 'stack', domain, group_id: gid, description: desc,
        field_diffs: stackedNdcs.map(n => ({ field: 'ndc', old: '', new: n })),
      })
      bumpEvent(domain, 'stack')
    }
  }

  // Removed
  for (const [k, oldRow] of oldByKey) {
    if (newByKey.has(k)) continue
    const domain = oldRow.domain as string
    const gid = oldRow.group_id as string
    changes.push({
      change_type: 'removed', event_type: 'removed', domain, group_id: gid,
      description: String(oldRow.description ?? ''), field_diffs: [],
    })
    bumpEvent(domain, 'removed')
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  console.log(`  computed ${changes.length} change rows across ${Object.keys(eventCounts).length} event types`)
  console.log(`  event totals:`)
  for (const [ev, n] of Object.entries(eventCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${ev.padEnd(20)} ${n}`)
  }

  await turso.batch([
    { sql: `DELETE FROM extract_changes WHERE run_id = ?`, args: [NEW_RUN_ID] },
    { sql: `DELETE FROM extract_runs    WHERE id     = ?`, args: [NEW_RUN_ID] },
  ], 'write')

  await turso.batch([{
    sql: `INSERT INTO extract_runs (id, ran_at, prev_run_id, summary_json) VALUES (?, ?, ?, ?)`,
    args: [NEW_RUN_ID, new Date().toISOString(), prevRunId, JSON.stringify({
      totals: eventCounts,
      by_domain: perDomainEvents,
      // Per-facility drug counts for the "Facility Onboarding" panel
      new_facilities: onboardingCounts,
      offboarded_facilities: offboardingCounts,
    })],
  }], 'write')

  const INSERT_SQL = `INSERT INTO extract_changes (run_id, change_type, event_type, domain, group_id, description, field_diffs_json) VALUES (?,?,?,?,?,?,?)`
  const BATCH = 200
  let inserted = 0
  const t2 = Date.now()
  for (let i = 0; i < changes.length; i += BATCH) {
    const slice = changes.slice(i, i + BATCH)
    await turso.batch(
      slice.map(c => ({
        sql: INSERT_SQL,
        args: [NEW_RUN_ID, c.change_type, c.event_type, c.domain, c.group_id, c.description, JSON.stringify(c.field_diffs)],
      })),
      'write',
    )
    inserted += slice.length
    process.stdout.write(`\r  inserted ${inserted}/${changes.length}`)
  }
  console.log(`  (${Date.now() - t2}ms)`)
  turso.close()

  console.log(`✓ Stored run ${NEW_RUN_ID} (prev=${prevRunId}) with ${changes.length} change rows`)
}

main().catch(err => { console.error(err); process.exit(1) })
