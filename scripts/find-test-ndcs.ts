import { createClient } from "@libsql/client"
import { readFileSync } from "fs"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m) process.env[m[1]] = m[2]
}

async function main() {
  const db = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // Best candidates: products with multiple NDCs including at least one non-reference
  const { rows: candidates } = await db.execute(`
    SELECT fg.domain, fg.group_id, fg.description, fg.generic_name, fg.charge_number, fg.pyxis_id,
           COUNT(*) as ndc_count,
           SUM(CASE WHEN sr.is_non_reference = 1 THEN 1 ELSE 0 END) as non_ref_count,
           SUM(CASE WHEN sr.is_unit_dose = 1 THEN 1 ELSE 0 END) as ud_count
    FROM supply_records sr
    JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
    WHERE fg.environment = 'prod' AND sr.ndc != ''
    GROUP BY fg.domain, fg.group_id
    HAVING ndc_count >= 3 AND non_ref_count >= 1
    ORDER BY non_ref_count DESC, ndc_count DESC
    LIMIT 6
  `)
  console.log("=== Test candidates: mixed reference + non-reference NDCs ===\n")
  for (const r of candidates) {
    console.log(`${r.description}  (${r.generic_name})`)
    console.log(`  domain=${r.domain}  group=${r.group_id}  CDM=${r.charge_number}  Pyxis=${r.pyxis_id}`)
    console.log(`  ${r.ndc_count} NDCs · ${r.non_ref_count} non-ref · ${r.ud_count} unit-dose`)

    const { rows: ndcs } = await db.execute({
      sql: `SELECT ndc, is_primary, is_non_reference, is_unit_dose, is_active, manufacturer
            FROM supply_records WHERE domain=? AND group_id=? AND ndc != ''
            ORDER BY is_primary DESC, is_active DESC, ndc LIMIT 6`,
      args: [r.domain as string, r.group_id as string],
    })
    for (const n of ndcs) {
      const flags = [
        n.is_primary === 1 ? "PRIMARY" : "",
        n.is_non_reference === 1 ? "non-ref" : "",
        n.is_unit_dose === 1 ? "UD" : "",
        n.is_active === 0 ? "inactive" : "",
      ].filter(Boolean).join(",") || "—"
      console.log(`    ${n.ndc}  [${flags}]  ${n.manufacturer ?? ""}`)
    }
    console.log("")
  }

  // Simpler candidates: just multi-NDC products (no non-reference required)
  const { rows: simple } = await db.execute(`
    SELECT fg.description, fg.generic_name, fg.charge_number, fg.pyxis_id,
           fg.domain, fg.group_id, COUNT(*) as ndc_count
    FROM supply_records sr
    JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
    WHERE fg.environment = 'prod' AND sr.ndc != ''
    GROUP BY fg.domain, fg.group_id
    HAVING ndc_count BETWEEN 3 AND 6
    ORDER BY RANDOM() LIMIT 4
  `)
  console.log("\n=== Simpler picks: multi-NDC products (any flavor) ===\n")
  for (const r of simple) {
    console.log(`${r.description}  CDM=${r.charge_number}  Pyxis=${r.pyxis_id}`)
    const { rows: ndcs } = await db.execute({
      sql: `SELECT ndc FROM supply_records WHERE domain=? AND group_id=? AND ndc != ''
            ORDER BY is_primary DESC LIMIT 4`,
      args: [r.domain as string, r.group_id as string],
    })
    console.log(`  Try any of: ${ndcs.map((n) => n.ndc).join(", ")}\n`)
  }

  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
