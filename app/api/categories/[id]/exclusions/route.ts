import { NextResponse } from 'next/server'
import { listExclusions, addExclusion, removeExclusion } from '@/lib/categories-db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const exclusions = await listExclusions(id)
    return NextResponse.json({ exclusions })
  } catch (err) {
    console.error('GET /api/categories/[id]/exclusions', err)
    return NextResponse.json({ error: 'Failed to list exclusions' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { groupId: string; drugDescription?: string }
    if (!body.groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
    }
    await addExclusion(id, body.groupId, body.drugDescription ?? '')
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('POST /api/categories/[id]/exclusions', err)
    return NextResponse.json({ error: 'Failed to add exclusion' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { groupId: string }
    if (!body.groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
    }
    await removeExclusion(id, body.groupId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/categories/[id]/exclusions', err)
    return NextResponse.json({ error: 'Failed to remove exclusion' }, { status: 500 })
  }
}
