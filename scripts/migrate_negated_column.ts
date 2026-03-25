/**
 * Migration: Adds `negated` column to category_rules table.
 *
 * Usage:
 *   npx tsx scripts/migrate_negated_column.ts
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
  console.log('Adding negated column to category_rules…')
  await db.execute('ALTER TABLE category_rules ADD COLUMN negated INTEGER NOT NULL DEFAULT 0')
  const { rows } = await db.execute('SELECT COUNT(*) AS cnt FROM category_rules')
  console.log(`Done. category_rules now has ${rows[0].cnt} rows with negated column.`)
}

migrate().catch(err => {
  if (String(err).includes('duplicate column')) {
    console.log('Column already exists, skipping.')
  } else {
    console.error(err)
    process.exit(1)
  }
})
