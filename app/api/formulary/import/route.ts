import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import type { GroupRow, SupplyRow } from '@/lib/csvTransform'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

interface ImportBody {
  domain: string
  clearFirst: boolean
  groups: GroupRow[]
  supplies: SupplyRow[]
}

export async function POST(req: NextRequest) {
  let body: ImportBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, clearFirst, groups, supplies } = body

  if (!domain || !Array.isArray(groups) || !Array.isArray(supplies)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = getDb()

  try {
    const statements = []

    if (clearFirst) {
      statements.push({
        sql: 'DELETE FROM formulary_groups WHERE domain = ?',
        args: [domain],
      })
      statements.push({
        sql: 'DELETE FROM supply_records WHERE domain = ?',
        args: [domain],
      })
    }

    for (const g of groups) {
      statements.push({
        sql: `INSERT INTO formulary_groups (
          domain, region, environment, extracted_at,
          group_id, description, generic_name, mnemonic,
          charge_number, brand_name, brand_name2, brand_name3, pyxis_id,
          status, formulary_status, strength, strength_unit, dosage_form, legal_status,
          identifiers_json, oe_defaults_json, dispense_json, clinical_json, inventory_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          g.domain, g.region, g.environment, g.extracted_at,
          g.group_id, g.description, g.generic_name, g.mnemonic,
          g.charge_number, g.brand_name, g.brand_name2, g.brand_name3, g.pyxis_id,
          g.status, g.formulary_status, g.strength, g.strength_unit, g.dosage_form, g.legal_status,
          g.identifiers_json, g.oe_defaults_json, g.dispense_json, g.clinical_json, g.inventory_json,
        ],
      })
    }

    for (const s of supplies) {
      statements.push({
        sql: `INSERT INTO supply_records (
          domain, group_id,
          ndc, is_non_reference, is_active,
          manufacturer, manufacturer_brand, manufacturer_label_desc,
          is_primary, is_biological, is_brand, is_unit_dose,
          awp_cost, cost1, cost2, supply_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          s.domain, s.group_id,
          s.ndc, s.is_non_reference, s.is_active,
          s.manufacturer, s.manufacturer_brand, s.manufacturer_label_desc,
          s.is_primary, s.is_biological, s.is_brand, s.is_unit_dose,
          s.awp_cost, s.cost1, s.cost2, s.supply_json,
        ],
      })
    }

    await db.batch(statements, 'write')

    return NextResponse.json({ inserted: groups.length })
  } catch (err) {
    console.error('Import error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 }
    )
  }
}
