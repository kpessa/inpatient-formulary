import { NextResponse } from 'next/server'
import { addRule, removeRule, clearRules } from '@/lib/categories-db'
import type { CategoryRule } from '@/lib/types'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as {
      field: CategoryRule['field']
      operator: CategoryRule['operator']
      value: string
    }
    if (!body.field || !body.operator || !body.value) {
      return NextResponse.json({ error: 'field, operator, and value are required' }, { status: 400 })
    }
    const rule = await addRule(id, body.field, body.operator, body.value)
    return NextResponse.json({ rule }, { status: 201 })
  } catch (err) {
    console.error('POST /api/categories/[id]/rules', err)
    return NextResponse.json({ error: 'Failed to add rule' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { ruleId?: string }
    if (body.ruleId) {
      await removeRule(body.ruleId)
    } else {
      await clearRules(id)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/categories/[id]/rules', err)
    return NextResponse.json({ error: 'Failed to remove rule(s)' }, { status: 500 })
  }
}
