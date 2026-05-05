"use client"

/**
 * ExternalSourcesPanel — coalesced view of DailyMed (NIH SPL) + OpenFDA
 * (NDC Directory + Label) + RxNorm (NLM concept service) for the scanned
 * NDC. Lazy-fetches `/api/ndc/[ndc]/external` on mount; the API caches
 * each underlying source server-side per-NDC for 30 days.
 *
 * Why lazy-load instead of including in the /api/barcode payload: the
 * diagnosis itself should render instantly off the local Multum/Turso
 * data. NIH/FDA endpoints can be slow or briefly unavailable, and we
 * don't want a slow government API blocking the verdict that pharmacists
 * are waiting on. The panel renders its own loading / partial states.
 *
 * Renders three sections:
 *   1. Availability badges (D / F / R) showing which sources had data.
 *   2. Consensus identity grid — agreed-on values get a checkmark; sources
 *      that disagree are listed inline so the user can see the discrepancy.
 *   3. A collapsible per-source detail block — DailyMed images + label info,
 *      OpenFDA marketing/label fields, RxNorm concept tree.
 */

import { useEffect, useState } from "react"

interface SourceField<T> {
  value: T | null
  reportedBy: Array<{ source: 'dailymed' | 'openfda' | 'rxnorm'; value: T }>
  agreed: boolean
}

interface ConsensusBlock {
  genericName: SourceField<string>
  brandName: SourceField<string>
  dosageForm: SourceField<string>
  route: SourceField<string>
  manufacturer: SourceField<string>
  noneAvailable: boolean
}

interface DailymedImage {
  name: string
  url: string
  mimeType: string | null
}

interface DailymedDetail {
  ndc: string
  setId: string | null
  title: string | null
  publishedDate: string | null
  splCount: number
  images: DailymedImage[]
}

interface OpenFdaActiveIngredient {
  name: string | null
  strength: string | null
}

interface OpenFdaDetail {
  ndc: string
  brandName: string | null
  genericName: string | null
  labelerName: string | null
  dosageForm: string | null
  route: string[]
  marketingCategory: string | null
  marketingStartDate: string | null
  marketingEndDate: string | null
  productNdc: string | null
  productType: string | null
  pharmClass: string[]
  deaSchedule: string | null
  activeIngredients: OpenFdaActiveIngredient[]
  packaging: Array<{
    package_ndc: string | null
    description: string | null
    marketing_start_date: string | null
  }>
  label: {
    indicationsAndUsage: string | null
    dosageAndAdministration: string | null
    contraindications: string | null
    warnings: string | null
    boxedWarning: string | null
    adverseReactions: string | null
    splSetId: string | null
  } | null
}

interface RxNormConcept {
  rxcui: string
  name: string
  tty: string
}

interface RxNormDetail {
  ndc: string
  rxcui: string | null
  name: string | null
  tty: string | null
  status: string | null
  ingredients: RxNormConcept[]
  brandNames: RxNormConcept[]
  scd: RxNormConcept[]
  sbd: RxNormConcept[]
}

interface ExternalSourcesPayload {
  ndc: string
  availability: {
    dailymed: boolean
    openfda: boolean
    rxnorm: boolean
  }
  consensus: ConsensusBlock
  dailymed: DailymedDetail | null
  openfda: OpenFdaDetail | null
  rxnorm: RxNormDetail | null
}

// Module-level cache keyed by NDC so re-rendering the panel for the same
// NDC during a scan session doesn't refetch.
const payloadCache = new Map<string, ExternalSourcesPayload>()

