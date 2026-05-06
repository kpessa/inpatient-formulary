import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/admin/facilities/[mnemonic]/aliases
 *
 * Add a manual alias for this facility — typically a Service Desk variant
 * the seed couldn't auto-resolve, or a colloquial spelling pharmacy uses.
 * Aliases are stored lowercased (alias_lower is the PK); the lookup path
 * always lowercases incoming strings before matching.
 */
export const dynamic = 'force-dynamic'

interface CreateAliasBody {
  alias: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string }> },
): Promise<NextResponse> {
  const { mnemonic } = await params
  const m = mnemonic.toUpperCase()
  const body = (await req.json().catch(() => null)) as CreateAliasBody | null
  const alias = body?.alias?.trim()
  if (!alias) return NextResponse.json({ error: 'alias is required' }, { status: 400 })

  const db = getDb()
  // Verify facility exists.
  const { rows: facRows } = await db.execute({
    sql: 'SELECT 1 FROM facilities WHERE mnemonic = ?',
    args: [m],
  })
  if (facRows.length === 0) {
    return NextResponse.json({ error: `Facility "${m}" not found` }, { status: 404 })
  }

  try {
    await db.execute({
      sql: `INSERT INTO facility_aliases (alias_lower, mnemonic, source)
            VALUES (?, ?, 'manual')`,
      args: [alias.toLowerCase(), m],
    })
    return NextResponse.json({ ok: true, alias: alias.toLowerCase() }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/UNIQUE|PRIMARY/i.test(msg)) {
      // Already mapped — return the existing target so caller can decide.
      const { rows } = await db.execute({
        sql: 'SELECT mnemonic FROM facility_aliases WHERE alias_lower = ?',
        args: [alias.toLowerCase()],
      })
      const existing = rows[0]?.mnemonic as string | undefined
      return NextResponse.json(
        { error: `Alias already exists`, mappedTo: existing },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
