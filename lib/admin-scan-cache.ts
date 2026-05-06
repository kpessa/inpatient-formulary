"use client"

/**
 * localStorage-backed cache of CCL admin-scan results, populated by the
 * NDC Move Alert page after each successful "Analyze" run. Other views
 * (Supply tab, Product Search, etc.) read it to overlay per-NDC usage
 * counts on their displays without needing the user to re-paste data.
 *
 * The cache is per-browser; multi-pharmacist setups would each warm
 * their own copy. A backend-persisted alternative is reasonable later
 * but adds load+sync complexity not worth shipping for v1.
 */

// Bumped from v1 → v2 when facility breakdown was added. Old caches
// without facilityScansByBarcode will gracefully read with an empty
// breakdown, so views still work after the upgrade — the user just won't
// see facility chips until they re-run NDC Move Alert.
const STORAGE_KEY = 'admin-scan-cache:v2'
const LEGACY_STORAGE_KEY = 'admin-scan-cache:v1'

export interface FacilityScan {
  mnemonic: string
  domain: string
  count: number
}

export interface AdminScanCache {
  /** ISO timestamp when this cache was written. Used to show freshness. */
  loadedAt: string
  /** Lookback window the underlying CCL query used. */
  lookbackDays: number
  /** Total scan ROWS the API parsed (sum of barcodeTotals values, used for
   *  display: "loaded N scans across M barcodes"). */
  totalScans: number
  /** Number of unique barcodes in the cache. */
  uniqueBarcodes: number
  /** Map: normalized-digits-only barcode → aggregate scan count across all
   *  facilities + domains. Used by views that just need a per-NDC total. */
  barcodeTotals: Record<string, number>
  /** Per-barcode facility breakdown. Lets the Supply tab render which
   *  facilities scanned each NDC, color-coded by domain. Mnemonics are
   *  resolved by the API via the facility_aliases table; raw Cerner names
   *  that didn't resolve are excluded here (visible separately as
   *  unresolvedFacilities). */
  facilityScansByBarcode: Record<string, FacilityScan[]>
}

/** Returns the current cache if any, or null. SSR-safe (returns null on
 *  the server). Catches JSON parse errors / corrupted data and treats
 *  them as "no cache." Falls back to v1 cache (no facilityScansByBarcode)
 *  for graceful upgrade. */
export function getAdminScanCache(): AdminScanCache | null {
  if (typeof window === 'undefined') return null
  try {
    let raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AdminScanCache>
    if (!parsed.barcodeTotals) return null
    // Hydrate missing field for forward-compat.
    return {
      loadedAt: parsed.loadedAt ?? new Date().toISOString(),
      lookbackDays: parsed.lookbackDays ?? 30,
      totalScans: parsed.totalScans ?? 0,
      uniqueBarcodes: parsed.uniqueBarcodes ?? 0,
      barcodeTotals: parsed.barcodeTotals,
      facilityScansByBarcode: parsed.facilityScansByBarcode ?? {},
    }
  } catch {
    return null
  }
}

/** Write a fresh cache. Overwrites any existing entry. The caller is
 *  responsible for aggregating barcodes (we just persist what's given). */
export function setAdminScanCache(cache: AdminScanCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    // Notify other tabs/views that the cache changed. localStorage events
    // only fire on OTHER tabs, so we also dispatch a custom event for the
    // current tab.
    window.dispatchEvent(new CustomEvent('admin-scan-cache-updated'))
  } catch {
    // Quota exceeded or storage disabled — fail silently.
  }
}

export function clearAdminScanCache(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new CustomEvent('admin-scan-cache-updated'))
  } catch {
    /* noop */
  }
}

/** Look up the scan count for one NDC, accounting for common barcode
 *  encoding variants (12-digit UPC with leading zero, trailing check digit
 *  +/- one). Returns 0 when no match — caller decides whether to render
 *  "0" vs "—". */
export function scansForNdc(ndc: string, cache: AdminScanCache | null): number {
  if (!cache) return 0
  const norm = ndc.replace(/[^0-9]/g, '')
  if (!norm) return 0
  let total = cache.barcodeTotals[norm] ?? 0
  // 12-digit UPC variant — leading zero before 11-digit NDC.
  const padded = '0' + norm
  if (cache.barcodeTotals[padded] != null) total += cache.barcodeTotals[padded]
  return total
}
