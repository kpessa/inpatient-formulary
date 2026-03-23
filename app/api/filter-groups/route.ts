import { NextRequest, NextResponse } from 'next/server'
import { listFilterGroups, createFilterGroup } from '@/lib/filter-groups-db'
import type { SearchFilterGroup } from '@/lib/types'

export async function GET() {
  const groups = await listFilterGroups()
  return NextResponse.json({ groups })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    name: string
    icon: string
    field: SearchFilterGroup['field']
    values: string[]
    sortOrder?: number
  }
  if (!body.name || !body.field || !Array.isArray(body.values)) {
    return NextResponse.json({ error: 'name, field, and values are required' }, { status: 400 })
  }
  const group = await createFilterGroup(body)
  return NextResponse.json({ group }, { status: 201 })
}
