import { NextRequest, NextResponse } from 'next/server'
import { scanInput } from '@/lib/scanner'
import type { Environment } from '@/lib/db'

/**
 * GET /api/barcode/[code]?facilities=<csv>&environment=<prod|cert>
 *
 * Accepts ANY input shape — barcode (GTIN-12/13/14, GS1 DataMatrix), 10/11-digit
 * NDC, or formatted NDC. The handler parses, normalizes, and runs the full
 * diagnosis pipeline. Returns the most-resolved candidate's diagnosis plus
 * the alternates so the UI can show "we tried these other zero-pad variants too."
 *
 * `facilities` is a comma-separated list — when omitted or empty, the diagnosis
 * runs in "all facilities" mode (no facility-domain filtering). When 2+, the
 * scan matches if it's flexed to ANY of them (mirrors the product-search
 * multi-facility behavior).
 *
 * Back-compat: legacy `?facility=<name>` is still accepted as a single-facility
 * shorthand when `facilities` is absent. The two are not combined.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params
  const environment = (req.nextUrl.searchParams.get('environment')?.trim() || 'prod') as Environment

  if (environment !== 'prod' && environment !== 'cert') {
    return NextResponse.json({ error: 'environment must be "prod" or "cert"' }, { status: 400 })
  }

  const facilities = parseFacilitiesParam(req)

  const result = await scanInput(decodeURIComponent(code), facilities, { environment })
  return NextResponse.json(result)
}

/**
 * Parse the multi-select `facilities` query param (comma-separated). Falls
 * back to legacy `facility` (singular) if `facilities` is absent so old
 * bookmarks / external callers keep working. Empty values drop out.
 */
function parseFacilitiesParam(req: NextRequest): string[] {
  const csv = req.nextUrl.searchParams.get('facilities')
  if (csv !== null) {
    return csv
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
  }
  const legacy = req.nextUrl.searchParams.get('facility')?.trim()
  return legacy ? [legacy] : []
}
