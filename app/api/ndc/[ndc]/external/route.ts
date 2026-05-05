import { NextRequest, NextResponse } from 'next/server'
import { lookupExternalSourcesForNdc } from '@/lib/external-sources'

/**
 * GET /api/ndc/[ndc]/external
 *
 * Coalesced lookup across DailyMed (NIH SPL), OpenFDA (NDC Directory + Label),
 * and RxNorm (NLM concept service). Returns a single payload with:
 *
 *   - `availability`: which sources had data for this NDC
 *   - `consensus`:    coalesced identity fields (generic, brand, dosage form,
 *                     route, manufacturer) flagged when 2+ sources agree
 *   - `dailymed`, `openfda`, `rxnorm`: raw per-source detail (null when absent)
 *
 * Each source is cached server-side per-NDC for 30 days; negative results
 * are cached too. The three lookups run in parallel — one source being slow
 * or down doesn't prevent the others from returning.
 *
 * Always returns 200 (the body itself reports availability per source) so
 * the client doesn't have to special-case "all three sources missed". The
 * scanner UI uses this to render the "External sources" panel.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const payload = await lookupExternalSourcesForNdc(decodeURIComponent(ndc))
  return NextResponse.json(payload)
}
