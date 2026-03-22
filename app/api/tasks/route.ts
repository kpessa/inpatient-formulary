import { NextRequest, NextResponse } from 'next/server'
import { listTasksForDrug, listAllTasks, createTask } from '@/lib/tasks-db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const drugKey    = searchParams.get('drugKey')    ?? undefined
  const status     = searchParams.get('status')     ?? undefined
  const assignedTo = searchParams.get('assignedTo') ?? undefined

  try {
    const tasks = drugKey
      ? await listTasksForDrug(drugKey)
      : await listAllTasks({ status, assignedTo })
    return NextResponse.json({ tasks })
  } catch {
    // Tables don't exist yet — return empty list until migration runs
    return NextResponse.json({ tasks: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const task = await createTask({
      drugKey:         body.drugKey,
      drugDescription: body.drugDescription,
      type:            body.type ?? 'free_form',
      fieldName:       body.fieldName,
      fieldLabel:      body.fieldLabel,
      targetDomain:    body.targetDomain,
      domainValues:    body.domainValues,
      targetValue:     body.targetValue,
      status:          body.status ?? 'pending',
      assignedTo:      body.assignedTo,
      notes:           body.notes,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
