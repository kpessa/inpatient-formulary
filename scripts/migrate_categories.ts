/**
 * One-time migration: creates drug_categories, category_members, and category_rules
 * tables in Turso.
 *
 * Usage:
 *   npx tsx scripts/migrate_categories.ts
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
  console.log('Running categories migration…')

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS drug_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6B7280',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS category_members (
      category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL,
      drug_description TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (category_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      operator TEXT NOT NULL CHECK (operator IN ('equals','contains','starts_with','ends_with')),
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  console.log('Categories migration complete.')
}

migrate().catch(err => { console.error(err); process.exit(1) })
