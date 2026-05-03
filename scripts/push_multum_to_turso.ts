/**
 * Stage 2 of the Multum loader: local SQLite → Turso.
 *
 * Reads the staged data/multum.db produced by scripts/load_multum_xlsx.ts and
 * bulk-inserts each mltm_* table into the remote Turso DB via @libsql/client.
 * Splitting load + push lets us pay the network cost exactly once per row,
 * and lets a failed push be retried without re-parsing the xlsx.
 *
 * Usage:
 *   tsx scripts/push_multum_to_turso.ts                     # default: data/multum.db
 *   tsx scripts/push_multum_to_turso.ts --db=/tmp/mltm.db   # custom source
 *   tsx scripts/push_multum_to_turso.ts --tables=mltm_ndc,mltm_dose_form  # subset
 *   tsx scripts/push_multum_to_turso.ts --changed           # only tables with row-count diff vs Turso
 *   BATCH_SIZE=2000 tsx scripts/push_multum_to_turso.ts     # tune chunk size
 *
 * Env: DATABASE_URL (libsql://…) and TURSO_AUTH_TOKEN. Loaded from .env.local
 * if not already in environment, matching the convention in migrate_to_turso.ts.
 */

import Database from 'better-sqlite3'
import { createClient, type InStatement } from '@libsql/client'
import path from 'path'
import fs from 'fs'
import { MULTUM_TABLE_NAMES, multumDdlStatements } from './lib/multum-tables'

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
      if (m) process.env[m[1]] = m[2]
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN

if (!DATABASE_URL || DATABASE_URL.startsWith('file:')) {
  throw new Error('Set DATABASE_URL to a libsql:// Turso URL (not a file: URL)')
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flagDb = args.find((a) => a.startsWith('--db='))?.slice('--db='.length)
const flagTables = args.find((a) => a.startsWith('--tables='))?.slice('--tables='.length)
const flagChanged = args.includes('--changed')

const DB_PATH = flagDb ? path.resolve(flagDb) : path.join(process.cwd(), 'data', 'multum.db')
const ONLY = flagTables ? new Set(flagTables.split(',').map((s) => s.trim())) : null

// 1000 = ~2× the previous direct-write loader (which used 500). Bump higher if
// you want to trade a bit more peak memory + larger libsql payloads for fewer
// round-trips. Tune via `BATCH_SIZE=2000 pnpm db:push:multum:turso`.
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the user-defined columns for a table from sqlite_master / PRAGMA. */
function getColumns(local: Database.Database, table: string): string[] {
  const rows = local.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (rows.length === 0) {
    throw new Error(`Table not found in local DB: ${table}`)
  }
  return rows.map((r) => r.name)
}

async function pushTable(
  local: Database.Database,
  remote: ReturnType<typeof createClient>,
  table: string,
) {
  const cols = getColumns(local, table)
  const total = (local.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n
  if (total === 0) {
    console.log(`  ${table}: 0 rows in local DB — skipping`)
    return
  }

  const placeholders = '(' + cols.map(() => '?').join(',') + ')'
  const insertSql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES ${placeholders}`

  console.log(`  ${table}: ${total.toLocaleString()} rows → wiping + pushing (batch=${BATCH_SIZE})`)
  const t0 = Date.now()

  await remote.execute(`DELETE FROM ${table}`)

  // Stream from local DB so we don't materialize the entire result set in memory.
  // For mltm_ndc (~229K rows) the full array would be hefty.
  const iter = local.prepare(`SELECT ${cols.join(',')} FROM ${table}`).iterate() as
    Iterable<Record<string, unknown>>

  let buf: InStatement[] = []
  let pushed = 0
  for (const row of iter) {
    // Order args by `cols` to match the placeholders. Treat undefined as null
    // for libsql safety (SQLite returns null already, but be defensive).
    const args = cols.map((c) => {
      const v = row[c]
      return (v === undefined ? null : v) as string | number | null
    })
    buf.push({ sql: insertSql, args })
    if (buf.length >= BATCH_SIZE) {
      await remote.batch(buf, 'write')
      pushed += buf.length
      buf = []
      process.stdout.write(`\r    ${pushed.toLocaleString()}/${total.toLocaleString()}`)
    }
  }
  if (buf.length > 0) {
    await remote.batch(buf, 'write')
    pushed += buf.length
    process.stdout.write(`\r    ${pushed.toLocaleString()}/${total.toLocaleString()}`)
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`\n    done in ${elapsed}s\n`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Local SQLite not found: ${DB_PATH}`)
    console.error(`Run scripts/load_multum_xlsx.ts first to stage the data.`)
    process.exit(1)
  }

  console.log(`Source: ${DB_PATH}`)
  console.log(`Target: ${DATABASE_URL}`)

  const local = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  const remote = createClient({ url: DATABASE_URL!, authToken: TURSO_AUTH_TOKEN })

  console.log('Applying mltm_* DDL on Turso (idempotent)…')
  const ddl = multumDdlStatements()
  await remote.batch(
    ddl.map((sql) => ({ sql, args: [] })),
    'write',
  )

  let work: readonly string[] = MULTUM_TABLE_NAMES.filter((t) => !ONLY || ONLY.has(t))

  if (flagChanged) {
    // Compare local vs remote row counts and only push tables that differ.
    // Treats "remote table missing" as a diff so a freshly-added table gets
    // its first push. Row count alone misses same-count-but-different-content
    // edits, which is fine for Multum (snapshot dumps where counts change
    // when content does).
    console.log('Detecting changed tables (row-count diff vs Turso)…')
    const filtered: string[] = []
    for (const t of work) {
      const localN = (local.prepare(`SELECT COUNT(*) as n FROM ${t}`).get() as { n: number }).n
      let remoteN: number | null = null
      try {
        const r = await remote.execute(`SELECT COUNT(*) as n FROM ${t}`)
        remoteN = Number(r.rows[0].n)
      } catch {
        // Table doesn't exist on Turso yet (DDL was just applied this run
        // for a fresh table; the COUNT can race against creation in some
        // libsql versions). Treat as missing → needs push.
      }
      if (localN !== remoteN) {
        filtered.push(t)
        const remoteLabel = remoteN === null ? 'missing' : remoteN.toLocaleString()
        console.log(`  → ${t}: local=${localN.toLocaleString()} remote=${remoteLabel}`)
      } else {
        console.log(`  ✓ ${t}: ${localN.toLocaleString()} (in sync — skip)`)
      }
    }
    work = filtered
    if (work.length === 0) {
      console.log('\nAll tables in sync. Nothing to push.')
      local.close()
      return
    }
  }

  console.log(`Pushing ${work.length} table(s)…`)

  const t0 = Date.now()
  for (const table of work) {
    await pushTable(local, remote, table)
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  // Verify counts match between local and remote.
  console.log('\nVerifying row counts…')
  for (const table of work) {
    const localN = (local.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n
    const remoteRes = await remote.execute(`SELECT COUNT(*) as n FROM ${table}`)
    const remoteN = Number(remoteRes.rows[0].n)
    const ok = localN === remoteN ? '✓' : '✗'
    console.log(`  ${ok} ${table}: local=${localN.toLocaleString()} remote=${remoteN.toLocaleString()}`)
  }

  local.close()
  console.log(`\nDone in ${elapsed}s.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
