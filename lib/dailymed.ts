/**
 * DailyMed (NIH/NLM) integration.
 *
 * The DailyMed REST API at https://dailymed.nlm.nih.gov/dailymed/services/v2/
 * is the FDA's structured product label (SPL) repository. Given an NDC, we can
 * resolve to one or more SPL set IDs, then fetch the media (images) attached
 * to each label — carton photos, tablet imprints, label diagrams.
 *
 * Image URLs are publicly served by NIH and embeddable directly:
 *   https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid={setid}&name={name}
 *
 * We cache responses per-NDC in a small SQLite table. DailyMed labels change
 * rarely (when a manufacturer ships a new version), so a 30-day TTL is fine.
 * Negative results are also cached (has_data=0) so we don't hammer NIH for
 * NDCs they don't index.
 */
import { getDb } from './db'

const DAILYMED_BASE = 'https://dailymed.nlm.nih.gov/dailymed/services/v2'
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const FETCH_TIMEOUT_MS = 8000

export interface DailymedImage {
  /** Filename from DailyMed media manifest, e.g. "carton.jpg". */
  name: string
  /** Public NIH URL — `<img src>` directly. */
  url: string
  /** MIME type when reported by NIH; often falsy. */
  mimeType: string | null
}

export interface DailymedDetail {
  ndc: string
  /** Primary SPL set ID (UUID). null if no SPL was found. */
  setId: string | null
  /** Drug label title (e.g. "ASPIRIN 81 MG TABLET, DELAYED RELEASE"). */
  title: string | null
  /** ISO date the SPL was last published, when reported. */
  publishedDate: string | null
  /** When the NDC has multiple SPLs (multiple labelers/versions), how many we found. */
  splCount: number
  /** Image manifest from the primary SPL. */
  images: DailymedImage[]
}

interface DailymedSplListResponse {
  data?: Array<{
    setid?: string
    title?: string
    published_date?: string
  }>
}

interface DailymedMediaResponse {
  data?: {
    media?: Array<{
      name?: string
      mime_type?: string
      url?: string
    }>
  }
}

// Memoize the CREATE TABLE so concurrent callers don't all race against a
// WAL checkpoint. Once any call succeeds (or once the schema-defined table
// is verified to exist), every subsequent invocation is a no-op. SQLITE_BUSY
// from the create itself is swallowed — it means another writer beat us to
// the same statement, and the table will exist for our subsequent read.
let cacheTableReady: Promise<void> | null = null
async function ensureCacheTable(): Promise<void> {
  if (cacheTableReady) return cacheTableReady
  cacheTableReady = getDb()
    .execute(`
      CREATE TABLE IF NOT EXISTS dailymed_cache (
        ndc          TEXT PRIMARY KEY,
        fetched_at   INTEGER NOT NULL,
        has_data     INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}'
      )
    `)
    .then(() => undefined)
    .catch(() => {
      // Likely SQLITE_BUSY (concurrent CREATE) or the table already exists
      // from schema.sql. Either way, downstream reads/writes will tell us
      // for sure. Don't retry the create.
      return undefined
    })
  return cacheTableReady
}

async function readCache(ndc: string): Promise<DailymedDetail | null | undefined> {
  await ensureCacheTable()
  const { rows } = await getDb().execute({
    sql: `SELECT fetched_at, has_data, payload_json FROM dailymed_cache WHERE ndc = ?`,
    args: [ndc],
  })
  if (rows.length === 0) return undefined
  const r = rows[0]
  const fetchedAt = r.fetched_at as number
  const ageSeconds = Math.floor(Date.now() / 1000) - fetchedAt
  if (ageSeconds > TTL_SECONDS) return undefined // stale
  if ((r.has_data as number) === 0) return null // negative cache
  try {
    return JSON.parse(r.payload_json as string) as DailymedDetail
  } catch {
    return undefined
  }
}

