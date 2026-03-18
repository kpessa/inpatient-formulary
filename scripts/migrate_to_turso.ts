/**
 * One-time migration: reads all rows from local formulary.db and
 * bulk-inserts them into the remote Turso DB via @libsql/client.
 *
 * Usage:
 *   DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *     tsx scripts/migrate_to_turso.ts
 *
 * Or with .env.local values already set:
 *   tsx scripts/migrate_to_turso.ts
 */

import Database from 'better-sqlite3'
import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'

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

const LOCAL_DB = path.join(process.cwd(), 'data', 'formulary.db')
const BATCH_SIZE = 100  // rows per batch() call to Turso

async function main() {
  console.log(`Source: ${LOCAL_DB}`)
  console.log(`Target: ${DATABASE_URL}`)

  const local = new Database(LOCAL_DB, { readonly: true })
  const remote = createClient({ url: DATABASE_URL!, authToken: TURSO_AUTH_TOKEN })

  // Apply schema (idempotent — CREATE TABLE IF NOT EXISTS)
  console.log('Applying schema...')
  const schemaPath = path.join(process.cwd(), 'lib', 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  // Turso batch requires individual statements; split on semicolons
  const schemaStatements = schemaSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  await remote.batch(schemaStatements.map(sql => ({ sql, args: [] })), 'write')

  // Clear remote tables first (idempotent re-run)
  console.log('Clearing remote tables...')
  await remote.batch([
    { sql: 'DELETE FROM supply_records', args: [] },
    { sql: 'DELETE FROM formulary_groups', args: [] },
  ], 'write')

  // ── Migrate formulary_groups ────────────────────────────────────────────────
  const groups = local.prepare('SELECT * FROM formulary_groups').all() as Record<string, unknown>[]
  console.log(`Migrating ${groups.length} formulary_groups rows...`)

  const groupCols = [
    'domain','region','environment','extracted_at',
    'group_id','description','generic_name','mnemonic',
    'charge_number','brand_name','brand_name2','brand_name3','pyxis_id',
    'status','formulary_status','strength','strength_unit','dosage_form','legal_status',
    'identifiers_json','oe_defaults_json','dispense_json','clinical_json','inventory_json',
  ]
  const groupPlaceholders = groupCols.map(() => '?').join(', ')
  const groupSql = `INSERT INTO formulary_groups (${groupCols.join(', ')}) VALUES (${groupPlaceholders})`

  let t0 = Date.now()
  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    const batch = groups.slice(i, i + BATCH_SIZE)
    await remote.batch(
      batch.map((row) => ({ sql: groupSql, args: groupCols.map((c) => row[c] ?? null) })),
      'write'
    )
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, groups.length)}/${groups.length}`)
  }
  console.log(`\n  Done in ${Date.now() - t0}ms`)

  // ── Migrate supply_records ──────────────────────────────────────────────────
  const supplies = local.prepare('SELECT * FROM supply_records').all() as Record<string, unknown>[]
  console.log(`Migrating ${supplies.length} supply_records rows...`)

  const supplyCols = [
    'domain','group_id',
    'ndc','is_non_reference','is_active',
    'manufacturer','manufacturer_brand','manufacturer_label_desc',
    'is_primary','is_biological','is_brand','is_unit_dose',
    'awp_cost','cost1','cost2','supply_json',
  ]
  const supplyPlaceholders = supplyCols.map(() => '?').join(', ')
  const supplySql = `INSERT INTO supply_records (${supplyCols.join(', ')}) VALUES (${supplyPlaceholders})`

  t0 = Date.now()
  for (let i = 0; i < supplies.length; i += BATCH_SIZE) {
    const batch = supplies.slice(i, i + BATCH_SIZE)
    await remote.batch(
      batch.map((row) => ({ sql: supplySql, args: supplyCols.map((c) => row[c] ?? null) })),
      'write'
    )
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, supplies.length)}/${supplies.length}`)
  }
  console.log(`\n  Done in ${Date.now() - t0}ms`)

  // Verify
  const countRes = await remote.execute('SELECT COUNT(*) as cnt FROM formulary_groups')
  console.log(`\nVerification: ${countRes.rows[0].cnt} formulary_groups in Turso`)

  local.close()
  console.log('Migration complete.')
}

main().catch((err) => { console.error(err); process.exit(1) })
