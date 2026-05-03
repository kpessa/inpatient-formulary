"use client"

/**
 * Compact at-glance widgets for per-NDC reference content. Two surfaces:
 *
 *   <NdcSourceBadges>   — three-letter M / D / OB indicator, shows which
 *                          external sources have content on this NDC
 *   <NdcPillIdInline>   — imprint markings + color/shape/dose-form text,
 *                          rendered as a single compact line
 *
 * Both are designed to drop into Supply-tab-style rows where horizontal
 * space is tight. They consume the result of `useNdcSources(ndcs)` from
 * `lib/use-ndc-sources.ts`.
 */

import type { NdcSourcesSummary } from "@/lib/use-ndc-sources"

interface BadgesProps {
  summary: NdcSourcesSummary | undefined
  /** When true, badges render with the row's selected (white-on-blue) palette. */
  selected?: boolean
}

/**
 * Three small letter badges in a row: M (Multum), D (DailyMed), OB (FDA
 * Orange Book). Filled-in colors when present, muted gray when absent,
 * dotted outline when status is unknown (not yet looked up — DailyMed only).
 *
 * Hover any badge for a tooltip with what's actually available.
 */
export function NdcSourceBadges({ summary, selected }: BadgesProps) {
  if (!summary) {
    return (
      <div className="flex items-center gap-0.5">
        <PendingBadge />
        <PendingBadge />
        <PendingBadge />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Sources">
      <Badge
        label="M"
        present={summary.inMultum}
        title={
          summary.inMultum
            ? "In Multum (cost / package / formulation data available)"
            : "Not in Multum"
        }
        selected={selected}
        presentClasses="border-[#316AC5] bg-[#E5EEF7] text-[#0033AA]"
      />
      <Badge
        label="D"
        present={summary.dailymedStatus === "available"}
        unknown={summary.dailymedStatus === "unknown"}
        title={
          summary.dailymedStatus === "available"
            ? "DailyMed has SPL / images for this NDC"
            : summary.dailymedStatus === "absent"
            ? "Not in DailyMed"
            : "DailyMed not yet checked — open the popover to check"
        }
        selected={selected}
        presentClasses="border-green-700 bg-green-50 text-green-900"
      />
      <Badge
        label="OB"
        // 'O' is Multum's "Not Rated" code (~52% of all NDCs) — exclude from
        // the badge so it fires only on meaningful AB ratings (A/B/1-10).
        present={
          !!summary.orangeBookRating &&
          summary.orangeBookRating !== "O"
        }
        title={
          summary.orangeBookRating && summary.orangeBookRating !== "O"
            ? `FDA Orange Book rating: ${summary.orangeBookRating}${
                summary.orangeBookDescription ? ` — ${summary.orangeBookDescription}` : ""
              }`
            : summary.orangeBookRating === "O"
            ? "Not Rated in FDA Orange Book"
            : "No Orange Book entry"
        }
        selected={selected}
        presentClasses="border-purple-700 bg-purple-50 text-purple-900"
      />
      {summary.obsoleteDate && (
        // Conditional — only renders when Multum has flagged this NDC
        // discontinued. Amber to read as a warning, not just a category tag.
        <Badge
          label="OBS"
          present={true}
          title={`Obsolete since ${summary.obsoleteDate} — Multum has flagged this NDC discontinued`}
          selected={selected}
          presentClasses="border-amber-700 bg-amber-100 text-amber-900"
        />
      )}
    </div>
  )
}

function Badge({
  label,
  present,
  unknown,
  title,
  selected,
  presentClasses,
}: {
  label: string
  present: boolean
  unknown?: boolean
  title: string
  selected?: boolean
  /** Tailwind classes used when `present` is true and the row is unselected. */
  presentClasses: string
}) {
  let cls: string
  if (selected) {
    cls = present
      ? "border-white bg-white/20 text-white"
      : unknown
      ? "border-dotted border-white/60 text-white/70"
      : "border-white/40 text-white/50 line-through"
  } else if (present) {
    cls = presentClasses
  } else if (unknown) {
    cls = "border-dotted border-[#808080] text-[#808080]"
  } else {
    cls = "border-[#C0C0C0] text-[#C0C0C0]"
  }
  return (
    <span
      title={title}
      className={`text-[8px] font-bold uppercase tracking-wide leading-none px-0.5 min-w-[14px] h-3.5 flex items-center justify-center border ${cls}`}
    >
      {label}
    </span>
  )
}

function PendingBadge() {
  return (
    <span className="text-[8px] font-bold uppercase tracking-wide leading-none px-0.5 min-w-[14px] h-3.5 flex items-center justify-center border border-[#E0E0E0] bg-[#F5F5F5] text-[#C0C0C0]">
      …
    </span>
  )
}

interface PillIdInlineProps {
  summary: NdcSourcesSummary | undefined
  /** Highlights selected-row palette. */
  selected?: boolean
}

/**
 * Single-line pill-identification preview. Shows imprint markings prominently,
 * then color/shape/dose-form modifiers in muted text. Renders nothing when
 * summary has no imprint data — caller doesn't need a fallback.
 */
export function NdcPillIdInline({ summary, selected }: PillIdInlineProps) {
  if (!summary) return <span className="text-[#C0C0C0]">…</span>
  const markings = [summary.imprintSide1, summary.imprintSide2]
    .filter(Boolean)
    .join(" / ")
  const traits = [
    summary.color,
    summary.shape,
    summary.additionalDoseForm,
    summary.scored ? "scored" : null,
  ].filter(Boolean) as string[]
  if (!markings && traits.length === 0) {
    return <span className={selected ? "text-white/60" : "text-[#C0C0C0]"}>—</span>
  }
  return (
    <div className="flex flex-col leading-tight min-w-0">
      {markings && (
        <span className={`font-bold truncate ${selected ? "" : "text-[#202020]"}`}>
          {markings}
        </span>
      )}
      {traits.length > 0 && (
        <span
          className={`truncate text-[10px] ${selected ? "opacity-90" : "text-[#606060]"}`}
        >
          {traits.join(" · ")}
        </span>
      )}
    </div>
  )
}
