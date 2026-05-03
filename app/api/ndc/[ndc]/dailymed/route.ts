import { NextRequest, NextResponse } from 'next/server'
import { lookupDailymedForNdc } from '@/lib/dailymed'

/**
 * GET /api/ndc/[ndc]/dailymed
 *
 * Returns DailyMed (NIH/NLM) SPL metadata and image manifest for an NDC.
 * Cached server-side per-NDC for 30 days; negative results are cached too so
 * we don't hammer NIH for NDCs they don't index.
 *
 * 404 when DailyMed has no SPL for this NDC. Caller (NdcDetailPopover) renders
 * a "no image available" empty state.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const detail = await lookupDailymedForNdc(decodeURIComponent(ndc))
  if (!detail) {
    return NextResponse.json({ error: 'No DailyMed entry for this NDC' }, { status: 404 })
  }
  return NextResponse.json(detail)
}