async function writeCache(
  ndc: string,
  detail: DailymedDetail | null,
): Promise<void> {
  await ensureCacheTable()
  const now = Math.floor(Date.now() / 1000)
  await getDb().execute({
    sql: `INSERT OR REPLACE INTO dailymed_cache (ndc, fetched_at, has_data, payload_json)
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
 * DailyMed stores NDCs in the original 10-digit published form, but Multum
 * (and our DB) zero-pad everything to 11-digit 5-4-2. Generate the candidate
 * forms DailyMed might have indexed: the 5-4-2 itself, plus 4-4-2 / 5-3-2 /
 * 5-4-1 strip-leading-zero forms when applicable. Caller tries each in order
 * until one returns SPLs.
 *
 * Example: `63941-0157-12` (Multum-padded) → tries `63941-0157-12`,
 * `63941-157-12` (5-3-2), and any other applicable strips. DailyMed has it
 * as `63941-157-12`, so the second variant hits.
 */
function generateNdcVariants(ndc: string): string[] {
  const packed = ndc.replace(/[^0-9]/g, '')
  if (packed.length !== 11) return [ndc]
  const variants = new Set<string>()
  // 5-4-2 (Multum / Cerner canonical, fully padded)
  variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`)
  // 4-4-2 — labeler had a leading zero stripped in the original 10-digit form
  if (packed[0] === '0') {
    variants.add(`${packed.slice(1, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`)
  }
  // 5-3-2 — product segment had a leading zero stripped
  if (packed[5] === '0') {
    variants.add(`${packed.slice(0, 5)}-${packed.slice(6, 9)}-${packed.slice(9, 11)}`)
  }
  // 5-4-1 — package segment had a leading zero stripped
  if (packed[9] === '0') {
    variants.add(`${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(10, 11)}`)
  }
  return Array.from(variants)
}

/**
 * Look up DailyMed metadata + images for an NDC. Returns null when DailyMed
 * has no SPL for this NDC. Cached per-NDC for 30 days; negative results are
 * also cached.
 */
export async function lookupDailymedForNdc(
  ndc: string,
): Promise<DailymedDetail | null> {
  const trimmed = ndc.trim()
  if (!trimmed) return null

  // Cache check.
  const cached = await readCache(trimmed)
  if (cached !== undefined) return cached

  // 1. Resolve NDC → list of SPL set IDs. DailyMed stores NDCs in the
  // labeler-published form, which may strip leading zeros from one segment.
  // Try canonical 5-4-2 first, then strip-leading-zero variants until one
  // returns hits. Most look-ups resolve on the first variant.
  const variants = generateNdcVariants(trimmed)
  let spls: NonNullable<DailymedSplListResponse['data']> = []
  for (const v of variants) {
    const splUrl = `${DAILYMED_BASE}/spls.json?ndc=${encodeURIComponent(v)}`
    const splResp = await fetchJson<DailymedSplListResponse>(splUrl)
    if (splResp?.data && splResp.data.length > 0) {
      spls = splResp.data
      break
    }
  }
  if (spls.length === 0) {
    await writeCache(trimmed, null)
    return null
  }

  // 2. Pick the primary SPL — most recent by published_date when present,
  // otherwise the first one in the response (NIH orders newest-first).
  const primary = [...spls].sort((a, b) => {
    const ad = a.published_date ?? ''
    const bd = b.published_date ?? ''
    return bd.localeCompare(ad)
  })[0]
  const setId = primary.setid ?? null
  if (!setId) {
    await writeCache(trimmed, null)
    return null
  }

  // 3. Fetch the media manifest for the primary SPL.
  const mediaUrl = `${DAILYMED_BASE}/spls/${setId}/media.json`
  const mediaResp = await fetchJson<DailymedMediaResponse>(mediaUrl)
  const mediaItems = mediaResp?.data?.media ?? []

  const images: DailymedImage[] = mediaItems
    .filter((m) => !!m.name)
    .map((m) => ({
      name: m.name as string,
      // Standard DailyMed image URL shape. Some `media[].url` fields are
      // returned absolute by NIH; prefer that when present, otherwise build
      // the canonical image.cfm URL from setid + name.
      url:
        m.url ??
        `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid=${encodeURIComponent(setId)}&name=${encodeURIComponent(m.name as string)}`,
      mimeType: m.mime_type ?? null,
    }))

  const detail: DailymedDetail = {
    ndc: trimmed,
    setId,
    title: primary.title ?? null,
    publishedDate: primary.published_date ?? null,
    splCount: spls.length,
    images,
  }
  await writeCache(trimmed, detail)
  return detail
}
