import { NextRequest, NextResponse } from 'next/server'
import { scanInput } from '@/lib/scanner'
import type { Environment } from '@/lib/db'

/**
 * GET /api/drugs/[ndc]?facilities=<csv>&environment=<prod|cert>
 *
 * Same handler as /api/barcode internally — `scanInput` parses any digit length
 * and emits zero-pad candidates as needed. Two routes are kept distinct so the
 * URL space matches the wiki spec and Phase 2 can specialize them (the barcode
 * route may eventually accept POST with raw scanner-decoded payloads, while
 * /api/drugs stays GET for shareable lookup links).
 *
 * `facilities` is a comma-separated multi-select. Unlike /api/barcode this
 * route requires at least one facility — shareable lookup links should always
 * carry the user's intended scope.
 *
 * Back-compat: legacy `?facility=<name>` is still accepted.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const environment = (req.nextUrl.searchParams.get('environment')?.trim() || 'prod') as Environment

  if (environment !== 'prod' && environment !== 'cert') {
    return NextResponse.json({ error: 'environment must be "prod" or "cert"' }, { status: 400 })
  }

  const csv = req.nextUrl.searchParams.get('facilities')
  const legacy = req.nextUrl.searchParams.get('facility')?.trim()
  const facilities = csv !== null
    ? csv.split(',').map((f) => f.trim()).filter(Boolean)
    : legacy
      ? [legacy]
      : []

  if (facilities.length === 0) {
    return NextResponse.json({ error: 'facilities query parameter is required (comma-separated)' }, { status: 400 })
  }

  const result = await scanInput(decodeURIComponent(ndc), facilities, { environment })
  return NextResponse.json(result)
}
