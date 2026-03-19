import { NextRequest } from "next/server"
import { searchFormulary, searchByField, searchByFields } from "@/lib/db"
import type { SearchResult, FieldSearchParams } from "@/lib/db"

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

  const encoder = new TextEncoder()

  // Single-field path: one indexed prefix scan per request (parallel fetches from client)
  if (fields && fields.length === 1 && q && !facilitiesParam) {
    const field = fields[0]
    const t = performance.now()
    const results = await searchByField({ field, q, region, environment, showInactive, limit })
    const ms = Math.round(performance.now() - t)
    const body = JSON.stringify({ field, results, ms, rawCount: results.length }) + '\n'
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
  }

  // Multi-field path: UNION ALL (kept for direct API callers with multiple fields)
  if (fields && fields.length > 1 && q && !facilitiesParam) {
    const t = performance.now()
    const fieldResults = await searchByFields(fields, q, region, environment, showInactive, limit)
    const ms = Math.round(performance.now() - t)
    const body = Object.entries(fieldResults)
      .map(([field, results]) => JSON.stringify({ field, results, ms, rawCount: results.length }))
      .join('\n') + '\n'
    return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
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
