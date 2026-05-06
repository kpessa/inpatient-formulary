import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * DELETE /api/admin/facilities/[mnemonic]/aliases/[alias]
 *
 * Removes a single alias mapping. The alias path-param is URL-encoded; we
 * decode and lowercase before lookup. The mnemonic is taken as a guard so
 * a delete intended for facility A can't accidentally remove an alias
 * belonging to facility B (defense for a UI bug, not a security boundary).
 */
export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ mnemonic: string; alias: string }> },
): Promise<NextResponse> {
  const { mnemonic, alias } = await params
  const m = mnemonic.toUpperCase()
  const a = decodeURIComponent(alias).toLowerCase()
  const db = getDb()
  // SELECT first — embedded replica returns rowsAffected=0 for writes.
  const { rows: existingRows } = await db.execute({
    sql: 'SELECT 1 FROM facility_aliases WHERE alias_lower = ? AND mnemonic = ?',
    args: [a, m],
  })
  if (existingRows.length === 0) {
    return NextResponse.json(
      { error: `Alias "${a}" not found under ${m}` },
      { status: 404 },
    )
  }
  await db.execute({
    sql: 'DELETE FROM facility_aliases WHERE alias_lower = ? AND mnemonic = ?',
    args: [a, m],
  })
  return NextResponse.json({ ok: true })
}
