import { NextResponse } from 'next/server'
import { listCategories, createCategory } from '@/lib/categories-db'

export async function GET() {
  try {
    const categories = await listCategories()
    return NextResponse.json({ categories })
  } catch (err) {
    console.error('GET /api/categories', err)
    return NextResponse.json({ error: 'Failed to list categories' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { name: string; description?: string; color?: string }
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const category = await createCategory(
      body.name.trim(),
      body.description?.trim() ?? '',
      body.color ?? '#6B7280',
    )
    return NextResponse.json({ category }, { status: 201 })
  } catch (err) {
    console.error('POST /api/categories', err)
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
  }
}
