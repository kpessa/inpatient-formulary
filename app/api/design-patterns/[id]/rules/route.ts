import { NextRequest, NextResponse } from 'next/server'
import { addFieldRule } from '@/lib/patterns-db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const id = await addFieldRule(params.id, {
    field: body.field,
    operator: body.operator,
    value: body.value,
    expectedDisplay: body.expectedDisplay,
  })
  return NextResponse.json({ id })
}
