import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * GET /api/admin/force-stacks
 *
 * Worklist of CDMs where the flexed NDCs span ≥2 distinct Multum main
 * drug codes — i.e. clinically different products force-stacked under
 * one Cerner CDM. Architects use this to find candidates for splitting.
 *
 * Coalesced by charge_number across prod regions: if east+central+west
 * all have the same force-stack, you see ONE row covering all three
 * (with a `regions` array listing where it appears). Per-MMDC summary
 * shows the active-NDC count + best-effort clinical label per group.
 *
 * Read-only. No filters today — UI does client-side filtering on the
 * full list (small enough). May add server-side filtering later if the
 * list grows past ~1000 rows.
 */
export const dynamic = 'force-dynamic'

export interface MmdcSummary {
  mmdc: number
  label: string                    // "bacitracin topical 500 units/g ointment"
  ndcCount: number                 // active NDCs in this MMDC for this charge
}

export interface ForceStackRow {
  chargeNumber: string
  description: string              // best-effort: first non-empty across regions
  regions: string[]                // ['east_prod', 'central_prod', 'west_prod']
  groupIds: string[]               // distinct group_ids contributing
  mmdcCount: number                // distinct MMDCs across all regions
  totalNdcCount: number            // distinct active NDCs across all regions
  mmdcSummary: MmdcSummary[]       // per-MMDC breakdown sorted by ndcCount desc
}

export async function GET(): Promise<NextResponse> {
  const db = getDb()

  // Single query: pull every (charge_number, mmdc, ndc) tuple under any
  // prod-environment force-stack. Groups with no force-stack are filtered
  // out via the HAVING clause on the inner CTE.
  const { rows } = await db.execute(`
    WITH ndc_mmdc AS (
      SELECT
        sr.group_id, sr.domain, sr.ndc,
        m.mmdc,
        m.generic_name,
        m.strength_description,
        m.dose_form_description
      FROM supply_records sr
      LEFT JOIN multum_ndc_combined m ON m.ndc_formatted = sr.ndc
      WHERE sr.is_active = 1
    ),
    flagged AS (
      SELECT n.group_id, n.domain
      FROM ndc_mmdc n
      JOIN formulary_groups fg ON fg.group_id = n.group_id AND fg.domain = n.domain
      WHERE fg.environment = 'prod' AND n.mmdc IS NOT NULL
      GROUP BY n.group_id, n.domain
      HAVING COUNT(DISTINCT n.mmdc) >= 2
    )
    SELECT
      fg.charge_number,
      fg.domain,
      fg.group_id,
      fg.description,
      n.mmdc,
      n.generic_name,
      n.strength_description,
      n.dose_form_description,
      n.ndc
    FROM flagged f
    JOIN formulary_groups fg ON fg.group_id = f.group_id AND fg.domain = f.domain
    JOIN ndc_mmdc n ON n.group_id = f.group_id AND n.domain = f.domain
    WHERE n.mmdc IS NOT NULL
  `)

  // Coalesce in-memory by charge_number — same drug across regions reads
  // as ONE entry on the worklist regardless of how the build is split.
  type Bucket = {
    chargeNumber: string
    description: string
    regions: Set<string>
    groupIds: Set<string>
    mmdcs: Map<number, { ndcs: Set<string>; label: string | null }>
    allNdcs: Set<string>
  }
  const byCharge = new Map<string, Bucket>()
  for (const r of rows) {
    const charge = (r.charge_number as string) ?? ''
    if (!charge) continue
    let b = byCharge.get(charge)
    if (!b) {
      b = {
        chargeNumber: charge,
        description: '',
        regions: new Set(),
        groupIds: new Set(),
        mmdcs: new Map(),
        allNdcs: new Set(),
      }
      byCharge.set(charge, b)
    }
    if (!b.description && r.description) b.description = r.description as string
    b.regions.add(r.domain as string)
    b.groupIds.add(r.group_id as string)
    const mmdc = Number(r.mmdc)
    if (!b.mmdcs.has(mmdc)) b.mmdcs.set(mmdc, { ndcs: new Set(), label: null })
    const m = b.mmdcs.get(mmdc)!
    m.ndcs.add(r.ndc as string)
    if (!m.label) {
      const label = [r.generic_name, r.strength_description, r.dose_form_description]
        .filter(Boolean)
        .join(' ')
      if (label) m.label = label
    }
    b.allNdcs.add(r.ndc as string)
  }

  const list: ForceStackRow[] = [...byCharge.values()].map(b => ({
    chargeNumber: b.chargeNumber,
    description: b.description,
    regions: [...b.regions].sort(),
    groupIds: [...b.groupIds].sort(),
    mmdcCount: b.mmdcs.size,
    totalNdcCount: b.allNdcs.size,
    mmdcSummary: [...b.mmdcs.entries()]
      .map(([mmdc, v]) => ({
        mmdc,
        label: v.label ?? `MMDC ${mmdc}`,
        ndcCount: v.ndcs.size,
      }))
      .sort((a, b) => b.ndcCount - a.ndcCount),
  }))

  list.sort((a, b) =>
    b.mmdcCount - a.mmdcCount ||
    b.totalNdcCount - a.totalNdcCount ||
    a.chargeNumber.localeCompare(b.chargeNumber),
  )

  return NextResponse.json({ rows: list })
}
