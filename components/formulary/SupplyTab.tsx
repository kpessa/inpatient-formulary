"use client"

import { useMemo, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { FormularyItem, SupplyRecord } from "@/lib/types"
import type { FieldValueMap, DomainRecord, DomainValue } from "@/lib/formulary-diff"
import { useNdcSources, type NdcSourcesSummary } from "@/lib/use-ndc-sources"
import { NdcSourceBadges, NdcPillIdInline } from "./NdcSourceBadges"
import { NdcDomainCoverage } from "./NdcDomainCoverage"
import { NdcDetailPopover } from "./NdcDetailPopover"

interface SupplyTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  domainRecords?: DomainRecord[]
  onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void
}

/**
 * NDC cell renderer used by both the single-domain and union views. When the
 * NDC has Multum reference data, the cell becomes a link-styled trigger that
 * opens the shared `NdcDetailPopover`. Without Multum data, falls back to
 * plain text — clicking would just show "not in Multum" anyway.
 *
 * `select-text` keeps the value drag-selectable so users can copy with ⌘+C
 * or right-click → Copy regardless of whether the link affordance fires.
 */
function ClickableNdc({
  ndc,
  isSelected,
  hasMultum,
}: {
  ndc: string
  isSelected: boolean
  hasMultum: boolean
}) {
  if (!ndc) return null
  if (!hasMultum) {
    return (
      <span
        className="select-text"
        title="Not in Multum — click does nothing"
      >
        {ndc}
      </span>
    )
  }
  return (
    <NdcDetailPopover ndc={ndc}>
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 font-mono tabular-nums select-text underline-offset-2 decoration-dotted hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0033AA] data-[state=open]:bg-[#E5EEF7] data-[state=open]:underline data-[state=open]:decoration-solid px-0.5 -mx-0.5 ${
          isSelected ? "text-white underline decoration-solid" : "text-[#0033AA]"
        }`}
        title="Click for Multum / DailyMed detail"
      >
        <span
          aria-hidden="true"
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            isSelected ? "bg-white" : "bg-[#0033AA]"
          }`}
        />
        {ndc}
      </button>
    </NdcDetailPopover>
  )
}

function charDiff(base: string, cmp: string): Array<{ text: string; diff: boolean }> {
  if (base === cmp) return [{ text: cmp, diff: false }]
  let p = 0
  while (p < base.length && p < cmp.length && base[p] === cmp[p]) p++
  let s = 0
  while (s < base.length - p && s < cmp.length - p && base[base.length - 1 - s] === cmp[cmp.length - 1 - s]) s++
  const result: Array<{ text: string; diff: boolean }> = []
  if (p > 0) result.push({ text: cmp.slice(0, p), diff: false })
  const mid = s > 0 ? cmp.slice(p, -s) : cmp.slice(p)
  if (mid) result.push({ text: mid, diff: true })
  if (s > 0) result.push({ text: cmp.slice(-s), diff: false })
  return result
}

// Expandable multi-domain view — one row per NDC, expandable when diffs exist
/** Strip hyphens from a 5-4-2 NDC ("12345-6789-01" → "12345678901"). Multum
 *  CCL queries against `mi.value in (...)` typically use the unhyphenated form. */
function stripDashes(ndc: string): string {
  return ndc.replace(/-/g, '')
}

/** Format a list of NDCs as `("ndc1", "ndc2", …)` — paste-ready for SQL/CCL
 *  IN clauses. Empty list produces `()` so the user can see something happened. */
function copyNdcsAsQuotedList(ndcs: readonly string[]): void {
  const body = ndcs.map(n => `"${n}"`).join(', ')
  copyToClipboard(`(${body})`)
}

function copyToClipboard(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => {
    // Clipboard can fail in non-secure contexts (HTTP non-localhost).
    // No silent-failure UI yet — keep simple; user will notice.
  })
}

interface MmdcGroup {
  mmdc: number
  ndcs: string[]
  label: string  // "bacitracin topical 500 units/g ointment" — best-effort identity
}

