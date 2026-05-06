import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * GET /api/cdm-master/[code]
 *
 * Lightweight per-CDM lookup against the cdm_master table loaded from the
 * Pharmacy CDM CSV. Returns description, tech_desc, proc_code, rev_code,
 * divisor, gl_key, ins_code — everything Charge Services owns for that
 * CDM code. Used by the Identifiers tab to surface CDM-derived rows
 * inline alongside Cerner formulary identifiers, with distinct styling
 * so they're visually marked as "from charge services" not "from formulary".
 *
 * Returns 404 when the CDM code isn't in cdm_master (typically means it's
 * a new build that Charge Services hasn't assigned yet).
 */
export const dynamic = 'force-dynamic'

export interface CdmMasterEntry {
  cdmCode: string
  description: string
  techDesc: string
  procCode: string
  revCode: string
  divisor: string
  glKey: string
  insCode: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params
  const trimmed = decodeURIComponent(code).trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'CDM code required' }, { status: 400 })
  }

  const db = getDb()
  try {
    const { rows } = await db.execute({
      sql: `SELECT cdm_code, description, tech_desc, proc_code,
                   rev_code, divisor, gl_key, ins_code
            FROM cdm_master WHERE cdm_code = ?`,
      args: [trimmed],
    })
    if (rows.length === 0) {
      return NextResponse.json({ error: 'CDM not in cdm_master' }, { status: 404 })
    }
    const r = rows[0]
    const entry: CdmMasterEntry = {
      cdmCode: r.cdm_code as string,
      description: (r.description as string) ?? '',
      techDesc: (r.tech_desc as string) ?? '',
      procCode: (r.proc_code as string) ?? '',
      revCode: (r.rev_code as string) ?? '',
      divisor: (r.divisor as string) ?? '',
      glKey: (r.gl_key as string) ?? '',
      insCode: (r.ins_code as string) ?? '',
    }
    return NextResponse.json(entry)
  } catch {
    // cdm_master table doesn't exist yet on this DB — treat like a miss.
    return NextResponse.json({ error: 'CDM not in cdm_master' }, { status: 404 })
  }
}
