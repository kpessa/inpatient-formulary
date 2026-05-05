/**
 * External-sources orchestrator — calls DailyMed (NIH/NLM SPL), OpenFDA
 * (NDC Directory + Label), and RxNorm (NLM) in parallel for an NDC and
 * coalesces the results into a single "consensus" view.
 *
 * Why coalesce: each source publishes drug identity (generic name, brand,
 * dosage form, manufacturer, route) but they don't always agree —
 * capitalization, pluralization, abbreviations differ. The consensus view
 * reports the values that two-or-more sources agree on as "verified" and
 * lists single-source values as "reported by".
 *
 * The raw per-source payloads are returned alongside the consensus so the
 * UI can drill into any individual source without an additional roundtrip.
 *
 * All three lookups are independent — one timing out or failing doesn't
 * affect the others. Each underlying lib already wraps fetch with an
 * AbortController and returns null on failure, so this orchestrator can
 * use Promise.all without try/catch wrappers.
 */

import { lookupDailymedForNdc, type DailymedDetail } from './dailymed'
import { lookupOpenFdaForNdc, type OpenFdaDetail } from './openfda'
import { lookupRxNormForNdc, type RxNormDetail } from './rxnorm'

export interface SourceField<T> {
  /** Best value across sources — preferred when 2+ sources agree, or first
   *  available when each source reports a different value. */
  value: T | null
  /** Per-source reported value, in display order. */
  reportedBy: Array<{ source: 'dailymed' | 'openfda' | 'rxnorm'; value: T }>
  /** True when 2+ sources agree on `value` (case-insensitive for strings). */
  agreed: boolean
}

export interface ExternalSourcesConsensus {
  genericName: SourceField<string>
  brandName: SourceField<string>
  dosageForm: SourceField<string>
  route: SourceField<string>
  manufacturer: SourceField<string>
  /** True when all three sources reported zero data for this NDC. */
  noneAvailable: boolean
}

export interface ExternalSourcesPayload {
  ndc: string
  /** Source coverage flags so the UI can render badges without inspecting each detail. */
  availability: {
    dailymed: boolean
    openfda: boolean
    rxnorm: boolean
  }
  consensus: ExternalSourcesConsensus
  dailymed: DailymedDetail | null
  openfda: OpenFdaDetail | null
  rxnorm: RxNormDetail | null
}

/**
 * Normalize a free-text identity field (drug name, dosage form, route) so
 * "Tablet" / "TABLET" / " tablet " all collapse to the same canonical form
 * for cross-source agreement. Returns null when the input is null or empty.
 */
function normalize(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/**
 * Build a SourceField from raw per-source values. Picks `value` by majority
 * (case-insensitive) — when 2+ sources match, that wins; otherwise the first
 * non-null source wins. `reportedBy` keeps the original casing per source.
 */
function buildField<T extends string>(
  reports: Array<{ source: 'dailymed' | 'openfda' | 'rxnorm'; value: T | null }>,
): SourceField<T> {
  const filtered = reports.filter(
    (r): r is { source: 'dailymed' | 'openfda' | 'rxnorm'; value: T } => r.value != null && r.value !== '',
  )
  if (filtered.length === 0) {
    return { value: null, reportedBy: [], agreed: false }
  }

  // Count occurrences by normalized form to find a majority.
  const counts = new Map<string, { display: T; count: number }>()
  for (const { value } of filtered) {
    const key = normalize(String(value)) ?? ''
    if (!key) continue
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(key, { display: value, count: 1 })
    }
  }
  let bestKey: string | null = null
  let bestCount = 0
  for (const [k, v] of counts.entries()) {
    if (v.count > bestCount) {
      bestKey = k
      bestCount = v.count
    }
  }
  const agreed = bestCount >= 2
  const value = agreed && bestKey ? counts.get(bestKey)!.display : filtered[0].value
  return {
    value,
    reportedBy: filtered.map((f) => ({ source: f.source, value: f.value })),
    agreed,
  }
}

function buildConsensus(
  dailymed: DailymedDetail | null,
  openfda: OpenFdaDetail | null,
  rxnorm: RxNormDetail | null,
): ExternalSourcesConsensus {
  // DailyMed: extract from `title` (e.g. "ASPIRIN 81 MG TABLET, DELAYED RELEASE
  // [LABELER]") — the leading word(s) are the generic, the trailing brackets
  // are the labeler. We don't try to parse mid-title strength/form here; that
  // belongs to OpenFDA and Multum, which already have it structured.
  const dmGeneric = dailymed?.title?.split(/\[/)[0].trim() || null
  const dmManufacturerMatch = dailymed?.title?.match(/\[([^\]]+)\]/)
  const dmManufacturer = dmManufacturerMatch ? dmManufacturerMatch[1].trim() : null

  // RxNorm: ingredient list is the closest match to "generic name". The first
  // ingredient name is the canonical one; multiple ingredients still produce
  // a useful display value (e.g. "amlodipine / benazepril").
  const rxIngredient =
    rxnorm?.ingredients && rxnorm.ingredients.length > 0
      ? rxnorm.ingredients.map((i) => i.name).join(' / ')
      : null
  const rxBrand =
    rxnorm?.brandNames && rxnorm.brandNames.length > 0 ? rxnorm.brandNames[0].name : null

  const genericName = buildField<string>([
    { source: 'dailymed', value: dmGeneric },
    { source: 'openfda', value: openfda?.genericName ?? null },
    { source: 'rxnorm', value: rxIngredient },
  ])

  const brandName = buildField<string>([
    { source: 'dailymed', value: null }, // DailyMed title doesn't reliably separate brand from generic
    { source: 'openfda', value: openfda?.brandName ?? null },
    { source: 'rxnorm', value: rxBrand },
  ])

  const dosageForm = buildField<string>([
    { source: 'dailymed', value: null },
    { source: 'openfda', value: openfda?.dosageForm ?? null },
    { source: 'rxnorm', value: null },
  ])

  // OpenFDA route is an array; collapse to a comma-joined display string.
  const ofdaRoute =
    openfda?.route && openfda.route.length > 0 ? openfda.route.join(', ') : null
  const route = buildField<string>([
    { source: 'dailymed', value: null },
    { source: 'openfda', value: ofdaRoute },
    { source: 'rxnorm', value: null },
  ])

  const manufacturer = buildField<string>([
    { source: 'dailymed', value: dmManufacturer },
    { source: 'openfda', value: openfda?.labelerName ?? null },
    { source: 'rxnorm', value: null },
  ])

  const noneAvailable = !dailymed && !openfda && !rxnorm

  return { genericName, brandName, dosageForm, route, manufacturer, noneAvailable }
}

/**
 * Look up DailyMed + OpenFDA + RxNorm for an NDC in parallel and return a
 * coalesced payload. Each underlying lib has its own per-NDC cache; this
 * function does no additional caching.
 */
export async function lookupExternalSourcesForNdc(
  ndc: string,
): Promise<ExternalSourcesPayload> {
  const trimmed = ndc.trim()
  const [dailymed, openfda, rxnorm] = await Promise.all([
    lookupDailymedForNdc(trimmed),
    lookupOpenFdaForNdc(trimmed),
    lookupRxNormForNdc(trimmed),
  ])

  return {
    ndc: trimmed,
    availability: {
      dailymed: dailymed != null,
      openfda: openfda != null,
      rxnorm: rxnorm != null,
    },
    consensus: buildConsensus(dailymed, openfda, rxnorm),
    dailymed,
    openfda,
    rxnorm,
  }
}
