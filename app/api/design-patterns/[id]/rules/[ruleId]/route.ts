import { NextRequest, NextResponse } from 'next/server'
import { deleteFieldRule } from '@/lib/patterns-db'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { ruleId: string } }) {
  await deleteFieldRule(params.ruleId)
  return NextResponse.json({ ok: true })
}
