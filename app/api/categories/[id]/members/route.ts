import { NextResponse } from 'next/server'
import { resolveCategoryMembers, addManualMember, removeManualMember } from '@/lib/categories-db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const members = await resolveCategoryMembers(id)
    return NextResponse.json({ members })
  } catch (err) {
    console.error('GET /api/categories/[id]/members', err)
    return NextResponse.json({ error: 'Failed to resolve members' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { groupId: string; drugDescription?: string }
    if (!body.groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
    }
    await addManualMember(id, body.groupId, body.drugDescription ?? '')
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('POST /api/categories/[id]/members', err)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { groupId: string }
    if (!body.groupId) {
      return NextResponse.json({ error: 'groupId is required' }, { status: 400 })
    }
    await removeManualMember(id, body.groupId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/categories/[id]/members', err)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
