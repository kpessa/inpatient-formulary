import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/admin/facilities/[mnemonic]/contacts
 *
 * Create a new contact under this facility. The caller specifies role + at
 * least one of (name, email, phone) — empty rows are rejected. The new row
 * is `source='manual'`. Conflict on UNIQUE(mnemonic, role, name) returns 409.
 */
export const dynamic = 'force-dynamic'

export const VALID_ROLES = [
  'pharmacy_director',
  'operations_manager',
  'clinical_manager',
  'ip_pharmacist',
  'is_director',
  'main_pharmacy_phone',
] as const
export type Role = (typeof VALID_ROLES)[number]

interface CreateBody {
  role: Role
  name?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string }> },
): Promise<NextResponse> {
  const { mnemonic } = await params
  const m = mnemonic.toUpperCase()
  const body = (await req.json().catch(() => null)) as CreateBody | null
  if (!body || !body.role) {
    return NextResponse.json({ error: 'role is required' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: `role must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    )
  }
  const name = (body.name ?? '').trim()
  const email = body.email?.trim() || null
  const phone = body.phone?.trim() || null
  const notes = body.notes?.trim() || null
  if (!name && !email && !phone) {
    return NextResponse.json(
      { error: 'At least one of name/email/phone must be set' },
      { status: 400 },
    )
  }

  const db = getDb()
  // Verify facility exists first — friendlier error than the FK violation.
  const { rows: facRows } = await db.execute({
    sql: 'SELECT 1 FROM facilities WHERE mnemonic = ?',
    args: [m],
  })
  if (facRows.length === 0) {
    return NextResponse.json({ error: `Facility "${m}" not found` }, { status: 404 })
  }

  try {
    const r = await db.execute({
      sql: `INSERT INTO pharmacy_contacts
              (mnemonic, role, name, email, phone, notes, source)
            VALUES (?, ?, ?, ?, ?, ?, 'manual')
            RETURNING id`,
      args: [m, body.role, name, email, phone, notes],
    })
    const id = Number(r.rows[0].id)
    return NextResponse.json({ ok: true, id }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/UNIQUE/i.test(msg)) {
      return NextResponse.json(
        { error: `A contact with role "${body.role}" and name "${name}" already exists for ${m}.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
