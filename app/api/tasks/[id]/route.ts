import { NextRequest, NextResponse } from 'next/server'
import { updateTask, deleteTask, updateTaskDomainProgress, bulkUpdateTaskDomainProgress, recomputeTaskStatus } from '@/lib/tasks-db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()

    // Bulk domain progress update (complete all)
    if (body.bulkDomainProgress) {
      const bdp = body.bulkDomainProgress as { domains: string[]; status: string; completedBy?: string }
      await bulkUpdateTaskDomainProgress(id, bdp.domains, bdp.status as 'pending' | 'in_progress' | 'done', bdp.completedBy)
      await recomputeTaskStatus(id)
      return NextResponse.json({ ok: true })
    }

    // Per-domain progress update
    if (body.domainProgress) {
      const dp = body.domainProgress as { domain: string; status: string; completedAt?: string; completedBy?: string; notes?: string }
      await updateTaskDomainProgress(id, dp.domain, {
        status: dp.status as 'pending' | 'in_progress' | 'done',
        completedAt: dp.completedAt,
        completedBy: dp.completedBy,
        notes: dp.notes,
      })
      await recomputeTaskStatus(id)
      return NextResponse.json({ ok: true })
    }

    // Regular task update
    await updateTask(id, {
      status:      body.status,
      assignedTo:  body.assignedTo,
      notes:       body.notes,
      targetValue: body.targetValue,
      completedAt: body.completedAt,
      completedBy: body.completedBy,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    await deleteTask(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
