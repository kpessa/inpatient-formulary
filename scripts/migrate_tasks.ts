/**
 * One-time migration: creates change_tasks, field_overrides, product_builds,
 * and build_domain_progress tables in Turso.
 *
 * Usage:
 *   tsx scripts/migrate_tasks.ts
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
  console.log('Running task system migration…')

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS change_tasks (
      id TEXT PRIMARY KEY,
      drug_key TEXT NOT NULL,
      drug_description TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('diff', 'free_form')),
      field_name TEXT,
      field_label TEXT,
      target_domain TEXT,
      domain_values TEXT,
      target_value TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
      assigned_to TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ct_drug_key ON change_tasks(drug_key);
    CREATE INDEX IF NOT EXISTS idx_ct_status ON change_tasks(status);

    CREATE TABLE IF NOT EXISTS field_overrides (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      group_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      override_value TEXT NOT NULL,
      task_id TEXT,
      applied_at TEXT NOT NULL,
      applied_by TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fo_domain_group ON field_overrides(domain, group_id);

    CREATE TABLE IF NOT EXISTS product_builds (
      id TEXT PRIMARY KEY,
      drug_description TEXT NOT NULL,
      drug_key TEXT,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'review', 'complete')),
      notes TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS build_domain_progress (
      build_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      PRIMARY KEY (build_id, domain)
    );

    CREATE TABLE IF NOT EXISTS task_domain_progress (
      task_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
      completed_at TEXT,
      completed_by TEXT,
      notes TEXT,
      PRIMARY KEY (task_id, domain)
    );

    CREATE INDEX IF NOT EXISTS idx_tdp_task_id ON task_domain_progress(task_id);
  `)

  // Add group_id column (idempotent — ignores if already exists)
  try {
    await db.execute('ALTER TABLE change_tasks ADD COLUMN group_id TEXT')
    console.log('Added group_id column to change_tasks')
  } catch {
    // Column already exists
  }

  console.log('Migration complete.')
}

migrate().catch(err => { console.error(err); process.exit(1) })
