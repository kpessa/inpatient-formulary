import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Whitelist — maps rule field names to their SQL expressions
const FIELD_SQL: Record<string, string> = {
  dispenseCategory: "json_extract(dispense_json, '$.dispenseCategory')",
  therapeuticClass: "json_extract(clinical_json, '$.therapeuticClass')",
  dosageForm:       'dosage_form',
  status:           'status',
  strength:         'strength',
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const field = searchParams.get('field') ?? ''

  const expr = FIELD_SQL[field]
  if (!expr) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  }

  try {
    const db = getDb()
    const { rows } = await db.execute(`
      SELECT DISTINCT ${expr} AS val
      FROM formulary_groups
      WHERE ${expr} IS NOT NULL AND ${expr} != ''
      ORDER BY val
      LIMIT 500
    `)
    const values = rows.map(r => r.val as string).filter(Boolean)
    return NextResponse.json({ values })
  } catch (err) {
    console.error('GET /api/categories/field-values', err)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }
}