export function ExternalSourcesPanel({ ndc }: { ndc: string }) {
  const [payload, setPayload] = useState<ExternalSourcesPayload | null>(
    () => payloadCache.get(ndc) ?? null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ndc) return
    if (payloadCache.has(ndc)) {
      setPayload(payloadCache.get(ndc) ?? null)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/ndc/${encodeURIComponent(ndc)}/external`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as ExternalSourcesPayload
      })
      .then((d) => {
        payloadCache.set(ndc, d)
        setPayload(d)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Lookup failed")
      })
      .finally(() => setLoading(false))
  }, [ndc])

  if (loading) {
    return (
      <div className="border border-[#808080] bg-white">
        <div className="px-2 py-1 bg-[#D4D0C8] border-b border-[#808080] text-[10px] uppercase text-[#404040] flex items-center justify-between">
          <span>External sources (NIH / FDA / RxNorm)</span>
          <span className="italic text-[#808080] normal-case">Loading…</span>
        </div>
        <div className="p-2 space-y-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-3 bg-[#E0E0E0] animate-pulse"
              style={{ width: `${50 + ((i * 17) % 40)}%` }}
            />
          ))}
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="border border-[#CC0000] bg-red-50 text-[#CC0000] px-2 py-1 text-xs">
        External sources: {error}
      </div>
    )
  }
  if (!payload) return null

  return (
    <div className="border border-[#808080] bg-white">
      <div className="px-2 py-1 bg-[#D4D0C8] border-b border-[#808080] text-[10px] uppercase text-[#404040] flex items-center justify-between">
        <span>External sources (NIH / FDA / RxNorm)</span>
        <AvailabilityBadges availability={payload.availability} />
      </div>
      <div className="p-2 space-y-2">
        {payload.consensus.noneAvailable ? (
          <div className="text-[11px] text-[#606060] italic">
            None of DailyMed, OpenFDA, or RxNorm have data for this NDC. It
            may be a hospital-repackaged inner NDC, an inactive labeler, or
            a private-label product the public registries don&apos;t index.
          </div>
        ) : (
          <ConsensusGrid consensus={payload.consensus} />
        )}

        {/* Per-source drill-in. Each section is independently collapsible. */}
        {payload.dailymed && <DailymedSection detail={payload.dailymed} />}
        {payload.openfda && <OpenFdaSection detail={payload.openfda} />}
        {payload.rxnorm && <RxNormSection detail={payload.rxnorm} />}
      </div>
    </div>
  )
}

function AvailabilityBadges({
  availability,
}: {
  availability: ExternalSourcesPayload["availability"]
}) {
  const items: Array<{ key: keyof typeof availability; label: string; title: string }> = [
    { key: "dailymed", label: "D", title: "DailyMed (NIH SPL)" },
    { key: "openfda", label: "F", title: "OpenFDA (NDC Directory + Label)" },
    { key: "rxnorm", label: "R", title: "RxNorm (NLM concept service)" },
  ]
  return (
    <div className="flex items-center gap-1 normal-case">
      {items.map((it) => {
        const ok = availability[it.key]
        return (
          <span
            key={it.key}
            title={`${it.title} — ${ok ? "found" : "no data"}`}
            className={`inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold border ${
              ok
                ? "border-green-700 bg-green-50 text-green-900"
                : "border-[#C0C0C0] bg-[#F5F5F5] text-[#A0A0A0]"
            }`}
          >
            {it.label}
          </span>
        )
      })}
    </div>
  )
}

function ConsensusGrid({ consensus }: { consensus: ConsensusBlock }) {
  const fields: Array<{ label: string; field: SourceField<string> }> = [
    { label: "Generic", field: consensus.genericName },
    { label: "Brand", field: consensus.brandName },
    { label: "Form", field: consensus.dosageForm },
    { label: "Route", field: consensus.route },
    { label: "Labeler", field: consensus.manufacturer },
  ]
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
      {fields.map((f) => (
        <ConsensusRow key={f.label} label={f.label} field={f.field} />
      ))}
    </div>
  )
}

function ConsensusRow({
  label,
  field,
}: {
  label: string
  field: SourceField<string>
}) {
  if (field.value == null) {
    return (
      <div className="flex gap-1 items-baseline min-w-0 text-xs">
        <span className="text-[#808080] shrink-0">{label}:</span>
        <span className="text-[#808080]">—</span>
      </div>
    )
  }
  // When 2+ sources agreed, show a single value with a checkmark. When sources
  // disagreed, show the chosen value with a small "(disagrees)" tooltip pill
  // so the user knows to look at the per-source breakdown.
  const sourceList = field.reportedBy.map((r) => sourceShort(r.source)).join(", ")
  return (
    <div className="flex gap-1 items-baseline min-w-0 text-xs">
      <span className="text-[#808080] shrink-0">{label}:</span>
      <span className="truncate" title={field.reportedBy.map((r) => `${sourceShort(r.source)}: ${r.value}`).join("\n")}>
        {field.value}
      </span>
      {field.agreed ? (
        <span
          className="text-green-800 text-[10px] shrink-0"
          title={`Agreed by ${sourceList}`}
        >
          ✓
        </span>
      ) : (
        <span
          className="text-[#808080] text-[10px] italic shrink-0"
          title={field.reportedBy.map((r) => `${sourceShort(r.source)}: ${r.value}`).join("\n")}
        >
          ({sourceList})
        </span>
      )}
    </div>
  )
}

function sourceShort(s: 'dailymed' | 'openfda' | 'rxnorm'): string {
  if (s === 'dailymed') return "DailyMed"
  if (s === 'openfda') return "FDA"
  return "RxNorm"
}

function DailymedSection({ detail }: { detail: DailymedDetail }) {
  return (
    <details className="border border-[#C0C0C0] bg-[#FAFAFA]">
      <summary className="px-2 py-1 cursor-pointer bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[10px] uppercase text-[#404040]">
        DailyMed (NIH SPL)
        {detail.title && (
          <span className="normal-case font-normal text-[#606060] ml-2">
            {detail.title}
          </span>
        )}
      </summary>
      <div className="p-2 space-y-2 text-xs">
        <div className="text-[#606060] flex flex-wrap gap-x-3 gap-y-0.5">
          {detail.publishedDate && <span>Published: {detail.publishedDate}</span>}
          {detail.splCount > 1 && <span>{detail.splCount} labels</span>}
          {detail.setId && (
            <a
              href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${detail.setId}`}
              target="_blank"
              rel="noreferrer"
              className="text-[#0033AA] hover:underline"
            >
              full label →
            </a>
          )}
        </div>
        {detail.images.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto">
            {detail.images.slice(0, 8).map((img, i) => (
              <a
                key={`${img.name}-${i}`}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                title={img.name}
                className="shrink-0 border border-[#C0C0C0] hover:border-[#316AC5] bg-white"
              >
                <img
                  src={img.url}
                  alt={img.name}
                  loading="lazy"
                  className="h-16 w-16 object-contain"
                />
              </a>
            ))}
          </div>
        ) : (
          <div className="text-[#808080] italic">No label images available.</div>
        )}
      </div>
    </details>
  )
}

