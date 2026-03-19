/**
 * Migrate CSV extract files directly to Turso.
 *
 * File → domain mapping:
 *   c152e_extract.csv  →  region: "east",    environment: "cert"
 *   p152w_extract.csv  →  region: "west",    environment: "prod"
 *   p152c_extract.csv  →  region: "central", environment: "prod"
 *
 * Usage:
 *   tsx scripts/migrate_csv_to_turso.ts
 */

import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'
import Papa from 'papaparse'
import { buildGroupRow, buildSupplyRows } from '../lib/csvTransform'
import type { Row } from '../lib/csvTransform'

// Load .env.local if not already in environment
if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
      if (m) process.env[m[1]] = m[2]
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN

if (!DATABASE_URL || DATABASE_URL.startsWith('file:')) {
  throw new Error('Set DATABASE_URL to a libsql:// Turso URL (not a file: URL)')
}

// Groups and supply rows are batched separately so neither exceeds Turso's
// ~1000-statement-per-batch limit even for large extracts.
const GROUP_BATCH_SIZE = 50
const SUPPLY_BATCH_SIZE = 200

const FILES: { file: string; region: string; env: string }[] = [
  { file: 'c152e_extract.csv', region: 'east',    env: 'cert' },
  { file: 'p152w_extract.csv', region: 'west',    env: 'prod' },
  { file: 'p152c_extract.csv', region: 'central', env: 'prod' },
]

const GROUP_COLS = [
  'domain', 'region', 'environment', 'extracted_at',
  'group_id', 'description', 'generic_name', 'mnemonic',
  'charge_number', 'brand_name', 'brand_name2', 'brand_name3', 'pyxis_id',
  'status', 'formulary_status', 'strength', 'strength_unit', 'dosage_form', 'legal_status',
  'identifiers_json', 'oe_defaults_json', 'dispense_json', 'clinical_json', 'inventory_json',
]
const SUPPLY_COLS = [
  'domain', 'group_id',
  'ndc', 'is_non_reference', 'is_active',
  'manufacturer', 'manufacturer_brand', 'manufacturer_label_desc',
  'is_primary', 'is_biological', 'is_brand', 'is_unit_dose',
  'awp_cost', 'cost1', 'cost2', 'supply_json',
]
const GROUP_SQL = `INSERT INTO formulary_groups (${GROUP_COLS.join(', ')}) VALUES (${GROUP_COLS.map(() => '?').join(', ')})`
const SUPPLY_SQL = `INSERT INTO supply_records (${SUPPLY_COLS.join(', ')}) VALUES (${SUPPLY_COLS.map(() => '?').join(', ')})`

type AnyRow = Record<string, unknown>

async function migrateFile(
  remote: ReturnType<typeof createClient>,
  file: string,
  region: string,
  env: string,
) {
  const domain = `${region}_${env}`
  const csvPath = path.join(process.cwd(), 'data', file)

  console.log(`\n── ${file}  →  ${domain} ──────────────────────────`)

  if (!fs.existsSync(csvPath)) {
    console.log(`  Skipping — file not found`)
    return
  }

  console.log(`  Reading file...`)
  const text = fs.readFileSync(csvPath, 'latin1')

  console.log(`  Parsing CSV...`)
  const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true })

  // Group rows by GROUP_ID
  const grouped = new Map<string, Row[]>()
  for (const row of data) {
    const gid = row['GROUP_ID'] ?? ''
    if (!gid) continue
    const existing = grouped.get(gid)
    if (existing) existing.push(row)
    else grouped.set(gid, [row])
  }

  const groupIds = Array.from(grouped.keys())
  const extractedAt = new Date().toISOString()
  console.log(`  ${data.length} rows  →  ${groupIds.length} unique groups`)

  // Clear this domain's existing data
  console.log(`  Clearing existing ${domain} data...`)
  await remote.batch([
    { sql: 'DELETE FROM formulary_groups WHERE domain = ?', args: [domain] },
    { sql: 'DELETE FROM supply_records WHERE domain = ?',   args: [domain] },
  ], 'write')

  // ── Insert group rows ───────────────────────────────────────────────────────
  const groupRows = groupIds.map(gid =>
    buildGroupRow(gid, grouped.get(gid)!, domain, region, env, extractedAt)
  )

  let t0 = Date.now()
  for (let i = 0; i < groupRows.length; i += GROUP_BATCH_SIZE) {
    const batch = groupRows.slice(i, i + GROUP_BATCH_SIZE)
    await remote.batch(
      batch.map(row => ({ sql: GROUP_SQL, args: GROUP_COLS.map(c => (row as AnyRow)[c] ?? null) })),
      'write'
    )
    process.stdout.write(`\r  groups: ${Math.min(i + GROUP_BATCH_SIZE, groupRows.length)}/${groupRows.length}`)
  }
  console.log(`  (${Date.now() - t0}ms)`)

  // ── Insert supply rows ──────────────────────────────────────────────────────
  const supplyRows = groupIds.flatMap(gid =>
    buildSupplyRows(gid, grouped.get(gid)!, domain)
  )

  t0 = Date.now()
  for (let i = 0; i < supplyRows.length; i += SUPPLY_BATCH_SIZE) {
    const batch = supplyRows.slice(i, i + SUPPLY_BATCH_SIZE)
    await remote.batch(
      batch.map(row => ({ sql: SUPPLY_SQL, args: SUPPLY_COLS.map(c => (row as AnyRow)[c] ?? null) })),
      'write'
    )
    process.stdout.write(`\r  supply: ${Math.min(i + SUPPLY_BATCH_SIZE, supplyRows.length)}/${supplyRows.length}`)
  }
  console.log(`  (${Date.now() - t0}ms)`)

  console.log(`  ✓ ${groupRows.length} groups, ${supplyRows.length} supply records`)
}

async function main() {
  console.log(`Target: ${DATABASE_URL}`)
  const remote = createClient({ url: DATABASE_URL!, authToken: TURSO_AUTH_TOKEN })

  // Apply schema (idempotent — CREATE TABLE IF NOT EXISTS)
  console.log('Applying schema...')
  const schemaPath = path.join(process.cwd(), 'lib', 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  const schemaStatements = schemaSql.split(';').map(s => s.trim()).filter(s => s.length > 0)
  await remote.batch(schemaStatements.map(sql => ({ sql, args: [] })), 'write')

  for (const { file, region, env } of FILES) {
    await migrateFile(remote, file, region, env)
  }

  // Verification summary
  const res = await remote.execute(
    'SELECT domain, COUNT(*) as cnt FROM formulary_groups GROUP BY domain ORDER BY domain'
  )
  console.log('\n── Verification ───────────────────────────────────────')
  for (const row of res.rows) {
    console.log(`  ${row.domain}: ${row.cnt} groups`)
  }
  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