/** Group flexed NDCs by their Multum main_multum_drug_code so we can detect
 *  force-stacks (multiple distinct MMDCs flexed under one CDM = clinically
 *  different products merged in Cerner build). NDCs with no Multum data
 *  (`mmdc=null`) get bucketed under a synthetic "no MMDC" group so they're
 *  still visible. */
function computeMmdcGroups(
  ndcs: readonly string[],
  sources: ReturnType<typeof useNdcSources>,
): MmdcGroup[] {
  const byMmdc = new Map<number | null, { ndcs: string[]; label: string | null }>()
  for (const ndc of ndcs) {
    const summary = sources[ndc]
    const mmdc = summary?.mmdc ?? null
    const label = summary
      ? [summary.genericName, summary.strengthDescription, summary.doseFormDescription]
          .filter(Boolean)
          .join(' ')
      : null
    if (!byMmdc.has(mmdc)) byMmdc.set(mmdc, { ndcs: [], label: null })
    const entry = byMmdc.get(mmdc)!
    entry.ndcs.push(ndc)
    if (!entry.label && label) entry.label = label
  }
  // Drop the no-MMDC bucket only when EVERY ndc has no Multum data — in
  // that case the data is just absent (not a mismatch). Otherwise keep
  // it visible so users see "and these N have no Multum match" alongside
  // the real groups.
  const real = [...byMmdc.entries()]
    .filter(([k]) => k != null)
    .map(([k, v]) => ({ mmdc: k as number, ndcs: v.ndcs, label: v.label ?? `MMDC ${k}` }))
  if (real.length === 0) return []
  return real.sort((a, b) => b.ndcs.length - a.ndcs.length || a.mmdc - b.mmdc)
}

/** Force-stack warning above the supply table — fires when 2+ distinct
 *  Multum drug codes are flexed under the same CDM. Each group card shows
 *  the MMDC, its clinical identity, and the NDC list, with two actions
 *  designed for the split-the-product workflow:
 *    • Copy NDCs — quoted list ready to paste into a SQL/CCL IN clause
 *      or any input field that accepts comma-separated NDCs.
 *    • Alert facilities → opens /admin/ndc-move-alert with the group's
 *      NDCs pre-filled, so pharmacy can identify which facilities are
 *      using each clinical product before splitting them.
 *  Per-row chips in the MMDC column carry the same color so the banner
 *  and table stay visually linked. */
function MmdcMismatchBanner({ groups }: { groups: MmdcGroup[] }) {
  if (groups.length < 2) return null
  const summary = groups.map(g => `${g.ndcs.length} × MMDC ${g.mmdc}`).join(' · ')
  return (
    <details open className="border-y border-[#CC0000] bg-[#FFF0E0]">
      <summary className="cursor-pointer px-2 py-1 text-xs font-mono flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-[#CC0000]">
          ⚠ Force-stack — {groups.length} MMDCs in this CDM
        </span>
        <span className="text-[#404040]">{summary}</span>
      </summary>
      <div className="px-2 pb-2 space-y-1.5">
        <div className="text-[10px] text-[#606060]">
          Multum considers these clinically different products. To split:
          copy each group's NDCs and use the Alert button to find which
          facilities scan that specific group, then file a build ticket
          to move those NDCs to a new CDM.
        </div>
        {groups.map(g => (
          <MmdcGroupCard key={g.mmdc} group={g} />
        ))}
      </div>
    </details>
  )
}

