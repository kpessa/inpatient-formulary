import { NextResponse } from 'next/server'
import { getTaskSummary } from '@/lib/tasks-db'

export async function GET() {
  try {
    const summary = await getTaskSummary()
    return NextResponse.json(summary)
  } catch {
    return NextResponse.json({ total: 0, pending: 0, inProgress: 0, done: 0 })
  }
}
