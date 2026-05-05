import { NextRequest, NextResponse } from 'next/server'
import { resolveCdmRequest } from '@/lib/cdm/resolver'
import { payloadToMarkdown } from '@/lib/cdm/markdown'
import { payloadToTsv } from '@/lib/cdm/tsv'
import { payloadToXlsx, suggestedFilename } from '@/lib/cdm/xlsx'

/**
 * GET /api/cdm-request/[ndc]
 *
 * Resolves an NDC into a draft CDM Request payload — the pharmacy-fillable
 * cells of the UHS CDM Request Form (rev. 04-27-2018, A5..AC5). Charge
 * Services fields (AD5..AR5) are intentionally not produced here.
 *
 * Response formats (selected via `?format=`):
 *   • default        → JSON CdmRequestPayload (consumed by the in-app dialog)
 *   • ?format=markdown → text/markdown table matching BrainSpace's
 *                       CDMFormDataParser contract
 *   • ?format=tsv    → tab-separated row of A5..AC5 values for paste-into-A5
 *   • ?format=xlsx   → filled .xlsx download (template + autofilled values)
 *
 * Idempotent and safe — no writes, no auth. Returns the payload even when
 * the NDC isn't in Multum (every cell **MISSING**), so the UI can still
 * show "we tried but found nothing for this NDC."
 */
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ndc: string }> },
) {
  const { ndc } = await params
  const decoded = decodeURIComponent(ndc).trim()
  if (!decoded) {
    return NextResponse.json({ error: 'NDC required' }, { status: 400 })
  }

  const format = req.nextUrl.searchParams.get('format')?.toLowerCase() ?? 'json'
  const payload = await resolveCdmRequest(decoded)

  if (format === 'markdown' || format === 'md') {
    const md = payloadToMarkdown(payload, { wrapSection: true })
    return new NextResponse(md, {
      status: 200,
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  if (format === 'tsv') {
    const tsv = payloadToTsv(payload)
    return new NextResponse(tsv, {
      status: 200,
      headers: {
        'content-type': 'text/tab-separated-values; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  if (format === 'xlsx') {
    try {
      const buf = payloadToXlsx(payload)
      const filename = suggestedFilename(payload)
      // Use a typed cast for the response body — Buffer is a Uint8Array
      // subclass which NextResponse accepts, but TypeScript wants the
      // BodyInit type. Cast through unknown is cleaner than disabling.
      return new NextResponse(buf as unknown as BodyInit, {
        status: 200,
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (format === 'json' || format === '') {
    return NextResponse.json(payload)
  }

  return NextResponse.json(
    { error: `Unsupported format "${format}". Supported: json, markdown, tsv, xlsx.` },
    { status: 400 },
  )
}
