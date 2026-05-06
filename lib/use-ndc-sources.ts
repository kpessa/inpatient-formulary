"use client"

import { useEffect, useState } from "react"

export interface NdcSourcesSummary {
  inMultum: boolean
  /** Main Multum Drug Code — canonical clinical stacking key. Two NDCs
   *  with different MMDCs are clinically different products even if
   *  Cerner has them stacked under the same CDM (force-stack). The
   *  Supply tab uses this to surface that mismatch. */
  mmdc: number | null
  genericName: string | null
  strengthDescription: string | null
  doseFormDescription: string | null
  /**
   * AB rating from the FDA Orange Book ('A', 'B', '1'..'10', 'O', or null).
   * 'O' (Not Rated) is the default for 52% of NDCs and is NOT a positive
   * signal — the OB badge fires only when this is set AND not 'O'.
   */
  orangeBookRating: string | null
  orangeBookDescription: string | null
  imprintSide1: string | null
  imprintSide2: string | null
  scored: boolean
  color: string | null
  shape: string | null
  additionalDoseForm: string | null
  imageFilename: string | null
  dailymedStatus: "available" | "absent" | "unknown"
  /** Multum obsolete date (mm/dd/yy) when discontinued, null when active. */
  obsoleteDate: string | null
}

export type NdcSourcesMap = Record<string, NdcSourcesSummary>

// Module-level cache so swapping between rows / re-mounting components
// doesn't re-fire the same batch lookup. Keyed by NDC.
const cache = new Map<string, NdcSourcesSummary>()

/**
 * Batched per-NDC source-availability lookup. Hits `/api/ndc/sources` once
 * with all the NDCs that aren't already cached, then merges results into the
 * shared cache. Returns the loaded subset on every render — un-fetched NDCs
 * appear with the value `undefined` until the request settles.
 *
 * Sharing a single hook across the Supply tab + scanner sibling list means
 * a user who scans an NDC and then opens the Supply tab gets the data from
 * cache instantly, no re-fetch.
 */
export function useNdcSources(ndcs: readonly string[]): NdcSourcesMap {
  const [, force] = useState(0)

  useEffect(() => {
    const need = ndcs.filter((n) => n && !cache.has(n))
    if (need.length === 0) return
    let cancelled = false
    fetch("/api/ndc/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ndcs: need }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as NdcSourcesMap
      })
      .then((data) => {
        if (cancelled) return
        for (const [ndc, summary] of Object.entries(data)) {
          cache.set(ndc, summary)
        }
        force((n) => n + 1)
      })
      .catch(() => {
        // Soft fail — badges just stay in the unknown/loading state.
      })
    return () => {
      cancelled = true
    }
    // Re-run whenever the requested set changes. Joining + sorting keeps the
    // dep stable: `ndcs` array identity changes on every render in callers,
    // so we hash to a stable string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndcs.join("|")])

  // Build the slice the caller cares about from the shared cache.
  const out: NdcSourcesMap = {}
  for (const n of ndcs) {
    const v = cache.get(n)
    if (v) out[n] = v
  }
  return out
}
