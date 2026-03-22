import { NextRequest, NextResponse } from 'next/server'
import { getOverridesForDrug, applyOverride } from '@/lib/tasks-db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const domain  = searchParams.get('domain')  ?? ''
  const groupId = searchParams.get('groupId') ?? ''

  try {
    const overrides = await getOverridesForDrug(domain, groupId)
    return NextResponse.json({ overrides })
  } catch {
    return NextResponse.json({ overrides: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const override = await applyOverride({
      domain:        body.domain,
      groupId:       body.groupId,
      fieldPath:     body.fieldPath,
      overrideValue: body.overrideValue,
      taskId:        body.taskId,
      appliedBy:     body.appliedBy ?? 'system',
    })
    return NextResponse.json({ override }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
