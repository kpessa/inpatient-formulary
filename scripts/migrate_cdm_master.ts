/**
 * Migration: Load CDM (Charge Description Master) CSV into Turso.
 *
 * Usage:
 *   npx tsx scripts/migrate_cdm_master.ts [path-to-csv]
 *
 * Default CSV: ~/Downloads/Pharmacy CDM Oct03 25.csv
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

const csvPath = process.argv[2] || path.join(process.env.HOME ?? '', 'Downloads', 'Pharmacy CDM Oct03 25.csv')

async function migrate() {
  console.log(`Loading CDM master from: ${csvPath}`)

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`)
    process.exit(1)
  }

  // Create table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cdm_master (
      cdm_code    TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      tech_desc   TEXT NOT NULL DEFAULT '',
      ins_code    TEXT NOT NULL DEFAULT '',
      gl_key      TEXT NOT NULL DEFAULT '',
      proc_code   TEXT NOT NULL DEFAULT '',
      rev_code    TEXT NOT NULL DEFAULT '',
      divisor     TEXT NOT NULL DEFAULT ''
    )
  `)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cdm_description ON cdm_master(LOWER(description))')
  await db.execute('CREATE INDEX IF NOT EXISTS idx_cdm_proc_code ON cdm_master(proc_code)')

  // Parse CSV (simple — no quoted commas in this file)
  const raw = fs.readFileSync(csvPath, 'utf8')
  const lines = raw.trim().split('\n')
  const header = lines[0].split(',')
  console.log(`Columns: ${header.join(', ')}`)
  console.log(`Rows: ${lines.length - 1}`)

  // Clear existing data
  await db.execute('DELETE FROM cdm_master')

  // Batch insert (100 rows per batch for Turso limits)
  const BATCH_SIZE = 100
  let inserted = 0

  for (let i = 1; i < lines.length; i += BATCH_SIZE) {
    const batch = lines.slice(i, i + BATCH_SIZE)
    const stmts = batch.map(line => {
      // Handle potential quoted fields
      const cols = line.split(',')
      const cdmCode = (cols[0] ?? '').trim()
      const desc = (cols[1] ?? '').trim()
      const techDesc = (cols[2] ?? '').trim()
      const insCode = (cols[3] ?? '').trim()
      const glKey = (cols[4] ?? '').trim()
      const procCode = (cols[5] ?? '').trim()
      const revCode = (cols[6] ?? '').trim()
      const divisor = (cols[7] ?? '').trim()

      return {
        sql: 'INSERT OR REPLACE INTO cdm_master (cdm_code, description, tech_desc, ins_code, gl_key, proc_code, rev_code, divisor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [cdmCode, desc, techDesc, insCode, glKey, procCode, revCode, divisor],
      }
    }).filter(s => s.args[0]) // skip empty cdm_code

    if (stmts.length > 0) {
      await db.batch(stmts, 'write')
      inserted += stmts.length
    }

    if (inserted % 1000 === 0 || i + BATCH_SIZE >= lines.length) {
      console.log(`  Inserted ${inserted} rows...`)
    }
  }

  const { rows } = await db.execute('SELECT COUNT(*) AS cnt FROM cdm_master')
  console.log(`Done. cdm_master has ${rows[0].cnt} rows.`)

  // Quick stats
  const { rows: overlap } = await db.execute(`
    SELECT COUNT(DISTINCT fg.charge_number) AS cnt
    FROM formulary_groups fg
    JOIN cdm_master cm ON fg.charge_number = cm.cdm_code
    WHERE fg.charge_number != '' AND fg.charge_number != 'NO ENTRY'
  `)
  const { rows: unbuilt } = await db.execute(`
    SELECT COUNT(*) AS cnt FROM cdm_master cm
    WHERE NOT EXISTS (SELECT 1 FROM formulary_groups fg WHERE fg.charge_number = cm.cdm_code)
  `)
  console.log(`\nOverlap: ${overlap[0].cnt} charge numbers match formulary`)
  console.log(`Unbuilt CDMs (no Cerner product): ${unbuilt[0].cnt}`)
}

migrate().catch(err => { console.error(err); process.exit(1) })
