"use client"

import type { DomainRecord } from "@/lib/formulary-diff"
import { DomainCoveragePill } from "./DomainCoveragePill"

interface Props {
  ndc: string
  domainRecords?: DomainRecord[]
}

/**
 * Per-NDC supply coverage indicator. Renders a W/C/E pill (via the shared
 * `DomainCoveragePill`) where each segment is lit when that region's
 * *prod* domain has this NDC in its supply records.
 *
 * Cert / mock / build domains are intentionally excluded to match the
 * search-pill convention; only prod tells you whether a stack is live.
 */
export function NdcDomainCoverage({ ndc, domainRecords }: Props) {
  const prodWithNdc = new Set<string>()
  for (const dr of domainRecords ?? []) {
    if (!dr.item) continue
    const [region, env] = dr.domain.split("_")
    if (env !== "prod") continue
    if (dr.item.supplyRecords.some((r) => r.ndc === ndc)) {
      prodWithNdc.add(region)
    }
  }
  return <DomainCoveragePill litRegions={prodWithNdc} emptyTitle="no record" />
}
