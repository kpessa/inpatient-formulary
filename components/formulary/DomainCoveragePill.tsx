"use client"

import { getDomainColor } from "@/lib/formulary-diff"

interface Props {
  /** Region keys present at this drug — e.g. new Set(["west", "central"]) */
  litRegions: Set<string>
  /** Which env palette to use. Defaults to "prod" since the existing
   *  NDC-stack and Product-Search pills are prod-only by convention
   *  (only prod tells you whether a stack is live). */
  env?: "prod" | "cert"
  /** Tooltip suffix shown on unlit segments — e.g. "no record",
   *  "not yet built". */
  emptyTitle?: string
  /** Subtle size tweak. Defaults match the row-height-friendly NDC pill;
   *  "tall" matches the Search Modal column variant. */
  size?: "default" | "tall"
}

/**
 * 3-segment W / C / E pill with each region color-coded via the project-wide
 * region/env palette. Each segment is "lit" when its region is in
 * `litRegions`, gray otherwise. Used in:
 *   - NdcDomainCoverage (NDC popover / supply table) — is the NDC stocked
 *     in this prod region?
 *   - Product Search Modal domain column — does this drug exist in this
 *     prod region?
 *   - Extract Changeset Viewer partial-build badge — is this newly-built
 *     drug deployed to this prod region?
 *
 * Cert / mock domains are intentionally excluded by default to match
 * existing convention; pass `env="cert"` to render a parallel pill.
 */
export function DomainCoveragePill({
  litRegions,
  env = "prod",
  emptyTitle = "no record",
  size = "default",
}: Props) {
  const heightCls = size === "tall" ? "h-[16px] px-1.5" : "h-[14px] px-1"
  return (
    <div className="inline-flex rounded-sm overflow-hidden border border-[#B0B0A8] align-middle">
      {(["west", "central", "east"] as const).map((reg, i) => {
        const lit = litRegions.has(reg)
        const { bg, text } = getDomainColor(reg, env)
        const letter = reg === "east" ? "E" : reg === "west" ? "W" : "C"
        const label = reg.charAt(0).toUpperCase() + reg.slice(1)
        return (
          <span
            key={reg}
            style={
              lit
                ? { background: bg, color: text }
                : { background: "#E8E8E4", color: "#C0C0C0" }
            }
            className={`text-[9px] font-bold leading-none select-none flex items-center ${heightCls} ${
              i > 0 ? "border-l border-l-black/20" : ""
            }`}
            title={`${label} ${env} — ${lit ? "present" : emptyTitle}`}
          >
            {letter}
          </span>
        )
      })}
    </div>
  )
}
