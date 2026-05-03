import { NextRequest, NextResponse } from 'next/server'
import { lookupMultumForNdc } from '@/lib/db'

/**
 * GET /api/ndc/[ndc]/multum
 *
 * Lightweight Multum detail lookup for one NDC. Surfaces cost, package, and
 * identity fields a clinician would want to inspect when verifying a stack
 * target. Used by the NdcDetailPopover from the scanner sibling table and
 * (eventually) the SupplyTab.
 *
 * Returns 404 when neither Multum table has the NDC (caller should render a
 * "not in Multum" empty state). Distinct from `/api/barcode/[code]` which
 * runs the full diagnosis pipeline — this endpoint is intentionally lean for
 * popover responsiveness.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const detail = await lookupMultumForNdc(decodeURIComponent(ndc))
  if (!detail) {
    return NextResponse.json({ error: 'NDC not in Multum' }, { status: 404 })
  }
  return NextResponse.json(detail)
}
