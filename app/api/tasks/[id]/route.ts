import { NextRequest, NextResponse } from 'next/server'
import { updateTask, deleteTask } from '@/lib/tasks-db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await req.json()
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
