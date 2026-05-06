import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * GET /api/admin/facilities
 *
 * Lists every canonical facility with contact + alias counts and a few
 * roll-ups useful for the admin list view (has-pharmacy-director,
 * has-any-email, has-any-phone). Used by the /admin/facilities page to
 * render the table with filterable columns.
 *
 * Read-only. CRUD writes go through the [mnemonic] sub-routes.
 */
export const dynamic = 'force-dynamic'

export interface FacilityListRow {
  mnemonic: string
  longName: string
  region: string | null
  isAcute: boolean
  notes: string | null
  contactCount: number
  aliasCount: number
  cernerDomainCount: number
  hasPharmacyDirector: boolean
  hasAnyEmail: boolean
  hasAnyPhone: boolean
}

export async function GET(): Promise<NextResponse> {
  const db = getDb()
  // One round-trip with subqueries — Turso's cost is per-query, so this is
  // ~3× cheaper than separate queries per facility.
  const { rows } = await db.execute(`
    SELECT f.mnemonic,
           f.long_name,
           f.region,
           f.is_acute,
           f.notes,
           (SELECT COUNT(*) FROM pharmacy_contacts pc WHERE pc.mnemonic = f.mnemonic) AS contact_count,
           (SELECT COUNT(*) FROM facility_aliases fa WHERE fa.mnemonic = f.mnemonic) AS alias_count,
           (SELECT COUNT(*) FROM facility_cerner_codes cc WHERE cc.mnemonic = f.mnemonic) AS cerner_domain_count,
           (SELECT COUNT(*) FROM pharmacy_contacts pc WHERE pc.mnemonic = f.mnemonic
              AND pc.role = 'pharmacy_director') AS pd_count,
           (SELECT COUNT(*) FROM pharmacy_contacts pc WHERE pc.mnemonic = f.mnemonic
              AND pc.email IS NOT NULL AND pc.email != '') AS email_count,
           (SELECT COUNT(*) FROM pharmacy_contacts pc WHERE pc.mnemonic = f.mnemonic
              AND pc.phone IS NOT NULL AND pc.phone != '') AS phone_count
    FROM facilities f
    ORDER BY f.region, f.is_acute DESC, f.mnemonic
  `)
  const list: FacilityListRow[] = rows.map(r => ({
    mnemonic: r.mnemonic as string,
    longName: r.long_name as string,
    region: (r.region as string | null) ?? null,
    isAcute: Number(r.is_acute) === 1,
    notes: (r.notes as string | null) ?? null,
    contactCount: Number(r.contact_count),
    aliasCount: Number(r.alias_count),
    cernerDomainCount: Number(r.cerner_domain_count),
    hasPharmacyDirector: Number(r.pd_count) > 0,
    hasAnyEmail: Number(r.email_count) > 0,
    hasAnyPhone: Number(r.phone_count) > 0,
  }))
  return NextResponse.json({ facilities: list })
}

/**
 * POST /api/admin/facilities
 *
 * Create a new canonical facility row. Mnemonic is the primary key and is
 * uppercased on write — the rest of the app expects upper-case mnemonics
 * everywhere. Long name is required; region and is_acute optional.
 *
 * 409 on mnemonic collision.
 */
interface CreateFacilityBody {
  mnemonic: string
  longName: string
  region?: string | null
  isAcute?: boolean
  notes?: string | null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as CreateFacilityBody | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const mnemonic = (body.mnemonic ?? '').trim().toUpperCase()
  const longName = (body.longName ?? '').trim()
  if (!/^[A-Z0-9]{2,8}$/.test(mnemonic)) {
    return NextResponse.json(
      { error: 'mnemonic must be 2–8 uppercase alphanumeric chars' },
      { status: 400 },
    )
  }
  if (!longName) {
    return NextResponse.json({ error: 'longName is required' }, { status: 400 })
  }

  const region = body.region?.trim() || null
  const isAcute = body.isAcute === false ? 0 : 1     // default acute=true
  const notes = body.notes?.trim() || null

  const db = getDb()
  try {
    await db.execute({
      sql: `INSERT INTO facilities (mnemonic, long_name, region, is_acute, notes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [mnemonic, longName, region, isAcute, notes],
    })
    return NextResponse.json({ ok: true, mnemonic }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/UNIQUE|PRIMARY/i.test(msg)) {
      return NextResponse.json(
        { error: `Facility "${mnemonic}" already exists` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
