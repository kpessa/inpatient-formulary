import { NextRequest, NextResponse } from 'next/server'
import { updateBuild, updateBuildDomainProgress } from '@/lib/tasks-db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()

    if (body.domain !== undefined) {
      await updateBuildDomainProgress(id, body.domain, {
        status:      body.status,
        completedAt: body.completedAt,
        completedBy: body.completedBy,
        notes:       body.notes,
      })
    } else {
      await updateBuild(id, {
        status:  body.status,
        notes:   body.notes,
        drugKey: body.drugKey,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