function MmdcGroupCard({ group }: { group: MmdcGroup }) {
  const [copied, setCopied] = useState(false)
  const quoted = `(${group.ndcs.map(n => `"${n}"`).join(', ')})`
  const moveAlertHref = `/admin/ndc-move-alert?inputs=${encodeURIComponent(group.ndcs.join(','))}`
  return (
    <div className="border border-[#E0C0C0] bg-white p-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 leading-none"
          style={{ background: mmdcColor(group.mmdc), color: 'white' }}
        >
          MMDC {group.mmdc}
        </span>
        <span className="text-[11px] text-[#202020]">{group.label}</span>
        <span className="text-[10px] text-[#808080]">
          {group.ndcs.length} NDC{group.ndcs.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => {
              copyToClipboard(quoted)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-1.5 py-0.5 leading-none"
            title="Copy NDCs as a quoted, comma-separated list — paste into Discern/SQL or anywhere else."
          >
            {copied ? '✓ Copied' : 'Copy NDCs'}
          </button>
          <a
            href={moveAlertHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white px-1.5 py-0.5 leading-none no-underline"
            title="Open the NDC Move Alert page with this group's NDCs pre-filled — finds which facilities scan THIS specific clinical product."
          >
            Alert facilities →
          </a>
        </div>
      </div>
      <div className="text-[10px] mt-1 break-all text-[#404040] font-mono">
        {group.ndcs.join(', ')}
      </div>
    </div>
  )
}

/** Per-row chip showing the NDC's Multum main drug code, color-coded by
 *  the same stable per-MMDC palette as everywhere else. Tooltip carries
 *  the full clinical identity ("bacitracin topical zinc 500 units/g
 *  ointment"). Falls back to a grey "—" for NDCs without a Multum match. */
function MmdcChip({
  summary, selected,
}: { summary: NdcSourcesSummary | undefined; selected: boolean }) {
  const mmdc = summary?.mmdc ?? null
  if (mmdc == null) {
    return (
      <span
        className="text-[10px] font-mono text-[#A0A0A0]"
        title="No Multum main drug code on file — either not in Multum or not yet loaded."
      >
        —
      </span>
    )
  }
  const label = [summary?.genericName, summary?.strengthDescription, summary?.doseFormDescription]
    .filter(Boolean)
    .join(' ')
  return (
    <span
      className="text-[10px] font-mono font-bold px-1 leading-none inline-block"
      style={{
        background: selected ? 'white' : mmdcColor(mmdc),
        color: selected ? mmdcColor(mmdc) : 'white',
      }}
      title={label || `MMDC ${mmdc}`}
    >
      {mmdc}
    </span>
  )
}

/** Stable per-MMDC color for visual grouping. Uses the integer code mod a
 *  small palette of accessible colors so the same MMDC always gets the
 *  same swatch within a session. */
function mmdcColor(mmdc: number): string {
  const palette = ['#0F8C5C', '#A66B00', '#0050A0', '#7A2A8A', '#A02C2C', '#3F6F00']
  return palette[Math.abs(mmdc) % palette.length]
}

function SupplyUnionView({ domainRecords, onCreateTask }: { domainRecords: DomainRecord[]; onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void }) {
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)
  const [expandedNdcs, setExpandedNdcs] = useState<Set<string>>(new Set())

  const loadedDomains = domainRecords.filter(dr => dr.item !== null)

  // Collect union of all NDCs across all domains
  const ndcMap = new Map<string, Map<string, SupplyRecord>>()
  for (const dr of loadedDomains) {
    for (const rec of dr.item!.supplyRecords) {
      if (!ndcMap.has(rec.ndc)) ndcMap.set(rec.ndc, new Map())
      ndcMap.get(rec.ndc)!.set(dr.domain, rec)
    }
  }

  // An NDC is treated as "primary" if any loaded domain has its record
  // marked isPrimary — pins the assigned primary to the top regardless of
  // domain coverage or NDC string ordering.
  const isPrimaryNdc = (ndc: string) =>
    [...(ndcMap.get(ndc)?.values() ?? [])].some(r => r.isPrimary)

  // Sort: primary first, then NDCs present in all domains, then by NDC string
  const allNdcs = [...ndcMap.keys()].sort((a, b) => {
    const aP = isPrimaryNdc(a), bP = isPrimaryNdc(b)
    if (aP !== bP) return aP ? -1 : 1
    const aAll = loadedDomains.every(dr => ndcMap.get(a)?.has(dr.domain))
    const bAll = loadedDomains.every(dr => ndcMap.get(b)?.has(dr.domain))
    if (aAll !== bAll) return aAll ? -1 : 1
    return a.localeCompare(b)
  })

  const getNdcDiff = (ndc: string) => {
    const domainData = ndcMap.get(ndc)!
    const presentIn = loadedDomains.filter(dr => domainData.has(dr.domain))
    if (loadedDomains.some(dr => !domainData.has(dr.domain))) return true
    if (presentIn.length > 1 && new Set(presentIn.map(dr => domainData.get(dr.domain)!.isActive)).size > 1) return true
    if (presentIn.length > 1 && new Set(presentIn.map(dr => domainData.get(dr.domain)!.manufacturerLabelDescription)).size > 1) return true
    return false
  }

  const toggleExpand = (ndc: string) => {
    setExpandedNdcs(prev => {
      const next = new Set(prev)
      next.has(ndc) ? next.delete(ndc) : next.add(ndc)
      return next
    })
  }

  const diffCount = allNdcs.filter(getNdcDiff).length
  const sources = useNdcSources(allNdcs)

  // Stewardship mode: filter to NDCs whose prod-region coverage is partial.
  // "Partial" is measured against the prod regions where the product
  // *exists* (not an absolute W/C/E) — an east-only product can still be
  // fully stacked with one segment lit.
  const [gapsOnly, setGapsOnly] = useState(false)
  const prodRegionsLoaded = loadedDomains
    .filter((dr) => dr.domain.endsWith("_prod"))
    .map((dr) => dr.domain.split("_")[0])
  const isPartialStack = (ndc: string): boolean => {
    if (prodRegionsLoaded.length < 2) return false
    const data = ndcMap.get(ndc)
    if (!data) return false
    const present = prodRegionsLoaded.filter((reg) =>
      data.has(`${reg}_prod`),
    ).length
    return present > 0 && present < prodRegionsLoaded.length
  }
  const partialCount = allNdcs.filter(isPartialStack).length
  const visibleNdcs = gapsOnly ? allNdcs.filter(isPartialStack) : allNdcs
  const canShowGapsControls = prodRegionsLoaded.length >= 2

  // MMDC mismatch detection — group flexed NDCs by their Multum main drug
  // code. When >1 distinct MMDC is present, this CDM contains a force-stack
  // (NDCs that are clinically different products merged under one Cerner
  // build). Surface as a warning AND a per-row MMDC column so pharmacy
  // can immediately see which clinical product each NDC belongs to.
  const mmdcGroups = computeMmdcGroups(allNdcs, sources)
  const mmdcMismatch = mmdcGroups.length >= 2

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {canShowGapsControls && (
        <div className="flex items-center justify-between gap-3 px-2 py-1 border-b border-[#808080] bg-[#D4D0C8]">
          <label
            className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
            title="Show only NDCs whose prod-region coverage isn't uniform — useful for stewardship work."
          >
            <Checkbox
              checked={gapsOnly}
              onCheckedChange={(c) => setGapsOnly(!!c)}
              className="rounded-none border-[#808080] h-3 w-3"
            />
            Gaps only
          </label>
          <span className="text-[#606060] text-[11px]">
            {partialCount} of {allNdcs.length} partially stacked
            {prodRegionsLoaded.length < 3 && (
              <span className="text-[#808080] italic">
                {" "}
                · {prodRegionsLoaded.length} of 3 prod regions loaded
              </span>
            )}
          </span>
        </div>
      )}
      <MmdcMismatchBanner groups={mmdcGroups} />
      <div className="flex-1 overflow-auto border border-[#808080]">
        <Table className="text-xs font-mono border-collapse w-full min-w-max">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-6" />
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">Act</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">1*</TableHead>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <TableHead
                    className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-36 cursor-context-menu"
                    title="Right-click for export options"
                  >
                    NDC
                  </TableHead>
                </ContextMenuTrigger>
                <ContextMenuContent
                  className="font-mono text-xs z-[9999]"
                  collisionPadding={16}
                >
                  <ContextMenuItem
                    onSelect={() => copyNdcsAsQuotedList(visibleNdcs)}
                    title='("ndc1", "ndc2", …) — drop into a Discern Explorer IN clause'
                  >
                    Copy as quoted list (hyphenated)
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => copyNdcsAsQuotedList(visibleNdcs.map(stripDashes))}
                    title='("ndc1nodashes", …) — for Multum CCL where mi.value uses 11-digit form'
                  >
                    Copy as quoted list (no dashes)
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => copyToClipboard(visibleNdcs.join(', '))}>
                    Copy as plain CSV
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyToClipboard(visibleNdcs.join('\n'))}>
                    Copy one-per-line
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {mmdcMismatch && (
                <TableHead
                  className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20 text-center"
                  title="Multum main drug code — surfaced when NDCs under this CDM resolve to multiple clinical products (force-stack)"
                >
                  MMDC
                </TableHead>
              )}
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16" title="Stacked in West / Central / East prod">WCE</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-20" title="Multum / DailyMed / Orange Book">Sources</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-40">Pill ID</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080]">Manufacturer / Description</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-8">B/G</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground w-20">AWP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleNdcs.map((ndc, idx) => {
              const domainData = ndcMap.get(ndc)!
              const isDiff = getNdcDiff(ndc)
              const isExpanded = expandedNdcs.has(ndc)
              const isSelected = selectedNdc === ndc

              // Base record: first domain that has this NDC
              const baseEntry = loadedDomains.find(dr => domainData.has(dr.domain))!
              const baseRec = domainData.get(baseEntry.domain)!
              const baseDesc = baseRec.manufacturerLabelDescription || baseRec.manufacturer
              // "All-domains inactive" — every loaded domain that has this
              // NDC reports isActive=false. Mixed (some active, some not)
              // is already covered by the isDiff yellow highlight; we don't
              // want to bury that signal under the strikethrough.
              const isAllInactive =
                !isDiff &&
                [...domainData.values()].every(r => !r.isActive)

              return [
                <TableRow
                  key={ndc}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? 'bg-[#316AC5] text-white'
                      : isDiff
                      ? 'bg-[#FFF3CD] hover:bg-[#FFE88A]'
                      : isAllInactive
                      ? 'bg-[#E8E8E8] text-[#9C9C9C] line-through hover:bg-[#DCDCDC]'
                      : idx % 2 === 0
                      ? 'bg-white hover:bg-[#C7D5E8]'
                      : 'bg-[#F0F0F0] hover:bg-[#C7D5E8]'
                  }`}
                  onClick={() => setSelectedNdc(ndc === selectedNdc ? null : ndc)}
                >
                  <TableCell className="h-5 px-0.5 py-0 border-r border-[#D4D0C8] text-center">
                    {isDiff && (
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); toggleExpand(ndc) }}
                          className={`w-4 h-4 text-[10px] font-bold leading-none flex items-center justify-center border rounded-none
                            ${isSelected
                              ? 'border-white text-white hover:bg-white/20'
                              : 'border-[#808080] bg-[#D4D0C8] text-[#316AC5] hover:bg-[#C0BBB0]'
                            }`}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                        {onCreateTask && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const domainValues: DomainValue[] = loadedDomains.map(dr => {
                                const rec = domainData.get(dr.domain)
                                return {
                                  domain: dr.domain,
                                  badge: dr.badge,
                                  bg: dr.bg,
                                  text: dr.text,
                                  value: rec ? (rec.manufacturerLabelDescription || rec.manufacturer || '') : '',
                                }
                              })
                              onCreateTask(`supply.${ndc}`, `NDC ${ndc}`, domainValues)
                            }}
                            className="text-[8px] font-mono h-4 px-0.5 leading-none border rounded-none bg-[#1a4a9a] text-white hover:bg-[#0e3070] border-[#0e3070] whitespace-nowrap"
                            title={`Create task for NDC ${ndc}`}
                          >
                            ⚑
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={baseRec.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={baseRec.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono">
                    <ClickableNdc
                      ndc={ndc}
                      isSelected={isSelected}
                      hasMultum={!!sources[ndc]?.inMultum}
                    />
                  </TableCell>
                  {mmdcMismatch && (
                    <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                      <MmdcChip summary={sources[ndc]} selected={isSelected} />
                    </TableCell>
                  )}
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    <NdcDomainCoverage ndc={ndc} domainRecords={domainRecords} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                    <NdcSourceBadges summary={sources[ndc]} selected={isSelected} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] truncate max-w-[160px]">
                    <NdcPillIdInline summary={sources[ndc]} selected={isSelected} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] truncate max-w-[280px]">{baseDesc}</TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">{baseRec.isBrand ? 'B' : 'G'}</TableCell>
                  <TableCell className="h-5 px-2 py-0">{baseRec.awpCost != null ? `$${baseRec.awpCost.toFixed(4)}` : ''}</TableCell>
                </TableRow>,

                // Expanded per-domain rows
                ...(isExpanded ? loadedDomains.map(dr => {
                  const rec = domainData.get(dr.domain)
                  const desc = rec ? (rec.manufacturerLabelDescription || rec.manufacturer) : null
                  const segments = rec && desc !== baseDesc ? charDiff(baseDesc, desc!) : null
                  return (
                    <TableRow
                      key={`${ndc}-${dr.domain}`}
                      className="border-b border-[#E8E8E0] bg-[#FAFAF8]"
                      style={{ borderLeft: `3px solid ${dr.bg}` }}
                    >
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]" />
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                        {rec && <Checkbox checked={rec.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />}
                      </TableCell>
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                        {rec && <Checkbox checked={rec.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />}
                      </TableCell>
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded-none leading-none" style={{ background: dr.bg, color: dr.text }}>
                          {dr.badge}
                        </span>
                      </TableCell>
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono" colSpan={mmdcMismatch ? 7 : 6}>
                        {rec
                          ? segments
                            ? segments.map((seg, j) =>
                                seg.diff
                                  ? <mark key={j} className="bg-amber-300 text-black not-italic">{seg.text}</mark>
                                  : <span key={j}>{seg.text}</span>
                              )
                            : desc
                          : <span className="text-[#808080] italic text-[9px]">not present</span>
                        }
                      </TableCell>
                    </TableRow>
                  )
                }) : [])
              ]
            })}
            {visibleNdcs.length === 0 && (
              <TableRow>
                <TableCell colSpan={mmdcMismatch ? 11 : 10} className="text-center py-4 text-[#808080]">
                  {allNdcs.length === 0
                    ? "No supply records"
                    : "All NDCs are fully stacked across loaded prod regions."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 p-2 bg-[#D4D0C8] border-t border-[#808080] shrink-0">
        <span className="text-[10px] text-[#808080] self-center">
          {allNdcs.length} NDC{allNdcs.length !== 1 ? 's' : ''} total
          {diffCount > 0 && ` · ${diffCount} differ`}
        </span>
      </div>
    </div>
  )
}

export function SupplyTab({ item, highlightedFields, domainRecords, onCreateTask }: SupplyTabProps) {
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)

  // Use union view when 2+ domains have data
  const loadedDomains = domainRecords?.filter(dr => dr.item !== null) ?? []
  const useUnionView = !!(domainRecords && loadedDomains.length >= 2)

  // Single-domain view data (computed unconditionally so the hook list below
  // stays stable when `useUnionView` flips — see Rules of Hooks).
  // Primary-first sort: pins the assigned primary to the top regardless of
  // the order it sits in supply_records. Stable for the rest, so the
  // remaining NDCs preserve their on-disk order.
  const supplyData = useMemo(() => {
    const rows = item?.supplyRecords ?? []
    return [...rows].sort((a, b) =>
      a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1,
    )
  }, [item?.supplyRecords])
  const ndcSetHighlighted = highlightedFields?.has('ndcSet') ?? false

  // Batched per-NDC source lookup. Skipped (empty list) when delegating to
  // SupplyUnionView — it has its own useNdcSources for its (different) NDC
  // set, so fetching here would be wasted. Empty NDC strings are filtered
  // out — they can sneak in via supply_records rows with default-empty ndc.
  const allNdcs = useMemo(
    () => useUnionView ? [] : supplyData.map((r) => r.ndc).filter((n) => !!n),
    [supplyData, useUnionView],
  )
  const sources = useNdcSources(allNdcs)

  if (useUnionView) {
    return <SupplyUnionView domainRecords={domainRecords!} onCreateTask={onCreateTask} />
  }

  const mmdcGroups = computeMmdcGroups(allNdcs, sources)
  const mmdcMismatch = mmdcGroups.length >= 2

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {ndcSetHighlighted && (
        <div className="px-2 py-1 bg-[#FFF3CD] border-b border-amber-400 text-xs font-mono text-amber-800">
          ⚠ NDC set differs across domains
        </div>
      )}
      <MmdcMismatchBanner groups={mmdcGroups} />
      <div className="flex-1 overflow-auto border border-[#808080]">
        <Table className="text-xs font-mono border-collapse w-full min-w-max">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8"></TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">1*</TableHead>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <TableHead
                    className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-32 cursor-context-menu"
                    title="Right-click for export options"
                  >
                    Drug ID
                  </TableHead>
                </ContextMenuTrigger>
                <ContextMenuContent
                  className="font-mono text-xs z-[9999]"
                  collisionPadding={16}
                >
                  <ContextMenuItem
                    onSelect={() => copyNdcsAsQuotedList(allNdcs)}
                    title='("ndc1", "ndc2", …) — drop into a Discern Explorer IN clause'
                  >
                    Copy as quoted list (hyphenated)
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => copyNdcsAsQuotedList(allNdcs.map(stripDashes))}
                    title='("ndc1nodashes", …) — for Multum CCL where mi.value uses 11-digit form'
                  >
                    Copy as quoted list (no dashes)
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => copyToClipboard(allNdcs.join(', '))}>
                    Copy as plain CSV
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyToClipboard(allNdcs.join('\n'))}>
                    Copy one-per-line
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {mmdcMismatch && (
                <TableHead
                  className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20 text-center"
                  title="Multum main drug code — surfaced when NDCs under this CDM resolve to multiple clinical products (force-stack)"
                >
                  MMDC
                </TableHead>
              )}
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16" title="Stacked in West / Central / East prod">WCE</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20" title="Multum / DailyMed / Orange Book">Sources</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-40">Pill ID</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-24">Inner NDC</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-12">Active</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-44">Manufacturer</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-44">Description</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20">Package</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">BIO</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">B/G</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20">AWP</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16">Cost1</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16">Cost2</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground w-16">Lot Info</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplyData.map((row, idx) => {
              const isSelected = selectedNdc === row.ndc
              const summary = row.ndc ? sources[row.ndc] : undefined
              const isInactive = !row.isActive
              return (
                <TableRow
                  key={`${row.ndc}-${idx}`}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? "bg-[#316AC5] text-white"
                      : isInactive
                      ? "bg-[#E8E8E8] text-[#9C9C9C] line-through hover:bg-[#DCDCDC]"
                      : idx % 2 === 0
                      ? "bg-white hover:bg-[#C7D5E8]"
                      : "bg-[#F0F0F0] hover:bg-[#C7D5E8]"
                  }`}
                  onClick={() => setSelectedNdc(row.ndc)}
                >
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">{idx + 1}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={row.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] font-mono">
                    <ClickableNdc ndc={row.ndc} isSelected={isSelected} hasMultum={!!summary?.inMultum} />
                  </TableCell>
                  {mmdcMismatch && (
                    <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                      <MmdcChip summary={summary} selected={isSelected} />
                    </TableCell>
                  )}
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.ndc && <NdcDomainCoverage ndc={row.ndc} domainRecords={domainRecords} />}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    <NdcSourceBadges summary={summary} selected={isSelected} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[160px]">
                    <NdcPillIdInline summary={summary} selected={isSelected} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.isNonReference ? row.ndc : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={row.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.manufacturer}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.manufacturerLabelDescription}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]"></TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    {row.isBiological && <Checkbox checked className="rounded-none border-[#808080] h-3 w-3" />}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.isBrand ? "B" : "G"}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.awpCost != null ? `$${row.awpCost.toFixed(4)}` : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost1 != null ? String(row.cost1) : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost2 != null ? String(row.cost2) : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0">
                    <div className="flex items-center justify-center">
                      <div className="grid grid-cols-3 gap-px w-6 h-5 border border-[#808080] cursor-pointer hover:bg-[#C7D5E8]">
                        {[...Array(9)].map((_, i) => <div key={i} className="bg-[#808080] w-1 h-1" />)}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 p-2 bg-[#D4D0C8] border-t border-[#808080]">
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Move Up</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Move Down</Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Group</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">New</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Properties</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Item Build</Button>
      </div>
    </div>
  )
}
