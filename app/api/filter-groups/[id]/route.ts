import { NextRequest, NextResponse } from 'next/server'
import { updateFilterGroup, deleteFilterGroup } from '@/lib/filter-groups-db'
import type { SearchFilterGroup } from '@/lib/types'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json() as Partial<Pick<SearchFilterGroup, 'name' | 'icon' | 'field' | 'values' | 'sortOrder'>>
  await updateFilterGroup(id, body)
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  await deleteFilterGroup(id)
  return NextResponse.json({ ok: true })
}
