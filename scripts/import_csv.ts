import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'
import { buildGroupRow, buildSupplyRows } from '../lib/csvTransform'
import type { Row } from '../lib/csvTransform'

// Parse CLI args
const args = process.argv.slice(2)
function getArg(name: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1 || idx + 1 >= args.length) throw new Error(`Missing --${name}`)
  return args[idx + 1]
}

const csvPath = path.resolve(getArg('csv'))
const dbPath = path.resolve(getArg('db'))
const domain = getArg('domain')
const region = getArg('region')
const env = getArg('env')
const extractedAt = new Date().toISOString()

// Read schema
const schemaPath = path.join(process.cwd(), 'lib', 'schema.sql')
const schemaSql = fs.readFileSync(schemaPath, 'utf8')

// Open DB
console.log(`Opening DB: ${dbPath}`)
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

// Apply schema
db.exec(schemaSql)

// Delete existing rows for this domain (idempotent re-import)
db.prepare('DELETE FROM formulary_groups WHERE domain = ?').run(domain)
db.prepare('DELETE FROM supply_records WHERE domain = ?').run(domain)
console.log(`Cleared existing rows for domain: ${domain}`)

// Read CSV
console.log(`Reading CSV: ${csvPath}`)
const t0 = Date.now()
const text = fs.readFileSync(csvPath).toString('latin1')
const { data } = Papa.parse<Row>(text, { header: true, skipEmptyLines: true })
console.log(`Parsed ${data.length} rows in ${Date.now() - t0}ms`)

// Group by GROUP_ID maintaining insertion order
const groups = new Map<string, Row[]>()
for (const row of data) {
  const gid = row['GROUP_ID'] ?? ''
  if (!gid) continue
  const existing = groups.get(gid)
  if (existing) existing.push(row)
  else groups.set(gid, [row])
}
console.log(`Found ${groups.size} drug groups`)

// Prepared statements
const insertGroup = db.prepare(`
  INSERT INTO formulary_groups (
    domain, region, environment, extracted_at,
    group_id, description, generic_name, mnemonic,
    charge_number, brand_name, brand_name2, brand_name3, pyxis_id,
    status, formulary_status, strength, strength_unit, dosage_form, legal_status,
    identifiers_json, oe_defaults_json, dispense_json, clinical_json, inventory_json
  ) VALUES (
    @domain, @region, @environment, @extracted_at,
    @group_id, @description, @generic_name, @mnemonic,
    @charge_number, @brand_name, @brand_name2, @brand_name3, @pyxis_id,
    @status, @formulary_status, @strength, @strength_unit, @dosage_form, @legal_status,
    @identifiers_json, @oe_defaults_json, @dispense_json, @clinical_json, @inventory_json
  )
`)

const insertSupply = db.prepare(`
  INSERT INTO supply_records (
    domain, group_id,
    ndc, is_non_reference, is_active,
    manufacturer, manufacturer_brand, manufacturer_label_desc,
    is_primary, is_biological, is_brand, is_unit_dose,
    awp_cost, cost1, cost2, supply_json
  ) VALUES (
    @domain, @group_id,
    @ndc, @is_non_reference, @is_active,
    @manufacturer, @manufacturer_brand, @manufacturer_label_desc,
    @is_primary, @is_biological, @is_brand, @is_unit_dose,
    @awp_cost, @cost1, @cost2, @supply_json
  )
`)

// Bulk insert in a single transaction
const t1 = Date.now()
const importAll = db.transaction(() => {
  let groupCount = 0
  let supplyCount = 0

  for (const [groupId, rows] of groups) {
    const g = buildGroupRow(groupId, rows, domain, region, env, extractedAt)
    insertGroup.run(g)

    const supplies = buildSupplyRows(groupId, rows, domain)
    for (const s of supplies) {
      insertSupply.run(s)
      supplyCount++
    }
    groupCount++
  }

  return { groupCount, supplyCount }
})

const { groupCount, supplyCount } = importAll()
console.log(`Imported ${groupCount} groups, ${supplyCount} supply records in ${Date.now() - t1}ms`)
db.close()
console.log('Done.')
