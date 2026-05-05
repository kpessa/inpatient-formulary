/**
 * RxNorm (NIH/NLM) integration.
 *
 * https://rxnav.nlm.nih.gov/REST — RxNorm is the standardized drug-naming
 * vocabulary maintained by NLM. Given an NDC we can resolve to an RxCUI
 * (concept identifier), then ask RxNorm for:
 *   - Properties (name, term type)
 *   - Active ingredients (TTY = IN / MIN / PIN)
 *   - Brand vs. generic concepts (BN, SCD, SBD)
 *   - History / status (active, obsolete, remapped)
 *
 * Cached per-NDC in `rxnorm_cache` (mirrors `dailymed_cache` / `openfda_cache`).
 * 30-day TTL, negative-cache for NDCs RxNorm doesn't index. 8s fetch timeout.
 */
import { getDb } from './db'

const RXNORM_BASE = 'https://rxnav.nlm.nih.gov/REST'
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const FETCH_TIMEOUT_MS = 8000

export interface RxNormConcept {
  rxcui: string
  name: string
  /** Term type — IN (ingredient), PIN (precise), MIN (multi), BN (brand), SCD/SBD (clinical/branded drug). */
  tty: string
}

export interface RxNormDetail {
  /** NDC the request came in with (Multum-padded 5-4-2 form, hyphenated). */
  ndc: string
  /** Resolved RxCUI for the NDC, or null when not in RxNorm. */
  rxcui: string | null
  /** Friendly name (RxNorm "name" property). */
  name: string | null
  /** Term type of the resolved RxCUI (usually SCD or SBD). */
  tty: string | null
  /** RxNorm status: ACTIVE / OBSOLETE / REMAPPED / etc. */
  status: string | null
  /** Active ingredient(s) — IN / MIN / PIN. */
  ingredients: RxNormConcept[]
  /** Brand-name concepts (TTY=BN). */
  brandNames: RxNormConcept[]
  /** Clinical drug forms (TTY=SCD). */
  scd: RxNormConcept[]
  /** Branded drug forms (TTY=SBD). */
  sbd: RxNormConcept[]
}

interface NdcStatusResponse {
  ndcStatus?: {
    status?: string
    rxcui?: string
    conceptName?: string
    ndc?: string
  }
}

interface PropertiesResponse {
  properties?: {
    rxcui?: string
    name?: string
    tty?: string
  }
}

interface RelatedResponse {
  relatedGroup?: {
    conceptGroup?: Array<{
      tty?: string
      conceptProperties?: Array<{
        rxcui?: string
        name?: string
        tty?: string
      }>
    }>
  }
}

let cacheTableReady: Promise<void> | null = null
async function ensureCacheTable(): Promise<void> {
  if (cacheTableReady) return cacheTableReady
  cacheTableReady = getDb()
    .execute(`
      CREATE TABLE IF NOT EXISTS rxnorm_cache (
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

async function readCache(ndc: string): Promise<RxNormDetail | null | undefined> {
  await ensureCacheTable()
  const { rows } = await getDb().execute({
    sql: `SELECT fetched_at, has_data, payload_json FROM rxnorm_cache WHERE ndc = ?`,
    args: [ndc],
  })
  if (rows.length === 0) return undefined
  const r = rows[0]
  const fetchedAt = r.fetched_at as number
  const ageSeconds = Math.floor(Date.now() / 1000) - fetchedAt
  if (ageSeconds > TTL_SECONDS) return undefined
  if ((r.has_data as number) === 0) return null
  try {
    return JSON.parse(r.payload_json as string) as RxNormDetail
  } catch {
    return undefined
  }
}

async function writeCache(ndc: string, detail: RxNormDetail | null): Promise<void> {
  await ensureCacheTable()
  const now = Math.floor(Date.now() / 1000)
  await getDb().execute({
    sql: `INSERT OR REPLACE INTO rxnorm_cache (ndc, fetched_at, has_data, payload_json)
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
 * RxNorm typically expects an 11-digit packed NDC (no separators) for
 * /ndcstatus and /rxcui?idtype=NDC. Our NDCs are stored fully padded
 * 5-4-2; just strip the hyphens.
 */
function packedNdc(ndc: string): string {
  return ndc.replace(/[^0-9]/g, '')
}

/**
 * Look up RxNorm concept information for an NDC. Returns null when RxNorm
 * has no concept for this NDC. Cached per-NDC for 30 days.
 */
export async function lookupRxNormForNdc(ndc: string): Promise<RxNormDetail | null> {
  const trimmed = ndc.trim()
  if (!trimmed) return null

  const cached = await readCache(trimmed)
  if (cached !== undefined) return cached

  const packed = packedNdc(trimmed)
  if (packed.length !== 11) {
    await writeCache(trimmed, null)
    return null
  }

  // 1) NDC → status + RxCUI. /ndcstatus returns ACTIVE/OBSOLETE/etc plus the
  // resolved RxCUI when one exists.
  const statusUrl = `${RXNORM_BASE}/ndcstatus.json?ndc=${encodeURIComponent(packed)}`
  const statusResp = await fetchJson<NdcStatusResponse>(statusUrl)
  const ndcStatus = statusResp?.ndcStatus
  const rxcui = ndcStatus?.rxcui?.trim() || null
  const status = ndcStatus?.status?.trim() || null
  if (!rxcui) {
    // No RxCUI → still cache the negative-ish result with status only so we
    // don't keep re-asking. Treat as null for callers.
    await writeCache(trimmed, null)
    return null
  }

  // 2) Properties (name, tty) and related concepts in parallel.
  const [propsResp, relatedResp] = await Promise.all([
    fetchJson<PropertiesResponse>(
      `${RXNORM_BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`,
    ),
    fetchJson<RelatedResponse>(
      `${RXNORM_BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN+MIN+PIN+BN+SCD+SBD`,
    ),
  ])

  const props = propsResp?.properties
  const groups = relatedResp?.relatedGroup?.conceptGroup ?? []
  const byTty = new Map<string, RxNormConcept[]>()
  for (const g of groups) {
    if (!g.tty) continue
    const items: RxNormConcept[] = (g.conceptProperties ?? [])
      .filter((c) => c.rxcui && c.name)
      .map((c) => ({
        rxcui: c.rxcui as string,
        name: c.name as string,
        tty: c.tty || g.tty || '',
      }))
    if (items.length > 0) byTty.set(g.tty, items)
  }

  const ingredients = [
    ...(byTty.get('IN') ?? []),
    ...(byTty.get('MIN') ?? []),
    ...(byTty.get('PIN') ?? []),
  ]

  const detail: RxNormDetail = {
    ndc: trimmed,
    rxcui,
    name: props?.name?.trim() || ndcStatus?.conceptName?.trim() || null,
    tty: props?.tty?.trim() || null,
    status,
    ingredients,
    brandNames: byTty.get('BN') ?? [],
    scd: byTty.get('SCD') ?? [],
    sbd: byTty.get('SBD') ?? [],
  }
  await writeCache(trimmed, detail)
  return detail
}
