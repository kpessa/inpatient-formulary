import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/ndc/sources
 *   { ndcs: string[] }  →  { [ndc: string]: SourcesSummary }
 *
 * Batched per-NDC source-availability lookup used by the Supply tab and
 * scanner sibling list to render at-glance indicators (M / D / OB badges +
 * pill-ID preview).
 *
 * Reads from the denormalized `multum_ndc_combined` table (one PK lookup
 * per NDC, all the columns we need pre-joined). Plus a separate
 * `dailymed_cache` query for known DailyMed status — that cache is warmed
 * organically as users open popovers.
 *
 * Going forward this endpoint should never need to touch the raw mltm_*
 * tables; if a column we care about is missing, add it to the combined
 * table's seed query in scripts/load_multum_xlsx.ts and we get it here.
 */

interface SourcesSummary {
  inMultum: boolean
  /** AB rating from FDA Orange Book ('A', 'B', '1'..'10', 'O'). */
  orangeBookRating: string | null
  orangeBookDescription: string | null
  imprintSide1: string | null
  imprintSide2: string | null
  scored: boolean
  color: string | null
  shape: string | null
  additionalDoseForm: string | null
  imageFilename: string | null
  dailymedStatus: 'available' | 'absent' | 'unknown'
  /** Multum obsolete date (mm/dd/yy) when the NDC has been flagged
   *  discontinued; null when active. Surfaced inline on the Supply tab. */
  obsoleteDate: string | null
}

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const ndcs = (body as { ndcs?: unknown })?.ndcs
  if (!Array.isArray(ndcs)) {
    return NextResponse.json({ error: 'Body must be { ndcs: string[] }' }, { status: 400 })
  }
  const cleanNdcs = ndcs
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
  if (cleanNdcs.length === 0) {
    return NextResponse.json({})
  }
  // Cap to avoid runaway queries from a buggy caller.
  const limited = cleanNdcs.slice(0, 500)

  const result: Record<string, SourcesSummary> = {}
  for (const ndc of limited) {
    result[ndc] = {
      inMultum: false,
      orangeBookRating: null,
      orangeBookDescription: null,
      imprintSide1: null,
      imprintSide2: null,
      scored: false,
      color: null,
      shape: null,
      additionalDoseForm: null,
      imageFilename: null,
      dailymedStatus: 'unknown',
      obsoleteDate: null,
    }
  }

  const db = getDb()
  const placeholders = limited.map(() => '?').join(',')

  // Single round-trip to multum_ndc_combined for everything except DailyMed.
  try {
    const { rows } = await db.execute({
      sql: `SELECT ndc_formatted,
                   orange_book_rating, orange_book_description,
                   imprint_side_1, imprint_side_2, is_scored,
                   pill_color, pill_shape, additional_dose_form,
                   image_filename, obsolete_date
            FROM multum_ndc_combined
            WHERE ndc_formatted IN (${placeholders})`,
      args: limited,
    })
    for (const r of rows) {
      const ndc = r.ndc_formatted as string
      const entry = result[ndc]
      if (!entry) continue
      entry.inMultum = true
      entry.orangeBookRating = (r.orange_book_rating as string | null) ?? null
      entry.orangeBookDescription = (r.orange_book_description as string | null) ?? null
      entry.imprintSide1 = (r.imprint_side_1 as string | null) ?? null
      entry.imprintSide2 = (r.imprint_side_2 as string | null) ?? null
      entry.scored = (r.is_scored as number | null) === 1
      entry.color = (r.pill_color as string | null) ?? null
      entry.shape = (r.pill_shape as string | null) ?? null
      entry.additionalDoseForm = (r.additional_dose_form as string | null) ?? null
      entry.imageFilename = (r.image_filename as string | null) ?? null
      entry.obsoleteDate = (r.obsolete_date as string | null) ?? null
    }
  } catch {
    // multum_ndc_combined not loaded — leave defaults (inMultum false).
  }

  // DailyMed — local cache only. No NIH calls in this endpoint; the popover
  // warms the cache on demand. Status:
  //   'available' — cache says SPL exists for this NDC
  //   'absent'    — cache says NIH has nothing
  //   'unknown'   — never been looked up
  try {
    const { rows } = await db.execute({
      sql: `SELECT ndc, has_data FROM dailymed_cache WHERE ndc IN (${placeholders})`,
      args: limited,
    })
    for (const r of rows) {
      const ndc = r.ndc as string
      const entry = result[ndc]
      if (!entry) continue
      entry.dailymedStatus = (r.has_data as number) === 1 ? 'available' : 'absent'
    }
  } catch {
    // dailymed_cache table doesn't exist yet — first popover open creates it.
  }

  return NextResponse.json(result)
}
