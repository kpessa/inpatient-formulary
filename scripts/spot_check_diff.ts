/**
 * Spot-check: pick a few "modified" groups from a domain and print a
 * column-by-column diff between the current production Turso DB and the
 * freshly built local staging_formulary.db.
 *
 * Used to validate diff_extracts.ts findings before a force-deploy — answers
 * the question "is this real Cerner data churn, or is my signature sensitive
 * to JSON-shape differences that don't actually matter?"
 *
 * Usage:
 *   pnpm tsx scripts/spot_check_diff.ts <turso-db-name> <domain> [sample-size]
 *   pnpm tsx scripts/spot_check_diff.ts formulary-20260326 central_cert 5
 */

import { createClient } from '@libsql/client'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const STAGING_DB = path.join(process.cwd(), 'data', 'staging_formulary.db')
const TURSO_DB_NAME = process.argv[2]
const DOMAIN = process.argv[3]
const SAMPLE_SIZE = parseInt(process.argv[4] ?? '3', 10)

if (!TURSO_DB_NAME || !DOMAIN) {
  console.error('Usage: pnpm tsx scripts/spot_check_diff.ts <turso-db-name> <domain> [sample-size]')
  process.exit(1)
}

// Same fields the diff signature uses, minus extracted_at.
const COLS = [
  'description', 'generic_name', 'mnemonic', 'charge_number',
  'brand_name', 'brand_name2', 'brand_name3', 'pyxis_id',
  'status', 'formulary_status', 'strength', 'strength_unit',
  'dosage_form', 'legal_status',
  'identifiers_json', 'oe_defaults_json', 'dispense_json',
  'clinical_json', 'inventory_json',
  'route', 'dispense_category', 'therapeutic_class',
  'dispense_strength', 'dispense_strength_unit',
  'dispense_volume', 'dispense_volume_unit',
]

type AnyRow = Record<string, unknown>

function diffJson(oldVal: string, newVal: string): { kind: 'identical' | 'shape-only' | 'value-diff'; detail: string } {
  if (oldVal === newVal) return { kind: 'identical', detail: '' }
  // If the parsed objects are deep-equal, then the only diff is JSON shape (key order, whitespace).
  let oldP: unknown, newP: unknown
  try { oldP = JSON.parse(oldVal || '{}') } catch { return { kind: 'value-diff', detail: '(unparseable old)' } }
  try { newP = JSON.parse(newVal || '{}') } catch { return { kind: 'value-diff', detail: '(unparseable new)' } }
  if (deepEqual(oldP, newP)) return { kind: 'shape-only', detail: 'parsed objects are deep-equal — JSON shape diff only' }

  // Compute key-level diff
  const oldObj = (oldP ?? {}) as Record<string, unknown>
  const newObj = (newP ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)])
  const changes: string[] = []
  for (const k of keys) {
    const o = oldObj[k]
    const n = newObj[k]
    if (!deepEqual(o, n)) {
      const oStr = JSON.stringify(o)
      const nStr = JSON.stringify(n)
      const tOld = oStr && oStr.length > 60 ? oStr.slice(0, 60) + '…' : oStr
      const tNew = nStr && nStr.length > 60 ? nStr.slice(0, 60) + '…' : nStr
      changes.push(`      ${k}: ${tOld} → ${tNew}`)
    }
  }
  return { kind: 'value-diff', detail: changes.join('\n') }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false
    return true
  }
  return false
}

function trunc(s: string, n: number): string {
  if (s == null) return '<null>'
  return s.length > n ? s.slice(0, n) + '…' : s
}

async function main() {
  const envFile = path.join(process.cwd(), '.env.local')
  const tokenMatch = fs.readFileSync(envFile, 'utf8').match(/TURSO_AUTH_TOKEN="([^"]+)"/)
  if (!tokenMatch) { console.error('No TURSO_AUTH_TOKEN'); process.exit(1) }

  const url = `libsql://${TURSO_DB_NAME}-kpessa.aws-us-east-1.turso.io`
  const turso = createClient({ url, authToken: tokenMatch[1] })

  const SELECT = `SELECT group_id, ${COLS.join(', ')} FROM formulary_groups WHERE domain = ?`

  console.log(`Loading ${DOMAIN} from prod (${TURSO_DB_NAME})...`)
  const prodRes = await turso.execute({ sql: SELECT, args: [DOMAIN] })
  turso.close()
  console.log(`  ${prodRes.rows.length} groups`)

  console.log(`Loading ${DOMAIN} from staging...`)
  const local = new Database(STAGING_DB, { readonly: true })
  const stagingRows = local.prepare(SELECT).all(DOMAIN) as AnyRow[]
  local.close()
  console.log(`  ${stagingRows.length} groups\n`)

  // Index by group_id
  const oldById = new Map<string, AnyRow>()
  for (const r of prodRes.rows as unknown as AnyRow[]) oldById.set(r.group_id as string, r)

  // Find groups that differ in at least one COL
  const modified: { gid: string; old: AnyRow; new: AnyRow; diffs: string[] }[] = []
  for (const newRow of stagingRows) {
    const gid = newRow.group_id as string
    const oldRow = oldById.get(gid)
    if (!oldRow) continue
    const diffs: string[] = []
    for (const c of COLS) {
      const o = String(oldRow[c] ?? '')
      const n = String(newRow[c] ?? '')
      if (o !== n) diffs.push(c)
    }
    if (diffs.length) modified.push({ gid, old: oldRow, new: newRow, diffs })
  }

  console.log(`Found ${modified.length} modified groups in ${DOMAIN}.`)
  console.log(`Sampling ${Math.min(SAMPLE_SIZE, modified.length)}...\n`)

  // Aggregate which columns are most-frequently different
  const colChurn = new Map<string, number>()
  for (const m of modified) for (const c of m.diffs) colChurn.set(c, (colChurn.get(c) ?? 0) + 1)
  const sortedChurn = [...colChurn.entries()].sort((a, b) => b[1] - a[1])

  console.log(`Column churn across all ${modified.length} modified groups:`)
  for (const [col, count] of sortedChurn) {
    const pct = ((count / modified.length) * 100).toFixed(0)
    console.log(`  ${col.padEnd(28)}  ${String(count).padStart(6)}  (${pct}%)`)
  }
  console.log()

  // Sample N groups
  const samples = modified.slice(0, SAMPLE_SIZE)
  for (const m of samples) {
    console.log('═'.repeat(78))
    console.log(`group_id: ${m.gid}   description: ${m.new.description ?? '<none>'}`)
    console.log(`changed columns: ${m.diffs.join(', ')}`)
    console.log()
    for (const c of m.diffs) {
      const o = String(m.old[c] ?? '')
      const n = String(m.new[c] ?? '')
      const isJson = c.endsWith('_json')
      if (isJson) {
        const r = diffJson(o, n)
        console.log(`  ${c}: [${r.kind}]`)
        if (r.kind === 'value-diff') console.log(r.detail)
        else if (r.kind === 'shape-only') console.log(`    ${r.detail}`)
      } else {
        console.log(`  ${c}:`)
        console.log(`    old: ${trunc(o, 80)}`)
        console.log(`    new: ${trunc(n, 80)}`)
      }
    }
    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
