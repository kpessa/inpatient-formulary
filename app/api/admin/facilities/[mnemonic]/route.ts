import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * GET /api/admin/facilities/[mnemonic]
 * PATCH /api/admin/facilities/[mnemonic]
 *
 * GET returns the full facility detail — metadata + contacts + aliases +
 * Cerner codes — for the admin detail page.
 *
 * PATCH updates the editable facility metadata fields (long_name, region,
 * is_acute, notes). The mnemonic itself is the primary key and is NOT
 * editable through this endpoint — renaming a mnemonic would cascade-orphan
 * a lot of references and we don't have a use case for it yet.
 */
export const dynamic = 'force-dynamic'

export interface FacilityDetail {
  mnemonic: string
  longName: string
  region: string | null
  isAcute: boolean
  notes: string | null
  contacts: ContactRow[]
  aliases: AliasRow[]
  cernerCodes: CernerCodeRow[]
}

export interface ContactRow {
  id: number
  role: string
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  source: string                  // 'seed' | 'manual'
  sourceSheet: string | null
  updatedAt: string
}

export interface AliasRow {
  alias: string
  source: string
  createdAt: string
}

export interface CernerCodeRow {
  domain: string                  // 'P152E' | 'P152C' | 'P152W'
  codeValue: number
  display: string | null
  description: string | null
  activeInd: number
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string }> },
): Promise<NextResponse> {
  const { mnemonic } = await params
  const m = mnemonic.toUpperCase()
  const db = getDb()

  // Single batch — three reads in parallel inside the libsql client.
  const [{ rows: facRows }, { rows: contactRows }, { rows: aliasRows }, { rows: cernerRows }] =
    await Promise.all([
      db.execute({
        sql: 'SELECT mnemonic, long_name, region, is_acute, notes FROM facilities WHERE mnemonic = ?',
        args: [m],
      }),
      db.execute({
        sql: `SELECT id, role, name, email, phone, notes, source, source_sheet, updated_at
              FROM pharmacy_contacts WHERE mnemonic = ?
              ORDER BY role, name`,
        args: [m],
      }),
      db.execute({
        sql: `SELECT alias_lower, source, created_at FROM facility_aliases
              WHERE mnemonic = ? ORDER BY alias_lower`,
        args: [m],
      }),
      db.execute({
        sql: `SELECT domain, code_value, display, description, active_ind
              FROM facility_cerner_codes WHERE mnemonic = ? ORDER BY domain`,
        args: [m],
      }),
    ])

  if (facRows.length === 0) {
    return NextResponse.json({ error: `Facility "${m}" not found` }, { status: 404 })
  }
  const f = facRows[0]
  const detail: FacilityDetail = {
    mnemonic: f.mnemonic as string,
    longName: f.long_name as string,
    region: (f.region as string | null) ?? null,
    isAcute: Number(f.is_acute) === 1,
    notes: (f.notes as string | null) ?? null,
    contacts: contactRows.map(r => ({
      id: Number(r.id),
      role: r.role as string,
      name: (r.name as string) ?? '',
      email: (r.email as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      source: (r.source as string) ?? 'manual',
      sourceSheet: (r.source_sheet as string | null) ?? null,
      updatedAt: r.updated_at as string,
    })),
    aliases: aliasRows.map(r => ({
      alias: r.alias_lower as string,
      source: r.source as string,
      createdAt: r.created_at as string,
    })),
    cernerCodes: cernerRows.map(r => ({
      domain: r.domain as string,
      codeValue: Number(r.code_value),
      display: (r.display as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      activeInd: Number(r.active_ind),
    })),
  }
  return NextResponse.json(detail)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string }> },
): Promise<NextResponse> {
  const { mnemonic } = await params
  const m = mnemonic.toUpperCase()
  const body = (await req.json().catch(() => null)) as Partial<{
    longName: string
    region: string | null
    isAcute: boolean
    notes: string | null
  }> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Build dynamic SET clause from only the fields the caller supplied.
  const sets: string[] = []
  const args: (string | number | null)[] = []
  if (body.longName !== undefined) { sets.push('long_name = ?'); args.push(body.longName) }
  if (body.region !== undefined)   { sets.push('region = ?');    args.push(body.region) }
  if (body.isAcute !== undefined)  { sets.push('is_acute = ?');  args.push(body.isAcute ? 1 : 0) }
  if (body.notes !== undefined)    { sets.push('notes = ?');     args.push(body.notes) }
  if (sets.length === 0) return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  args.push(m)

  const db = getDb()
  // SELECT first — embedded replica returns rowsAffected=0 for writes.
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT 1 FROM facilities WHERE mnemonic = ?',
    args: [m],
  })
  if (existingRows.length === 0) {
    return NextResponse.json({ error: `Facility "${m}" not found` }, { status: 404 })
  }
  await db.execute({
    sql: `UPDATE facilities SET ${sets.join(', ')} WHERE mnemonic = ?`,
    args,
  })
  return NextResponse.json({ ok: true, mnemonic: m })
}

/**
 * DELETE /api/admin/facilities/[mnemonic]
 *
 * Delete a facility and everything attached to it (contacts, aliases,
 * Cerner code mappings) via the ON DELETE CASCADE constraints. Permanent;
 * the UI must confirm before calling.
 *
 * Returns the cascaded counts so the UI can summarize what was removed.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string }> },
): Promise<NextResponse> {
  const { mnemonic } = await params
  const m = mnemonic.toUpperCase()
  const db = getDb()

  // SELECT first — embedded replica returns rowsAffected=0 for writes.
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT 1 FROM facilities WHERE mnemonic = ?',
    args: [m],
  })
  if (existingRows.length === 0) {
    return NextResponse.json({ error: `Facility "${m}" not found` }, { status: 404 })
  }

  // Snapshot child counts so we can report what cascaded.
  const [{ rows: ccRows }, { rows: caRows }, { rows: ckRows }] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM pharmacy_contacts WHERE mnemonic = ?', args: [m] }),
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM facility_aliases   WHERE mnemonic = ?', args: [m] }),
    db.execute({ sql: 'SELECT COUNT(*) AS n FROM facility_cerner_codes WHERE mnemonic = ?', args: [m] }),
  ])
  const cascadedContacts = Number(ccRows[0].n)
  const cascadedAliases = Number(caRows[0].n)
  const cascadedCernerCodes = Number(ckRows[0].n)

  await db.execute({ sql: 'DELETE FROM facilities WHERE mnemonic = ?', args: [m] })

  return NextResponse.json({
    ok: true,
    mnemonic: m,
    cascadedContacts,
    cascadedAliases,
    cascadedCernerCodes,
  })
}
