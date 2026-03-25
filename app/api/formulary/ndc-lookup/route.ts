import { NextRequest, NextResponse } from 'next/server'
import { lookupNdcForBuild } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ndc = req.nextUrl.searchParams.get('ndc') ?? ''
  if (!ndc.trim()) return NextResponse.json({ result: null })
  const result = await lookupNdcForBuild(ndc.trim())
  return NextResponse.json({ result })
}
