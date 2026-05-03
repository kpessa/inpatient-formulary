/**
 * Find NDCs that are (a) in our supply_records as siblings on a multi-NDC
 * product AND (b) have DailyMed coverage. These are the best end-to-end test
 * targets for the image popover — scan the lookup NDC, see siblings, click
 * one with DailyMed images.
 */
import { createClient } from "@libsql/client"
import { readFileSync } from "fs"

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
  if (m) process.env[m[1]] = m[2]
}

interface DailymedSpl {
  setid?: string
  title?: string
}

async function probeDailymed(ndc: string): Promise<DailymedSpl | null> {
  // Try variants the same way the live code does.
  const packed = ndc.replace(/[^0-9]/g, "")
  if (packed.length !== 11) return null
  const variants = new Set<string>([
    `${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`,
  ])
  if (packed[0] === "0") variants.add(`${packed.slice(1, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`)
  if (packed[5] === "0") variants.add(`${packed.slice(0, 5)}-${packed.slice(6, 9)}-${packed.slice(9, 11)}`)
  if (packed[9] === "0") variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(10, 11)}`)

  for (const v of variants) {
    try {
      const r = await fetch(`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc=${encodeURIComponent(v)}`)
      if (!r.ok) continue
      const json = (await r.json()) as { data?: DailymedSpl[] }
      if (json.data && json.data.length > 0) return json.data[0]
    } catch { /* network blip — try next variant */ }
  }
  return null
}

async function main() {
  const db = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // Pull a small sample of multi-NDC products with active reference NDCs.
  // Prefer common dose forms (tab/cap/inj) that labelers tend to file SPLs for.
  const { rows: groups } = await db.execute(`
    SELECT fg.description, fg.charge_number, fg.pyxis_id, fg.domain, fg.group_id,
           COUNT(*) AS ndc_count
    FROM supply_records sr
    JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
    WHERE fg.environment = 'prod' AND sr.ndc != '' AND sr.is_non_reference = 0
    GROUP BY fg.domain, fg.group_id
    HAVING ndc_count BETWEEN 3 AND 8
    ORDER BY RANDOM() LIMIT 8
  `)

  console.log("Probing DailyMed for siblings on each candidate product...\n")

  for (const r of groups) {
    const { rows: ndcs } = await db.execute({
      sql: `SELECT ndc, manufacturer FROM supply_records
            WHERE domain=? AND group_id=? AND ndc != '' AND is_non_reference = 0
            ORDER BY is_primary DESC, is_active DESC, ndc LIMIT 6`,
      args: [r.domain as string, r.group_id as string],
    })

    const hits: Array<{ ndc: string; mfr: string; setid: string; title: string }> = []
    for (const n of ndcs) {
      const d = await probeDailymed(n.ndc as string)
      if (d?.setid) {
        hits.push({
          ndc: n.ndc as string,
          mfr: (n.manufacturer as string) ?? "",
          setid: d.setid,
          title: d.title ?? "(no title)",
        })
      }
    }

    if (hits.length === 0) continue

    console.log(`▶ ${r.description}  CDM=${r.charge_number}  Pyxis=${r.pyxis_id}`)
    console.log(`  Look up any of these to see the sibling table; clicking the marked NDCs should show DailyMed images:`)
    for (const h of hits) {
      console.log(`    ✓ ${h.ndc}  ${h.mfr.slice(0, 30)}  →  ${h.title.slice(0, 60)}`)
    }
    console.log("")
  }

  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
