import { NextRequest, NextResponse } from 'next/server'
import { getDistinctFieldValues } from '@/lib/filter-groups-db'
import type { SearchFilterGroup } from '@/lib/types'

const VALID_FIELDS = new Set<string>(['dosage_form', 'route', 'dispense_category'])

export async function GET(req: NextRequest) {
  const field = req.nextUrl.searchParams.get('field')
  if (!field || !VALID_FIELDS.has(field)) {
    return NextResponse.json({ error: 'field must be dosage_form, route, or dispense_category' }, { status: 400 })
  }
  const values = await getDistinctFieldValues(field as SearchFilterGroup['field'])
  return NextResponse.json({ values })
}
