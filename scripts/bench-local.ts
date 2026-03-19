import Database from 'better-sqlite3'
import path from 'path'

const db = new Database(path.join(process.cwd(), 'data', 'staging_formulary.db'), { readonly: true })

function bench(label: string, sql: string, args: unknown[] = []) {
  const t = Date.now()
  const rows = db.prepare(sql).all(...args)
  const ms = Date.now() - t
  const status = ms > 500 ? '🔴' : ms > 100 ? '🟡' : '🟢'
  console.log(`${status} ${label}: ${rows.length} rows in ${ms}ms`)
  return rows
}

console.log('Local SQLite benchmark — staging_formulary.db\n')

bench('COUNT(*)', 'SELECT COUNT(*) as cnt FROM formulary_groups')

bench('description LIKE (limit 50)',
  `SELECT group_id, description, generic_name, strength, strength_unit, dosage_form,
          mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id,
          region, environment
   FROM formulary_groups WHERE description LIKE ? LIMIT 50`,
  ['acetaminophen%'])

bench('generic_name LIKE (limit 50)',
  `SELECT group_id, description, generic_name, strength, strength_unit, dosage_form,
          mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id,
          region, environment
   FROM formulary_groups WHERE generic_name LIKE ? LIMIT 50`,
  ['acetaminophen%'])

bench('charge_number LIKE (limit 50)',
  `SELECT group_id, description, generic_name, strength, strength_unit, dosage_form,
          mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id,
          region, environment
   FROM formulary_groups WHERE charge_number LIKE ? LIMIT 50`,
  ['54000591%'])

bench('brand_name OR (limit 50)',
  `SELECT group_id, description, generic_name, strength, strength_unit, dosage_form,
          mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id,
          region, environment
   FROM formulary_groups WHERE (brand_name LIKE ? OR brand_name2 LIKE ? OR brand_name3 LIKE ?) LIMIT 50`,
  ['tylenol%', 'tylenol%', 'tylenol%'])

// UNION ALL (the actual query shape)
bench('UNION ALL — acetaminophen (all 4 fields)',
  `SELECT * FROM (SELECT 'description' AS _field, group_id, description, generic_name, strength, strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment FROM formulary_groups WHERE description LIKE ? LIMIT 50)
   UNION ALL
   SELECT * FROM (SELECT 'generic_name' AS _field, group_id, description, generic_name, strength, strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment FROM formulary_groups WHERE generic_name LIKE ? LIMIT 50)
   UNION ALL
   SELECT * FROM (SELECT 'brand_name' AS _field, group_id, description, generic_name, strength, strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment FROM formulary_groups WHERE (brand_name LIKE ? OR brand_name2 LIKE ? OR brand_name3 LIKE ?) LIMIT 50)
   UNION ALL
   SELECT * FROM (SELECT 'mnemonic' AS _field, group_id, description, generic_name, strength, strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment FROM formulary_groups WHERE mnemonic LIKE ? LIMIT 50)`,
  ['acetaminophen%', 'acetaminophen%', 'acetaminophen%', 'acetaminophen%', 'acetaminophen%', 'acetaminophen%'])

db.close()
