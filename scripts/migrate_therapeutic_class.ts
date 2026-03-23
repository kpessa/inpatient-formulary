/**
 * Migration: add therapeutic_class column to formulary_groups,
 * populate from clinical_json blob, and create an index.
 *
 * Without this, therapeutic class queries use json_extract() on a 75MB+
 * JSON blob — a full table scan (~40s on Turso). With the indexed column
 * queries drop to ~200ms.
 *
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/migrate_therapeutic_class.ts
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
  console.log('Adding therapeutic_class column...')
  try {
    await db.execute("ALTER TABLE formulary_groups ADD COLUMN therapeutic_class TEXT NOT NULL DEFAULT ''")
    console.log('  ✓ therapeutic_class column added')
  } catch {
    console.log('  – therapeutic_class column already exists, skipping')
  }

  console.log('Populating therapeutic_class from clinical_json...')
  const { rowsAffected } = await db.execute(`
    UPDATE formulary_groups
    SET therapeutic_class = COALESCE(json_extract(clinical_json, '$.therapeuticClass'), '')
    WHERE therapeutic_class = ''
  `)
  console.log(`  ✓ Updated ${rowsAffected} rows`)

  console.log('Creating index...')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_fg_therapeutic_class ON formulary_groups(therapeutic_class)')
  console.log('  ✓ idx_fg_therapeutic_class')

  console.log('\nMigration complete.')
}

run().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
