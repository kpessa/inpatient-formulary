import { NextResponse } from 'next/server'
import { getGroupIdCategories } from '@/lib/categories-db'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const raw = searchParams.get('groupIds') ?? ''
    if (!raw.trim()) return NextResponse.json({})
    const groupIds = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
    const membership = await getGroupIdCategories(groupIds)
    return NextResponse.json(membership)
  } catch (err) {
    console.error('GET /api/categories/membership', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