function OpenFdaSection({ detail }: { detail: OpenFdaDetail }) {
  const ingredients = detail.activeIngredients
    .filter((i) => i.name)
    .map((i) => `${i.name}${i.strength ? ` ${i.strength}` : ""}`)
    .join(" / ")

  return (
    <details className="border border-[#C0C0C0] bg-[#FAFAFA]">
      <summary className="px-2 py-1 cursor-pointer bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[10px] uppercase text-[#404040]">
        OpenFDA (NDC directory + label)
        {detail.brandName && (
          <span className="normal-case font-normal text-[#606060] ml-2">
            {detail.brandName}
            {detail.genericName ? ` — ${detail.genericName}` : ""}
          </span>
        )}
      </summary>
      <div className="p-2 space-y-2 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
          <Field label="Marketing" value={detail.marketingCategory} />
          <Field label="Product type" value={detail.productType} />
          <Field label="Product NDC" value={detail.productNdc} mono />
          <Field label="Form" value={detail.dosageForm} />
          <Field label="Route" value={detail.route.join(", ")} />
          <Field label="DEA schedule" value={detail.deaSchedule} />
          <Field label="Marketing start" value={detail.marketingStartDate} />
          <Field label="Marketing end" value={detail.marketingEndDate} />
        </div>
        {ingredients && (
          <div>
            <div className="text-[10px] uppercase text-[#808080]">Active ingredients</div>
            <div>{ingredients}</div>
          </div>
        )}
        {detail.pharmClass.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-[#808080]">Pharmacologic class</div>
            <div className="flex flex-wrap gap-1">
              {detail.pharmClass.map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  className="inline-block px-1.5 py-0.5 border border-[#C0C0C0] bg-white text-[10px]"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
        {detail.label && (
          <div className="space-y-1.5 pt-1 border-t border-[#E0E0E0]">
            {detail.label.boxedWarning && (
              <LabelBlock
                label="⚠ Boxed warning"
                value={detail.label.boxedWarning}
                emphasize
              />
            )}
            <LabelBlock label="Indications" value={detail.label.indicationsAndUsage} />
            <LabelBlock
              label="Dosage & administration"
              value={detail.label.dosageAndAdministration}
            />
            <LabelBlock label="Contraindications" value={detail.label.contraindications} />
            <LabelBlock label="Warnings" value={detail.label.warnings} />
            <LabelBlock label="Adverse reactions" value={detail.label.adverseReactions} />
          </div>
        )}
      </div>
    </details>
  )
}

function RxNormSection({ detail }: { detail: RxNormDetail }) {
  return (
    <details className="border border-[#C0C0C0] bg-[#FAFAFA]">
      <summary className="px-2 py-1 cursor-pointer bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[10px] uppercase text-[#404040]">
        RxNorm (NLM)
        {detail.name && (
          <span className="normal-case font-normal text-[#606060] ml-2">
            {detail.name}
          </span>
        )}
      </summary>
      <div className="p-2 space-y-2 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
          <Field label="RxCUI" value={detail.rxcui} mono />
          <Field label="Term type" value={detail.tty} />
          <Field
            label="Status"
            value={detail.status}
            emphasize={detail.status != null && detail.status.toUpperCase() !== "ACTIVE"}
          />
        </div>
        {detail.ingredients.length > 0 && (
          <ConceptList title="Ingredients (IN/MIN/PIN)" concepts={detail.ingredients} />
        )}
        {detail.brandNames.length > 0 && (
          <ConceptList title="Brand names (BN)" concepts={detail.brandNames} />
        )}
        {detail.scd.length > 0 && (
          <ConceptList title="Clinical drug forms (SCD)" concepts={detail.scd} />
        )}
        {detail.sbd.length > 0 && (
          <ConceptList title="Branded drug forms (SBD)" concepts={detail.sbd} />
        )}
        {detail.rxcui && (
          <div>
            <a
              href={`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${detail.rxcui}`}
              target="_blank"
              rel="noreferrer"
              className="text-[#0033AA] hover:underline text-[11px]"
            >
              open in RxNav →
            </a>
          </div>
        )}
      </div>
    </details>
  )
}

function ConceptList({
  title,
  concepts,
}: {
  title: string
  concepts: RxNormConcept[]
}) {
  return (
    <div>
      <div className="text-[10px] uppercase text-[#808080]">{title}</div>
      <ul className="space-y-0.5">
        {concepts.map((c) => (
          <li key={`${c.tty}-${c.rxcui}`} className="flex items-baseline gap-1">
            <span className="text-[10px] text-[#808080] font-mono shrink-0">[{c.tty}]</span>
            <span className="font-mono text-[10px] text-[#606060] shrink-0">{c.rxcui}</span>
            <span className="truncate">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
  emphasize,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  emphasize?: boolean
}) {
  return (
    <div className="flex gap-1 items-baseline min-w-0">
      <span className="text-[#808080] shrink-0">{label}:</span>
      <span
        className={`truncate ${mono ? "font-mono tabular-nums" : ""} ${
          emphasize ? "text-orange-900 font-bold" : ""
        }`}
      >
        {value || <span className="text-[#808080]">—</span>}
      </span>
    </div>
  )
}

function LabelBlock({
  label,
  value,
  emphasize,
}: {
  label: string
  value: string | null
  emphasize?: boolean
}) {
  if (!value) return null
  return (
    <div
      className={`border ${emphasize ? "border-orange-700 bg-orange-50" : "border-[#E0E0E0] bg-white"} p-1.5`}
    >
      <div
        className={`text-[10px] uppercase mb-0.5 ${
          emphasize ? "text-orange-900 font-bold" : "text-[#808080]"
        }`}
      >
        {label}
      </div>
      <div className="text-[11px] whitespace-pre-wrap line-clamp-6">{value}</div>
    </div>
  )
}
