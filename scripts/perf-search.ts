import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'

if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env.local')
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
    if (m) process.env[m[1]] = m[2]
  }
}

const replicaPath = `${process.env.HOME}/Library/Caches/inpatient-formulary/replica.db`
// Two clients: plain (file: only) vs syncing (mimics what the dev server uses).
const db = createClient({ url: `file:${replicaPath}` })
const dbSync = createClient({
  url: `file:${replicaPath}`,
  syncUrl: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncInterval: 60,
})

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now()
  const r = await fn()
  console.log(`${label}: ${Math.round(performance.now() - t)}ms`)
  return r
}

async function main() {
  console.log('=== Row counts ===')
  const fgCount = await db.execute('SELECT COUNT(*) AS n FROM formulary_groups')
  console.log(`formulary_groups: ${fgCount.rows[0].n}`)
  const cdmCount = await db.execute('SELECT COUNT(*) AS n FROM cdm_master')
  console.log(`cdm_master: ${cdmCount.rows[0].n}`)

  console.log('\n=== Indexes on formulary_groups ===')
  const idx = await db.execute(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='formulary_groups'`
  )
  for (const r of idx.rows) console.log(`  ${r.name}: ${r.sql ?? '(auto)'}`)

  console.log('\n=== Indexes on cdm_master ===')
  const cidx = await db.execute(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='cdm_master'`
  )
  for (const r of cidx.rows) console.log(`  ${r.name}: ${r.sql ?? '(auto)'}`)

  console.log('\n=== Time the COUNT query ===')
  const likeQ = 'aspirin%'
  const countSql = `SELECT COUNT(*) AS cnt FROM formulary_groups
    WHERE status = 'Active' AND (
      LOWER(description) LIKE ? OR LOWER(generic_name) LIKE ? OR LOWER(mnemonic) LIKE ? OR
      LOWER(charge_number) LIKE ? OR LOWER(brand_name) LIKE ? OR LOWER(brand_name2) LIKE ? OR
      LOWER(brand_name3) LIKE ? OR LOWER(pyxis_id) LIKE ?
    )`
  const args = Array(8).fill(likeQ)
  const cnt = await time('count (cold)', () => db.execute({ sql: countSql, args }))
  console.log(`  -> result: ${cnt.rows[0].cnt}`)
  await time('count (warm)', () => db.execute({ sql: countSql, args }))

  console.log('\n=== Time the SELECT query ===')
  const selSql = `SELECT group_id, description, generic_name, strength, strength_unit,
                         dosage_form, mnemonic, status, charge_number, brand_name,
                         formulary_status, pyxis_id, region, environment,
                         dispense_strength, dispense_strength_unit, dispense_volume, dispense_volume_unit,
                         dispense_category
                  FROM formulary_groups
                  WHERE status = 'Active' AND (
                    LOWER(description) LIKE ? OR LOWER(generic_name) LIKE ? OR LOWER(mnemonic) LIKE ? OR
                    LOWER(charge_number) LIKE ? OR LOWER(brand_name) LIKE ? OR LOWER(brand_name2) LIKE ? OR
                    LOWER(brand_name3) LIKE ? OR LOWER(pyxis_id) LIKE ?
                  )
                  LIMIT ?`
  const sel = await time('select (cold)', () => db.execute({ sql: selSql, args: [...args, 500] }))
  console.log(`  -> rows: ${sel.rows.length}`)
  await time('select (warm)', () => db.execute({ sql: selSql, args: [...args, 500] }))

  console.log('\n=== Time db.batch (count+select) — plain file: client ===')
  await time('batch (cold)', () => db.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'read'))
  await time('batch (warm)', () => db.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'read'))

  console.log('\n=== Time db.batch — SYNCING client (mimics dev server) ===')
  await time('sync-batch read #1', () => dbSync.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'read'))
  await time('sync-batch read #2', () => dbSync.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'read'))

  console.log('\n=== Same syncing client, single execute (no batch) ===')
  await time('sync-execute count #1', () => dbSync.execute({ sql: countSql, args }))
  await time('sync-execute count #2', () => dbSync.execute({ sql: countSql, args }))
  await time('sync-execute select #1', () => dbSync.execute({ sql: selSql, args: [...args, 500] }))
  await time('sync-execute select #2', () => dbSync.execute({ sql: selSql, args: [...args, 500] }))

  console.log('\n=== Syncing client w/ "deferred" transaction (default, not read) ===')
  await time('sync-batch deferred #1', () => dbSync.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'deferred'))
  await time('sync-batch deferred #2', () => dbSync.batch([
    { sql: countSql, args },
    { sql: selSql, args: [...args, 500] },
  ], 'deferred'))

  console.log('\n=== EXPLAIN QUERY PLAN ===')
  const explain = await db.execute({ sql: `EXPLAIN QUERY PLAN ${countSql}`, args })
  for (const r of explain.rows) console.log(`  ${r.detail}`)

  console.log('\n=== searchCdmUnbuilt query ===')
  const cdmUnbuiltSql = `SELECT cdm_code, description, tech_desc, proc_code, rev_code, divisor
                         FROM cdm_master
                         WHERE LOWER(description) LIKE ? OR LOWER(tech_desc) LIKE ?
                         LIMIT 50`
  await time('cdmUnbuilt (cold)', () => db.execute({ sql: cdmUnbuiltSql, args: ['%aspirin%', '%aspirin%'] }))
  await time('cdmUnbuilt (warm)', () => db.execute({ sql: cdmUnbuiltSql, args: ['%aspirin%', '%aspirin%'] }))

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
