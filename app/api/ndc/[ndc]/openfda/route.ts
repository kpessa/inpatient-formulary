import { NextRequest, NextResponse } from 'next/server'
import { lookupOpenFdaForNdc } from '@/lib/openfda'

/**
 * GET /api/ndc/[ndc]/openfda
 *
 * Returns FDA NDC Directory + label fields (indications, dosage/admin,
 * warnings, route, marketing status, active ingredients) for an NDC. Cached
 * server-side per-NDC for 30 days; negative results are cached too so we
 * don't keep hammering api.fda.gov for NDCs they don't index.
 *
 * 404 when OpenFDA has no entry for this NDC.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const detail = await lookupOpenFdaForNdc(decodeURIComponent(ndc))
  if (!detail) {
    return NextResponse.json({ error: 'No OpenFDA entry for this NDC' }, { status: 404 })
  }
  return NextResponse.json(detail)
}
