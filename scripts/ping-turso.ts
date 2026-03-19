import { createClient } from '@libsql/client'

async function main() {
  const t = Date.now()
  const db = createClient({ url: process.env.DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })
  const r = await db.execute('SELECT COUNT(*) as cnt FROM formulary_groups')
  console.log('count:', r.rows[0].cnt, 'ms:', Date.now() - t)

  const t2 = Date.now()
  const r2 = await db.execute({
    sql: "SELECT group_id, description FROM formulary_groups WHERE description LIKE ? LIMIT 5",
    args: ['acetaminophen%']
  })
  console.log('description scan:', r2.rows.length, 'rows,', Date.now() - t2, 'ms')
  for (const row of r2.rows) console.log(' ', row.description)
}
main().catch(e => { console.error(e); process.exit(1) })
