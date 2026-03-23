import { NextResponse } from 'next/server'
import { getCategoryPyxisIds, addCategoryPyxisId, removeCategoryPyxisId, populatePyxisIdsFromRules } from '@/lib/categories-db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const pyxisIds = await getCategoryPyxisIds(id)
    return NextResponse.json({ pyxisIds })
  } catch (err) {
    console.error('GET /api/categories/[id]/pyxis-ids', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { pyxisId } = await req.json() as { pyxisId: string }
    if (!pyxisId?.trim()) return NextResponse.json({ error: 'pyxisId required' }, { status: 400 })
    await addCategoryPyxisId(id, pyxisId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('POST /api/categories/[id]/pyxis-ids', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH { action: 'populate_from_rules' } — resolve rules, snapshot pyxis IDs
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const added = await populatePyxisIdsFromRules(id)
    const pyxisIds = await getCategoryPyxisIds(id)
    return NextResponse.json({ added, pyxisIds })
  } catch (err) {
    console.error('PATCH /api/categories/[id]/pyxis-ids', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { pyxisId } = await req.json() as { pyxisId: string }
    await removeCategoryPyxisId(id, pyxisId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/categories/[id]/pyxis-ids', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
