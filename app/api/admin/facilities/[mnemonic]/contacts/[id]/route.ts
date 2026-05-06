import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { VALID_ROLES, type Role } from '../route'

/**
 * PATCH  /api/admin/facilities/[mnemonic]/contacts/[id]
 * DELETE /api/admin/facilities/[mnemonic]/contacts/[id]
 *
 * PATCH updates editable fields on a contact (role, name, email, phone, notes).
 * Any change flips `source` from 'seed' to 'manual' so the contact is no
 * longer considered loader-managed (the loader's INSERT OR IGNORE will skip
 * it on subsequent runs anyway, so this is mainly for audit clarity).
 *
 * DELETE is permanent; the caller's UI should confirm before calling.
 */
export const dynamic = 'force-dynamic'

interface PatchBody {
  role?: Role
  name?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string; id: string }> },
): Promise<NextResponse> {
  const { mnemonic, id } = await params
  const m = mnemonic.toUpperCase()
  const contactId = Number(id)
  if (!Number.isFinite(contactId)) {
    return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 })
  }
  const body = (await req.json().catch(() => null)) as PatchBody | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: `role must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    )
  }

  const sets: string[] = []
  const args: (string | number | null)[] = []
  if (body.role  !== undefined) { sets.push('role = ?');  args.push(body.role) }
  if (body.name  !== undefined) { sets.push('name = ?');  args.push((body.name ?? '').trim()) }
  if (body.email !== undefined) { sets.push('email = ?'); args.push(body.email?.trim() || null) }
  if (body.phone !== undefined) { sets.push('phone = ?'); args.push(body.phone?.trim() || null) }
  if (body.notes !== undefined) { sets.push('notes = ?'); args.push(body.notes?.trim() || null) }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }
  // Always promote to manual + bump updated_at.
  sets.push("source = 'manual'", "updated_at = datetime('now')")
  args.push(contactId, m)

  const db = getDb()
  // libsql embedded replica returns rowsAffected=0 for writes routed to
  // remote, so check existence with a SELECT first rather than infer from
  // the UPDATE result.
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT 1 FROM pharmacy_contacts WHERE id = ? AND mnemonic = ?',
    args: [contactId, m],
  })
  if (existingRows.length === 0) {
    return NextResponse.json(
      { error: `Contact ${contactId} not found under ${m}` },
      { status: 404 },
    )
  }
  try {
    await db.execute({
      sql: `UPDATE pharmacy_contacts SET ${sets.join(', ')}
            WHERE id = ? AND mnemonic = ?`,
      args,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/UNIQUE/i.test(msg)) {
      return NextResponse.json(
        { error: `A contact with this role+name already exists for ${m}.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string; id: string }> },
): Promise<NextResponse> {
  const { mnemonic, id } = await params
  const m = mnemonic.toUpperCase()
  const contactId = Number(id)
  if (!Number.isFinite(contactId)) {
    return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 })
  }
  const db = getDb()
  // SELECT first — embedded replica returns rowsAffected=0 for writes.
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT 1 FROM pharmacy_contacts WHERE id = ? AND mnemonic = ?',
    args: [contactId, m],
  })
  if (existingRows.length === 0) {
    return NextResponse.json(
      { error: `Contact ${contactId} not found under ${m}` },
      { status: 404 },
    )
  }
  await db.execute({
    sql: 'DELETE FROM pharmacy_contacts WHERE id = ? AND mnemonic = ?',
    args: [contactId, m],
  })
  return NextResponse.json({ ok: true })
}
