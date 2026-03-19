import { createClient } from '@libsql/client'

async function main() {
  const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })
  await db.batch([
    { sql: 'CREATE INDEX IF NOT EXISTS idx_fg_brand_name2 ON formulary_groups(brand_name2)', args: [] },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_fg_brand_name3 ON formulary_groups(brand_name3)', args: [] },
  ], 'write')
  console.log('Indexes created.')
}
main().catch(e => { console.error(e); process.exit(1) })
