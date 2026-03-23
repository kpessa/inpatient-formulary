import { NextResponse } from 'next/server'
import { getCategoryWithRules, updateCategory, deleteCategory } from '@/lib/categories-db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await getCategoryWithRules(id)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('GET /api/categories/[id]', err)
    return NextResponse.json({ error: 'Failed to get category' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { name?: string; description?: string; color?: string }
    await updateCategory(id, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('PATCH /api/categories/[id]', err)
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await deleteCategory(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/categories/[id]', err)
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 })
  }
}
