/**
 * Migration: Recreates category_rules table without the restrictive CHECK constraint
 * on the `operator` column. SQLite doesn't support ALTER COLUMN, so we recreate.
 *
 * Usage:
 *   npx tsx scripts/migrate_operator_constraint.ts
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
  console.log('Migrating category_rules: expanding operator CHECK constraint…')

  await db.execute('PRAGMA foreign_keys = OFF')

  await db.execute(`
    CREATE TABLE IF NOT EXISTS category_rules_new (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      operator TEXT NOT NULL CHECK (operator IN ('equals','contains','starts_with','ends_with','in','matches_regex')),
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  await db.execute(`
    INSERT OR IGNORE INTO category_rules_new (id, category_id, field, operator, value, created_at)
    SELECT id, category_id, field, operator, value, created_at FROM category_rules
  `)

  await db.execute('DROP TABLE category_rules')
  await db.execute('ALTER TABLE category_rules_new RENAME TO category_rules')
  await db.execute('PRAGMA foreign_keys = ON')

  const { rows } = await db.execute('SELECT COUNT(*) AS cnt FROM category_rules')
  console.log(`Done. category_rules now has ${rows[0].cnt} rows with expanded operator constraint.`)
}

migrate().catch(err => { console.error(err); process.exit(1) })
