import { NextRequest, NextResponse } from 'next/server'
import { lookupRxNormForNdc } from '@/lib/rxnorm'

/**
 * GET /api/ndc/[ndc]/rxnorm
 *
 * Returns RxNorm (NIH/NLM) concept information for an NDC: resolved RxCUI,
 * status, friendly name, term type, ingredients (IN/MIN/PIN), brand-name
 * concepts (BN), clinical/branded drug forms (SCD/SBD). Cached server-side
 * per-NDC for 30 days; negative results are cached too.
 *
 * 404 when RxNorm has no concept for this NDC.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const detail = await lookupRxNormForNdc(decodeURIComponent(ndc))
  if (!detail) {
    return NextResponse.json({ error: 'No RxNorm concept for this NDC' }, { status: 404 })
  }
  return NextResponse.json(detail)
}
