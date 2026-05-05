/**
 * OpenFDA integration.
 *
 * https://api.fda.gov/drug/ndc.json — the FDA NDC Directory: brand name,
 * generic name, labeler, dosage form, route, marketing status, active
 * ingredients, packaging.
 *
 * https://api.fda.gov/drug/label.json — the FDA Structured Product Label:
 * indications_and_usage, dosage_and_administration, contraindications,
 * warnings, adverse_reactions. We pull the SPL only when an NDC resolves;
 * the NDC Directory is what we always hit first because it's lightweight
 * and reliable.
 *
 * Cached per-NDC in `openfda_cache` (mirrors `dailymed_cache`). 30-day TTL,
 * negative-cache for NDCs OpenFDA doesn't index. 8s fetch timeout.
 */
import { getDb } from './db'

const OPENFDA_BASE = 'https://api.fda.gov/drug'
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const FETCH_TIMEOUT_MS = 8000

export interface OpenFdaActiveIngredient {
  name: string | null
  strength: string | null
}

export interface OpenFdaPackaging {
  package_ndc: string | null
  description: string | null
  marketing_start_date: string | null
}

export interface OpenFdaDetail {
  ndc: string
  /** Brand / proprietary name from the NDC Directory. */
  brandName: string | null
  /** Generic / non-proprietary name. */
  genericName: string | null
  /** Labeler / manufacturer. */
  labelerName: string | null
  /** Dosage form (e.g., "TABLET", "INJECTION, SOLUTION"). */
  dosageForm: string | null
  /** Route(s) (e.g., "ORAL", "INTRAVENOUS"). */
  route: string[]
  /** Marketing status / category (e.g., "PRESCRIPTION", "OTC", "DISCONTINUED"). */
  marketingCategory: string | null
  marketingStartDate: string | null
  marketingEndDate: string | null
  productNdc: string | null
  productType: string | null
  pharmClass: string[]
  deaSchedule: string | null
  activeIngredients: OpenFdaActiveIngredient[]
  packaging: OpenFdaPackaging[]
  /** Subset of FDA SPL fields that clinicians actually want at a glance. Each is
   *  a paragraph or two; we keep the raw text and let the UI decide on truncation. */
  label: {
    indicationsAndUsage: string | null
    dosageAndAdministration: string | null
    contraindications: string | null
    warnings: string | null
    boxedWarning: string | null
    adverseReactions: string | null
    /** SPL set ID — the same ID DailyMed uses, which means we can cross-link. */
    splSetId: string | null
  } | null
}

interface OpenFdaNdcResponse {
  results?: Array<{
    product_ndc?: string
    brand_name?: string
    generic_name?: string
    labeler_name?: string
    dosage_form?: string
    route?: string[]
    marketing_category?: string
    marketing_start_date?: string
    marketing_end_date?: string
    product_type?: string
    pharm_class?: string[]
    dea_schedule?: string
    active_ingredients?: Array<{ name?: string; strength?: string }>
    packaging?: Array<{
      package_ndc?: string
      description?: string
      marketing_start_date?: string
    }>
    openfda?: {
      spl_set_id?: string[]
      spl_id?: string[]
    }
  }>
}

interface OpenFdaLabelResponse {
  results?: Array<{
    indications_and_usage?: string[]
    dosage_and_administration?: string[]
    contraindications?: string[]
    warnings?: string[]
    boxed_warning?: string[]
    adverse_reactions?: string[]
    openfda?: {
      spl_set_id?: string[]
    }
  }>
}

let cacheTableReady: Promise<void> | null = null
async function ensureCacheTable(): Promise<void> {
  if (cacheTableReady) return cacheTableReady
  cacheTableReady = getDb()
    .execute(`
      CREATE TABLE IF NOT EXISTS openfda_cache (
        ndc          TEXT PRIMARY KEY,
        fetched_at   INTEGER NOT NULL,
        has_data     INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}'
      )
    `)
    .then(() => undefined)
    .catch(() => undefined)
  return cacheTableReady
}

async function readCache(ndc: string): Promise<OpenFdaDetail | null | undefined> {
  await ensureCacheTable()
  const { rows } = await getDb().execute({
    sql: `SELECT fetched_at, has_data, payload_json FROM openfda_cache WHERE ndc = ?`,
    args: [ndc],
  })
  if (rows.length === 0) return undefined
  const r = rows[0]
  const fetchedAt = r.fetched_at as number
  const ageSeconds = Math.floor(Date.now() / 1000) - fetchedAt
  if (ageSeconds > TTL_SECONDS) return undefined
  if ((r.has_data as number) === 0) return null
  try {
    return JSON.parse(r.payload_json as string) as OpenFdaDetail
  } catch {
    return undefined
  }
}

