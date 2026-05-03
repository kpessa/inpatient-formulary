/**
 * One-off diagnostic — verify the mltm_* tables loaded correctly.
 *
 * Probe is reporting 0 siblings for MMDC 7081 (Fluoxetine 40 mg cap), but the
 * source xlsx has 60 active. This script narrows down whether:
 *   - rows didn't load (counts mismatch),
 *   - the MMDC column got coerced wrong (counts ok but main_multum_drug_code
 *     is null/wrong), or
 *   - the obsolete_date column has empty strings instead of NULL (filter
 *     wipes out everything).
 *
 * Usage: pnpm exec tsx scripts/check_mltm_loaded.ts
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

async function row(sql: string, args: unknown[] = []) {
  const r = await db.execute({ sql, args: args as never })
  return r.rows
}

async function main() {
  console.log('=== Sanity counts ===')
  const total = await row(`SELECT COUNT(*) AS n FROM mltm_ndc`)
  console.log(`mltm_ndc total rows: ${total[0].n}`)

  const nullMmdc = await row(`SELECT COUNT(*) AS n FROM mltm_ndc WHERE main_multum_drug_code IS NULL`)
  console.log(`  with main_multum_drug_code IS NULL: ${nullMmdc[0].n}`)

  const nullObs = await row(`SELECT COUNT(*) AS n FROM mltm_ndc WHERE obsolete_date IS NULL`)
  console.log(`  with obsolete_date IS NULL: ${nullObs[0].n}`)

  const emptyObs = await row(`SELECT COUNT(*) AS n FROM mltm_ndc WHERE obsolete_date = ''`)
  console.log(`  with obsolete_date = '' (empty string — would be a bug): ${emptyObs[0].n}`)

  console.log('\n=== MMDC 7081 (Fluoxetine 40 mg capsule) ===')
  const mmdc7081All = await row(`SELECT COUNT(*) AS n FROM mltm_ndc WHERE main_multum_drug_code = 7081`)
  console.log(`Total rows: ${mmdc7081All[0].n}    (xlsx has 130)`)

  const mmdc7081Active = await row(
    `SELECT COUNT(*) AS n FROM mltm_ndc WHERE main_multum_drug_code = 7081 AND obsolete_date IS NULL`,
  )
  console.log(`Active (obsolete_date IS NULL): ${mmdc7081Active[0].n}    (xlsx has 60)`)

  const sample = await row(
    `SELECT ndc_formatted, main_multum_drug_code, obsolete_date FROM mltm_ndc WHERE main_multum_drug_code = 7081 LIMIT 8`,
  )
  console.log(`Sample rows for MMDC 7081:`)
  for (const r of sample) {
    console.log(`  ${r.ndc_formatted}  mmdc=${r.main_multum_drug_code}  obsolete_date=${JSON.stringify(r.obsolete_date)}`)
  }

  console.log('\n=== Scanned NDC (00093-7198-56) ===')
  const scanned = await row(
    `SELECT ndc_formatted, main_multum_drug_code, obsolete_date FROM mltm_ndc WHERE ndc_formatted = '00093-7198-56'`,
  )
  console.log(scanned[0] ?? 'NOT FOUND')

  // ---- Replicate the probe queries with parameter binding ----
  console.log('\n=== Probe query Step 1 (parameterized) ===')
  const step1 = await db.execute({
    sql: `SELECT n.main_multum_drug_code AS mmdc,
                 mc.drug_identifier      AS drug_id,
                 di.is_single_ingredient AS single_ingredient,
                 ps.product_strength_description AS strength_desc,
                 df.dose_form_description AS form_desc,
                 (SELECT dn.drug_name FROM mltm_drug_name dn
                  WHERE dn.drug_synonym_id = di.drug_synonym_id AND dn.is_obsolete = 'F'
                  ORDER BY dn.drug_name LIMIT 1) AS drug_name
          FROM mltm_ndc n
          LEFT JOIN mltm_main_drug_code mc ON mc.main_multum_drug_code = n.main_multum_drug_code
          LEFT JOIN mltm_drug_id di ON di.drug_identifier = mc.drug_identifier
          LEFT JOIN mltm_product_strength ps ON ps.product_strength_code = mc.product_strength_code
          LEFT JOIN mltm_dose_form df ON df.dose_form_code = mc.dose_form_code
          WHERE n.ndc_formatted = ?
          LIMIT 1`,
    args: ['00093-7198-56'],
  })
  const s = step1.rows[0]
  console.log('Row:', s)
  console.log('typeof mmdc:', typeof s?.mmdc, '— value:', s?.mmdc)

  console.log('\n=== Probe query Step 2 (sibling count, parameterized) ===')
  const mmdcBound = s?.mmdc
  const step2a = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM mltm_ndc
          WHERE main_multum_drug_code = ?
            AND ndc_formatted != ?
            AND obsolete_date IS NULL`,
    args: [mmdcBound as never, '00093-7198-56'],
  })
  console.log(`COUNT with mmdc=${JSON.stringify(mmdcBound)} (typeof ${typeof mmdcBound}):`, step2a.rows[0]?.n)

  // Try with explicit number
  const step2b = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM mltm_ndc
          WHERE main_multum_drug_code = ?
            AND ndc_formatted != ?
            AND obsolete_date IS NULL`,
    args: [7081, '00093-7198-56'],
  })
  console.log('COUNT with literal int 7081:', step2b.rows[0]?.n)

  // Try with literal SQL (no params)
  const step2c = await row(
    `SELECT COUNT(*) AS n FROM mltm_ndc
     WHERE main_multum_drug_code = 7081
       AND ndc_formatted != '00093-7198-56'
       AND obsolete_date IS NULL`,
  )
  console.log('COUNT with literal SQL (no params):', step2c[0]?.n)

  // ---- Compare against the embedded replica the dev server uses ----
  console.log('\n=== Embedded replica check (what the dev server sees) ===')
  const replicaPath = `${process.env.HOME}/Library/Caches/inpatient-formulary/replica.db`
  console.log(`Replica path: ${replicaPath}`)
  if (!fs.existsSync(replicaPath)) {
    console.log('  Replica file does NOT exist — dev server hasn\'t initialized it yet.')
  } else {
    const stat = fs.statSync(replicaPath)
    console.log(`  Replica size: ${(stat.size / 1024 / 1024).toFixed(1)} MB, last modified: ${stat.mtime.toISOString()}`)

    // Open the replica file directly (no sync, just read) — note: if dev server
    // has it locked, this may fail. That's OK; we just want a snapshot.
    const replica = createClient({ url: `file:${replicaPath}` })
    try {
      const total = await replica.execute('SELECT COUNT(*) AS n FROM mltm_ndc')
      console.log(`  Replica mltm_ndc rows: ${total.rows[0].n}    (Turso has 229,060)`)

      const c = await replica.execute({
        sql: `SELECT COUNT(*) AS n FROM mltm_ndc WHERE main_multum_drug_code = 7081 AND obsolete_date IS NULL`,
      })
      console.log(`  Replica MMDC 7081 active: ${c.rows[0].n}    (Turso has 60)`)
    } catch (e) {
      console.log(`  Could not read replica directly: ${(e as Error).message}`)
    }

    // Try forcing a sync against this replica.
    console.log('\nForcing sync of dev-server replica from Turso…')
    const syncing = createClient({
      url: `file:${replicaPath}`,
      syncUrl: process.env.DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
    try {
      await syncing.sync()
      console.log('  sync() completed successfully.')
      const c2 = await syncing.execute({
        sql: `SELECT COUNT(*) AS n FROM mltm_ndc WHERE main_multum_drug_code = 7081 AND obsolete_date IS NULL`,
      })
      console.log(`  Post-sync MMDC 7081 active: ${c2.rows[0].n}`)
    } catch (e) {
      console.log(`  sync() failed: ${(e as Error).message}`)
      console.log('  → If dev server has the file locked, restart it (Ctrl+C, pnpm dev) — that triggers an initial sync.')
    }
  }

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
