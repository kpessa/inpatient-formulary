/**
 * Migration: add route + dispense_category columns to formulary_groups,
 * populate them from existing JSON blobs, create indexes, and create
 * the search_filter_groups table.
 *
 * Idempotent — safe to re-run. Each ALTER TABLE is wrapped in try/catch
 * since SQLite returns an error if the column already exists.
 *
 * Usage:
 *   npx tsx scripts/migrate_filter_columns.ts
 */

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

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const db = createClient({ url: DATABASE_URL, authToken: TURSO_AUTH_TOKEN })

async function run() {
  console.log('Adding route column...')
  try {
    await db.execute("ALTER TABLE formulary_groups ADD COLUMN route TEXT NOT NULL DEFAULT ''")
    console.log('  ✓ route column added')
  } catch {
    console.log('  – route column already exists, skipping')
  }

  console.log('Adding dispense_category column...')
  try {
    await db.execute("ALTER TABLE formulary_groups ADD COLUMN dispense_category TEXT NOT NULL DEFAULT ''")
    console.log('  ✓ dispense_category column added')
  } catch {
    console.log('  – dispense_category column already exists, skipping')
  }

  console.log('Populating route and dispense_category from JSON...')
  const { rowsAffected } = await db.execute(`
    UPDATE formulary_groups SET
      route             = COALESCE(json_extract(oe_defaults_json, '$.route'), ''),
      dispense_category = COALESCE(json_extract(dispense_json, '$.dispenseCategory'), '')
    WHERE route = '' OR dispense_category = ''
  `)
  console.log(`  ✓ Updated ${rowsAffected} rows`)

  console.log('Creating indexes...')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_fg_dosage_form  ON formulary_groups(dosage_form)')
  console.log('  ✓ idx_fg_dosage_form')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_fg_route        ON formulary_groups(route)')
  console.log('  ✓ idx_fg_route')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_fg_dispense_cat ON formulary_groups(dispense_category)')
  console.log('  ✓ idx_fg_dispense_cat')

  console.log('Creating search_filter_groups table...')
  await db.execute(`
    CREATE TABLE IF NOT EXISTS search_filter_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '',
      field       TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `)
  console.log('  ✓ search_filter_groups table ready')

  console.log('\nMigration complete.')
}

run().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
