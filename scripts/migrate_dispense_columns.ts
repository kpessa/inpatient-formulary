/**
 * Migration: Extract dispense strength/volume fields from dispense_json
 * to top-level indexed columns for fast search and display.
 *
 * Usage:
 *   npx tsx scripts/migrate_dispense_columns.ts
 */

import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'

if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
      if (m) process.env[m[1]] = m[2]
    }
  }
}

const db = createClient({
  url: process.env.DATABASE_URL ?? '',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function migrate() {
  console.log('Adding dispense strength/volume columns...')

  const cols = [
    { name: 'dispense_strength', default: "''" },
    { name: 'dispense_strength_unit', default: "''" },
    { name: 'dispense_volume', default: "''" },
    { name: 'dispense_volume_unit', default: "''" },
  ]

  for (const col of cols) {
    try {
      await db.execute(`ALTER TABLE formulary_groups ADD COLUMN ${col.name} TEXT NOT NULL DEFAULT ${col.default}`)
      console.log(`  Added column: ${col.name}`)
    } catch (e) {
      if (String(e).includes('duplicate column')) {
        console.log(`  Column ${col.name} already exists, skipping`)
      } else throw e
    }
  }

  console.log('Populating from dispense_json...')
  await db.execute(`
    UPDATE formulary_groups SET
      dispense_strength = COALESCE(CAST(json_extract(dispense_json, '$.strength') AS TEXT), ''),
      dispense_strength_unit = COALESCE(json_extract(dispense_json, '$.strengthUnit'), ''),
      dispense_volume = COALESCE(CAST(json_extract(dispense_json, '$.volume') AS TEXT), ''),
      dispense_volume_unit = COALESCE(json_extract(dispense_json, '$.volumeUnit'), '')
    WHERE dispense_json != '{}'
  `)

  console.log('Creating index...')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_fg_dispense_strength ON formulary_groups(dispense_strength)')

  // Stats
  const { rows: [r1] } = await db.execute("SELECT COUNT(*) AS cnt FROM formulary_groups WHERE dispense_strength != ''")
  const { rows: [r2] } = await db.execute("SELECT COUNT(*) AS cnt FROM formulary_groups WHERE dispense_volume != '' AND dispense_volume != '0'")
  console.log(`Done. ${r1.cnt} rows with strength, ${r2.cnt} rows with non-zero volume.`)
}

migrate().catch(err => { console.error(err); process.exit(1) })
