import { NextRequest, NextResponse } from 'next/server'
import { getAllPatternsWithRules, createPattern } from '@/lib/patterns-db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const patterns = await getAllPatternsWithRules()
  return NextResponse.json({ patterns })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const id = await createPattern({
    name: body.name ?? 'New Pattern',
    description: body.description,
    color: body.color,
    scopeType: body.scopeType,
    scopeValue: body.scopeValue,
  })
  return NextResponse.json({ id })
}
