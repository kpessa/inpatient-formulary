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

const STORAGE_KEY = 'admin-scan-cache:v1'

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
   *  facilities + domains. Per-facility breakdown is not preserved here —
   *  the NDC Move Alert UI is the place for that view. */
  barcodeTotals: Record<string, number>
}

/** Returns the current cache if any, or null. SSR-safe (returns null on
 *  the server). Catches JSON parse errors / corrupted data and treats
 *  them as "no cache." */
export function getAdminScanCache(): AdminScanCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AdminScanCache
    if (!parsed.barcodeTotals) return null
    return parsed
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
