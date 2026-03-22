import { NextRequest, NextResponse } from 'next/server'
import { listBuilds, createBuild } from '@/lib/tasks-db'

export async function GET() {
  try {
    const builds = await listBuilds()
    return NextResponse.json({ builds })
  } catch {
    // Tables don't exist yet — return empty list until migration runs
    return NextResponse.json({ builds: [] })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const build = await createBuild(
      {
        drugDescription: body.drugDescription,
        drugKey:         body.drugKey,
        status:          body.status ?? 'in_progress',
        notes:           body.notes,
        createdBy:       body.createdBy,
      },
      body.domains ?? [],
    )
    return NextResponse.json({ build }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
