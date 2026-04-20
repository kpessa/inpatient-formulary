/**
 * Merge all non-CSV tables from a Turso production DB into the local staging SQLite.
 *
 * Usage:
 *   tsx scripts/merge_task_tables.ts <turso-db-name>
 *
 * Reads all rows from user-managed tables in the remote Turso DB
 * and inserts them into data/staging_formulary.db (which must already exist).
 */

import { createClient } from '@libsql/client'
import Database from 'better-sqlite3'
import path from 'path'
import { execSync } from 'child_process'

const STAGING_DB = path.join(process.cwd(), 'data', 'staging_formulary.db')
const TURSO_DB_NAME = process.argv[2]

if (!TURSO_DB_NAME) {
  console.error('Usage: tsx scripts/merge_task_tables.ts <turso-db-name>')
  process.exit(1)
}

const TABLES_TO_MERGE = [
  // Task system
  'change_tasks',
  'field_overrides',
  'product_builds',
  'build_domain_progress',
  'task_domain_progress',
  // Categories
  'drug_categories',
  'category_members',
  'category_pyxis_ids',
  'category_rules',
  'category_exclusions',
  // Filter groups
  'search_filter_groups',
  // Design patterns
  'design_patterns',
  'pattern_field_rules',
  // Reference data
  'cdm_master',
  'multum_ndcs',
]

async function main() {
  // Get auth token from .env.local
  const envFile = path.join(process.cwd(), '.env.local')
  const envContent = require('fs').readFileSync(envFile, 'utf8')
  const tokenMatch = envContent.match(/TURSO_AUTH_TOKEN="([^"]+)"/)
  if (!tokenMatch) {
    console.error('Could not find TURSO_AUTH_TOKEN in .env.local')
    process.exit(1)
  }

  const org = 'kpessa'
  const region = 'aws-us-east-1'
  const url = `libsql://${TURSO_DB_NAME}-${org}.${region}.turso.io`
  const authToken = tokenMatch[1]

  console.log(`Connecting to Turso: ${TURSO_DB_NAME}`)
  const turso = createClient({ url, authToken })
  const local = new Database(STAGING_DB)

  for (const table of TABLES_TO_MERGE) {
    try {
      const result = await turso.execute(`SELECT * FROM ${table}`)
      const count = result.rows.length

      if (count === 0) {
        console.log(`  ✓ ${table}: empty, skipping`)
        continue
      }

      const columns = result.columns
      const placeholders = columns.map(() => '?').join(', ')
      const insert = local.prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      )

      const tx = local.transaction((rows: any[]) => {
        for (const row of rows) {
          insert.run(columns.map(col => (row as any)[col] ?? null))
        }
      })

      tx(result.rows)
      console.log(`  ✓ ${table}: ${count} rows merged`)
    } catch (err: any) {
      console.log(`  ⚠ ${table}: ${err.message}`)
    }
  }

  local.close()
  turso.close()
  console.log('Non-CSV table merge complete.')
}

main()
