/**
 * One-time migration: creates multum_ndcs table in Turso and loads
 * NDC cost/package data from the Multum CSV extract.
 *
 * Usage:
 *   npx tsx scripts/load_multum_ndcs.ts
 *
 * Source file: ~/Downloads/ndc_costs_multum.csv
 */

import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'
import os from 'os'

// Load .env.local if DATABASE_URL not set
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

const CSV_PATH = path.join(os.homedir(), 'Downloads', 'ndc_costs_multum.csv')
const CHUNK_SIZE = 500

async function run() {
  console.log('Creating multum_ndcs table…')
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS multum_ndcs (
      ndc_formatted  TEXT PRIMARY KEY,
      a_cost         REAL,
      awp            REAL,
      inner_pkg_size REAL,
      inner_pkg_code TEXT,
      outer_pkg_size REAL,
      unit_dose_code TEXT,
      gbo            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mn_ndc ON multum_ndcs(ndc_formatted);
  `)

  console.log(`Reading CSV from ${CSV_PATH}…`)
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  // Strip BOM if present
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
  const lines = content.split('\n')
  const header = lines[0].split(',')

  const col = (name: string) => header.indexOf(name)
  const iAcost   = col('A_COST')
  const iAwp     = col('AWP')
  const iInnerSz = col('INNER_PACKAGE_SIZE')
  const iInnerCd = col('INNER_PACKAGE_DESC_CODE')
  const iOuterSz = col('OUTER_PACKAGE_SIZE')
  const iUd      = col('UNIT_DOSE_CODE')
  const iGbo     = col('GBO')
  const iNdc     = col('NDC_FORMATTED')

  const rows: string[][] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    const ndc = (parts[iNdc] ?? '').trim()
    if (!ndc) continue
    rows.push(parts)
  }

  console.log(`Loaded ${rows.length} rows. Inserting in chunks of ${CHUNK_SIZE}…`)

  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const stmts = chunk.map(parts => ({
      sql: `INSERT OR REPLACE INTO multum_ndcs
              (ndc_formatted, a_cost, awp, inner_pkg_size, inner_pkg_code, outer_pkg_size, unit_dose_code, gbo)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        parts[iNdc].trim(),
        parseFloat(parts[iAcost]) || null,
        parseFloat(parts[iAwp])   || null,
        parseFloat(parts[iInnerSz]) || null,
        (parts[iInnerCd] ?? '').trim() || null,
        parseFloat(parts[iOuterSz]) || null,
        (parts[iUd] ?? '').trim() || null,
        (parts[iGbo] ?? '').trim() || null,
      ],
    }))
    await db.batch(stmts, 'write')
    inserted += chunk.length
    process.stdout.write(`\r  ${inserted}/${rows.length}`)
  }

  console.log(`\nDone — ${inserted} NDC records loaded into multum_ndcs.`)
  process.exit(0)
}

run().catch(e => { console.error(e); process.exit(1) })
