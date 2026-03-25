import { NextRequest, NextResponse } from 'next/server'
import { createNonReferenceItem } from '@/lib/db'
import type { NonReferenceFields } from '@/lib/db'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      fields: NonReferenceFields
      domains: { region: string; environment: string; domain: string }[]
    }
    const { groupId } = await createNonReferenceItem(body.fields, body.domains)
    return NextResponse.json({ groupId }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
