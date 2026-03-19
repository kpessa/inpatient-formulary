/**
 * Build a local SQLite file from CSV extracts using better-sqlite3.
 * No network calls — runs in seconds.
 *
 * Then import to Turso with:
 *   ~/.turso/turso db import data/staging_formulary.db
 *
 * File → domain mapping:
 *   c152e_extract.csv  →  region: "east",    environment: "cert"
 *   p152w_extract.csv  →  region: "west",    environment: "prod"
 *   p152c_extract.csv  →  region: "central", environment: "prod"
 *
 * Usage:
 *   tsx scripts/build_local_sqlite.ts
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import Papa from 'papaparse'
import { buildGroupRow, buildSupplyRows } from '../lib/csvTransform'
import type { Row } from '../lib/csvTransform'

const OUT_FILE = path.join(process.cwd(), 'data', 'staging_formulary.db')
const SCHEMA_FILE = path.join(process.cwd(), 'lib', 'schema.sql')

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

function main() {
  // Remove stale output file
  if (fs.existsSync(OUT_FILE)) {
    fs.unlinkSync(OUT_FILE)
    console.log(`Removed existing ${OUT_FILE}`)
  }

  const db = new Database(OUT_FILE)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // Apply schema
  console.log('Applying schema...')
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8')
  db.exec(schema)

  const insertGroup = db.prepare(
    `INSERT INTO formulary_groups (${GROUP_COLS.join(', ')}) VALUES (${GROUP_COLS.map(() => '?').join(', ')})`
  )
  const insertSupply = db.prepare(
    `INSERT INTO supply_records (${SUPPLY_COLS.join(', ')}) VALUES (${SUPPLY_COLS.map(() => '?').join(', ')})`
  )

  type AnyRow = Record<string, unknown>

  for (const { file, region, env } of FILES) {
    const csvPath = path.join(process.cwd(), 'data', file)
    const domain = `${region}_${env}`

    console.log(`\n── ${file}  →  ${domain} ──────────────────────────`)

    if (!fs.existsSync(csvPath)) {
      console.log(`  Skipping — file not found`)
      continue
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

    // Wrap in a single transaction — orders of magnitude faster than autocommit
    const t0 = Date.now()
    db.transaction(() => {
      for (const gid of groupIds) {
        const rows = grouped.get(gid)!
        const g = buildGroupRow(gid, rows, domain, region, env, extractedAt)
        insertGroup.run(GROUP_COLS.map(c => (g as AnyRow)[c] ?? null))

        for (const s of buildSupplyRows(gid, rows, domain)) {
          insertSupply.run(SUPPLY_COLS.map(c => (s as AnyRow)[c] ?? null))
        }
      }
    })()

    const supplyCount = db.prepare('SELECT COUNT(*) as cnt FROM supply_records WHERE domain = ?').get(domain) as { cnt: number }
    console.log(`  ✓ ${groupIds.length} groups, ${supplyCount.cnt} supply records  (${Date.now() - t0}ms)`)
  }

  // Summary
  console.log('\n── Summary ─────────────────────────────────────────')
  const rows = db.prepare('SELECT domain, COUNT(*) as cnt FROM formulary_groups GROUP BY domain ORDER BY domain').all() as { domain: string; cnt: number }[]
  for (const row of rows) {
    console.log(`  ${row.domain}: ${row.cnt} groups`)
  }

  db.close()

  const sizeMb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)
  console.log(`\nOutput: ${OUT_FILE} (${sizeMb} MB)`)
  console.log('\nNext step:')
  console.log('  ~/.turso/turso db import data/staging_formulary.db')
}

main()
