/**
 * One-time migration: creates category_exclusions table in Turso.
 *
 * Usage:
 *   npx tsx scripts/migrate_category_exclusions.ts
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
  console.log('Creating category_exclusions table…')
  await db.execute(`
    CREATE TABLE IF NOT EXISTS category_exclusions (
      category_id      TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
      group_id         TEXT NOT NULL,
      drug_description TEXT NOT NULL DEFAULT '',
      added_at         TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (category_id, group_id)
    )
  `)
  console.log('Done.')
}

migrate().catch(err => { console.error(err); process.exit(1) })
