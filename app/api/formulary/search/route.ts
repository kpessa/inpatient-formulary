import { NextRequest, NextResponse } from "next/server"
import { searchFormulary, searchByField, searchByFields, searchByPyxisIds } from "@/lib/db"
import type { SearchResult, FieldSearchParams, AdvancedFilters } from "@/lib/db"
import { tcDescendants } from "@/lib/therapeutic-class-map"

export type { SearchResult }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = (searchParams.get("q") ?? "").toLowerCase()
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 200)
  const facilitiesParam = searchParams.get("facilities")
  const showInactive = searchParams.get("showInactive") !== "false"
  const region = searchParams.get("region") ?? undefined
  const environment = searchParams.get("environment") ?? undefined

  // Parse column filters: cft_<colId> = text substring, cfv_<colId> = comma-separated values
  const colFilters: Record<string, { text?: string; vals?: string[] }> = {}
  for (const [key, val] of searchParams.entries()) {
    const tm = key.match(/^cft_(.+)$/)
    const vm = key.match(/^cfv_(.+)$/)
    if (tm) colFilters[tm[1]] = { ...colFilters[tm[1]], text: val }
    else if (vm) colFilters[vm[1]] = { ...colFilters[vm[1]], vals: val.split(',').filter(Boolean) }
  }

  const fieldsParam = searchParams.get('fields')
  const fields = fieldsParam?.split(',').filter(Boolean) as FieldSearchParams['field'][] | undefined

  // Parse advanced filters
  const advancedFilters: AdvancedFilters = {}
  const advDFInclude = searchParams.get('advDFInclude')
  const advDFExclude = searchParams.get('advDFExclude')
  const advTC        = searchParams.get('advTC')
  const advDCInclude = searchParams.get('advDCInclude')
  const advDCExclude = searchParams.get('advDCExclude')
  const advRtInclude = searchParams.get('advRtInclude')
  const advRtExclude = searchParams.get('advRtExclude')
  if (advDFInclude) advancedFilters.dosageFormInclude      = advDFInclude.split(',').filter(Boolean)
  if (advDFExclude) advancedFilters.dosageFormExclude      = advDFExclude.split(',').filter(Boolean)
  if (advTC) {
    const baseCodes = advTC.split(',').filter(Boolean)
    const expanded = [...new Set(baseCodes.flatMap(c => [c, ...tcDescendants(c)]))]
    advancedFilters.therapeuticClassCodes = expanded
  }
  const advTCExclude = searchParams.get('advTCExclude')
  if (advTCExclude) {
    const baseCodes = advTCExclude.split(',').filter(Boolean)
    const expanded = [...new Set(baseCodes.flatMap(c => [c, ...tcDescendants(c)]))]
    advancedFilters.therapeuticClassExcludeCodes = expanded
  }
  if (advDCInclude) advancedFilters.dispenseCategoryInclude = advDCInclude.split(',').filter(Boolean)
  if (advDCExclude) advancedFilters.dispenseCategoryExclude = advDCExclude.split(',').filter(Boolean)
  if (advRtInclude) advancedFilters.routeInclude            = advRtInclude.split(',').filter(Boolean)
  if (advRtExclude) advancedFilters.routeExclude            = advRtExclude.split(',').filter(Boolean)
  const hasAdvanced = Object.keys(advancedFilters).length > 0

  const encoder = new TextEncoder()

  // Pyxis ID list path: exact multi-match for category search
  const pyxisIdsParam = searchParams.get('pyxisIds')
  if (pyxisIdsParam) {
    const ids = pyxisIdsParam.split(',').map(s => s.trim()).filter(Boolean)
    const results = await searchByPyxisIds(ids, region, environment)
    const body = JSON.stringify({ results, total: results.length }) + '\n'
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
  }

  // Field path: single UNION ALL query (+ separate NDC JOIN if needed) — one Turso round-trip.
  // The libsql singleton serializes concurrent execute() calls, so Promise.all over multiple
  // searchByField() calls would be sequential. UNION ALL avoids that penalty entirely.
  // Advanced filters bypass this path (they require the single-query path).
  if (fields && fields.length > 0 && q && !facilitiesParam && !hasAdvanced) {
    const t = performance.now()
    const fieldResults = await searchByFields(fields, q, region, environment, showInactive, limit)
    const ms = Math.round(performance.now() - t)
    // Return as regular JSON (not NDJSON streaming) so corporate VPN proxies that buffer
    // or truncate chunked transfer encoding receive complete results.
    return NextResponse.json({ fields: fieldResults, ms })
  }

  // Single-query path: facility filter, wildcard, or no fields specified
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { results, total } = await searchFormulary({
          q,
          limit,
          region,
          environment,
          showInactive,
          facilities: facilitiesParam,
          colFilters: Object.keys(colFilters).length > 0 ? colFilters : undefined,
          advancedFilters: hasAdvanced ? advancedFilters : undefined,
          onCount: (count) => {
            controller.enqueue(encoder.encode(JSON.stringify({ total: count }) + '\n'))
          },
        })
        controller.enqueue(encoder.encode(JSON.stringify({ results, total }) + '\n'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