async function writeCache(ndc: string, detail: OpenFdaDetail | null): Promise<void> {
  await ensureCacheTable()
  const now = Math.floor(Date.now() / 1000)
  await getDb().execute({
    sql: `INSERT OR REPLACE INTO openfda_cache (ndc, fetched_at, has_data, payload_json)
          VALUES (?, ?, ?, ?)`,
    args: [ndc, now, detail ? 1 : 0, detail ? JSON.stringify(detail) : '{}'],
  })
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * OpenFDA stores NDCs in product-NDC form (`labeler-product`, hyphenated, often
 * with leading zeros stripped from one segment). Build the candidate variants
 * from a fully-padded 11-digit input.
 *
 * Most lookups are by *product NDC* (5-4 or 4-4 / 5-3), not by the full
 * package NDC. We try product-NDC variants first; if none hit, we fall back
 * to package-NDC variants.
 */
function generateProductNdcVariants(ndc: string): string[] {
  const packed = ndc.replace(/[^0-9]/g, '')
  if (packed.length !== 11) return [ndc]
  const variants = new Set<string>()
  // 5-4 (canonical, fully padded)
  variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}`)
  // 4-4 — labeler segment had leading zero
  if (packed[0] === '0') {
    variants.add(`${packed.slice(1, 5)}-${packed.slice(5, 9)}`)
  }
  // 5-3 — product segment had leading zero
  if (packed[5] === '0') {
    variants.add(`${packed.slice(0, 5)}-${packed.slice(6, 9)}`)
  }
  return Array.from(variants)
}

function generatePackageNdcVariants(ndc: string): string[] {
  const packed = ndc.replace(/[^0-9]/g, '')
  if (packed.length !== 11) return [ndc]
  const variants = new Set<string>()
  variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`)
  if (packed[0] === '0') {
    variants.add(`${packed.slice(1, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`)
  }
  if (packed[5] === '0') {
    variants.add(`${packed.slice(0, 5)}-${packed.slice(6, 9)}-${packed.slice(9, 11)}`)
  }
  if (packed[9] === '0') {
    variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(10, 11)}`)
  }
  return Array.from(variants)
}

function firstString(xs: string[] | undefined): string | null {
  if (!xs || xs.length === 0) return null
  const v = xs[0]?.trim()
  return v ? v : null
}

/**
 * Look up OpenFDA NDC Directory + label fields for an NDC. Returns null when
 * OpenFDA has no entry. Cached per-NDC for 30 days; negative results are also
 * cached.
 */
export async function lookupOpenFdaForNdc(ndc: string): Promise<OpenFdaDetail | null> {
  const trimmed = ndc.trim()
  if (!trimmed) return null

  const cached = await readCache(trimmed)
  if (cached !== undefined) return cached

  // 1) NDC Directory — try product-NDC variants, then package-NDC variants.
  const productVariants = generateProductNdcVariants(trimmed)
  const packageVariants = generatePackageNdcVariants(trimmed)
  let directory: NonNullable<OpenFdaNdcResponse['results']>[0] | null = null

  for (const v of productVariants) {
    const url = `${OPENFDA_BASE}/ndc.json?search=product_ndc:%22${encodeURIComponent(v)}%22&limit=1`
    const resp = await fetchJson<OpenFdaNdcResponse>(url)
    if (resp?.results && resp.results.length > 0) {
      directory = resp.results[0]
      break
    }
  }
  if (!directory) {
    for (const v of packageVariants) {
      const url = `${OPENFDA_BASE}/ndc.json?search=packaging.package_ndc:%22${encodeURIComponent(v)}%22&limit=1`
      const resp = await fetchJson<OpenFdaNdcResponse>(url)
      if (resp?.results && resp.results.length > 0) {
        directory = resp.results[0]
        break
      }
    }
  }

  if (!directory) {
    await writeCache(trimmed, null)
    return null
  }

  // 2) Optional label fetch — by SPL set ID if the directory entry has one;
  // otherwise by product_ndc. Best-effort; failures don't poison the directory
  // payload.
  let label: OpenFdaDetail['label'] = null
  const splSetId = directory.openfda?.spl_set_id?.[0] ?? null
  let labelResp: OpenFdaLabelResponse | null = null
  if (splSetId) {
    labelResp = await fetchJson<OpenFdaLabelResponse>(
      `${OPENFDA_BASE}/label.json?search=openfda.spl_set_id:%22${encodeURIComponent(splSetId)}%22&limit=1`,
    )
  }
  if (!labelResp?.results?.length && directory.product_ndc) {
    labelResp = await fetchJson<OpenFdaLabelResponse>(
      `${OPENFDA_BASE}/label.json?search=openfda.product_ndc:%22${encodeURIComponent(directory.product_ndc)}%22&limit=1`,
    )
  }
  const labelDoc = labelResp?.results?.[0]
  if (labelDoc) {
    label = {
      indicationsAndUsage: firstString(labelDoc.indications_and_usage),
      dosageAndAdministration: firstString(labelDoc.dosage_and_administration),
      contraindications: firstString(labelDoc.contraindications),
      warnings: firstString(labelDoc.warnings),
      boxedWarning: firstString(labelDoc.boxed_warning),
      adverseReactions: firstString(labelDoc.adverse_reactions),
      splSetId: labelDoc.openfda?.spl_set_id?.[0] ?? splSetId,
    }
  } else if (splSetId) {
    label = {
      indicationsAndUsage: null,
      dosageAndAdministration: null,
      contraindications: null,
      warnings: null,
      boxedWarning: null,
      adverseReactions: null,
      splSetId,
    }
  }

  const detail: OpenFdaDetail = {
    ndc: trimmed,
    brandName: directory.brand_name?.trim() || null,
    genericName: directory.generic_name?.trim() || null,
    labelerName: directory.labeler_name?.trim() || null,
    dosageForm: directory.dosage_form?.trim() || null,
    route: directory.route ?? [],
    marketingCategory: directory.marketing_category?.trim() || null,
    marketingStartDate: directory.marketing_start_date ?? null,
    marketingEndDate: directory.marketing_end_date ?? null,
    productNdc: directory.product_ndc ?? null,
    productType: directory.product_type?.trim() || null,
    pharmClass: directory.pharm_class ?? [],
    deaSchedule: directory.dea_schedule?.trim() || null,
    activeIngredients: (directory.active_ingredients ?? []).map((a) => ({
      name: a.name?.trim() || null,
      strength: a.strength?.trim() || null,
    })),
    packaging: (directory.packaging ?? []).map((p) => ({
      package_ndc: p.package_ndc ?? null,
      description: p.description ?? null,
      marketing_start_date: p.marketing_start_date ?? null,
    })),
    label,
  }
  await writeCache(trimmed, detail)
  return detail
}
