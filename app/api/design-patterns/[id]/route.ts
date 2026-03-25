import { NextRequest, NextResponse } from 'next/server'
import { updatePattern, deletePattern } from '@/lib/patterns-db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  await updatePattern(params.id, {
    name: body.name,
    description: body.description,
    color: body.color,
    scopeType: body.scopeType,
    scopeValue: body.scopeValue,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await deletePattern(params.id)
  return NextResponse.json({ ok: true })
}
