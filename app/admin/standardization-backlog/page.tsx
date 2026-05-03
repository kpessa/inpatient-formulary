"use client"

import { useEffect, useMemo, useState } from "react"
import { DomainCoveragePill } from "@/components/formulary/DomainCoveragePill"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import { CategoryJumpBar } from "@/components/admin/CategoryJumpBar"
import { CopyableValue } from "@/components/admin/CopyableValue"

// Dispatch a 'pharmnet:load-drug' custom event that the main desktop
// (app/page.tsx) listens for. The bridge there:
//   1. Looks up the drug by CDM, loads it into Formulary Manager
//   2. Minimizes this admin window so the formulary comes to front
//   3. Falls back to opening Product Search pre-filled if no CDM match
function openInFormulary(query: string) {
  if (!query) return
  window.dispatchEvent(new CustomEvent('pharmnet:load-drug', {
    detail: { value: query, source: 'standardization-backlog' },
  }))
}

// Standardization Backlog (architect+) — derived view from the latest extract
// run. Lists drugs whose prod coverage is partial, so admins can prioritize
// the work of finishing the build across all 3 prod regions.
//
// MVP is a snapshot of the LATEST run only. A persistent cross-run backlog
// (where items get marked "done" once they reach 3/3) is a follow-up — see
// project_extract_changeset_viewer.md memory entry for the roadmap.

interface BacklogRow {
  drug_key: string
  description: string
  charge_number: string
  pyxis_id: string
  generic_name: string
  strength: string
  strength_unit: string
  dosage_form: string
  group_ids: string[]
  prod_regions_built: string[]
  cert_regions_built: string[]
  prod_facility_count: number
  total_domain_count: number
  is_onboarding_related: boolean
  is_reference: boolean
  ref_ndc_count: number
  supply_count: number
  categories: { id: string; name: string; color: string }[]
}

interface ApiResponse {
  run_id: string | null
  rows: BacklogRow[]
}

type SortKey =
  | 'reference_first'
  | 'facility_count_desc'
  | 'fewest_prod_first'
  | 'description'
  | 'pyxis_id'
  | 'cdm'
  | 'onboarding_first'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'reference_first',     label: 'Reference-only first (easiest backfill)' },
  { key: 'facility_count_desc', label: 'Most facilities flexed (highest impact)' },
  { key: 'fewest_prod_first',   label: 'Fewest prod regions (most needs work)' },
  { key: 'onboarding_first',    label: 'Onboarding-related first' },
  { key: 'description',         label: 'Description (A → Z)' },
  { key: 'pyxis_id',            label: 'Pyxis ID' },
  { key: 'cdm',                 label: 'CDM (charge number)' },
]

function compareRows(a: BacklogRow, b: BacklogRow, key: SortKey): number {
  switch (key) {
    case 'reference_first':
      // Reference drugs first (true=1), tie-break by impact (facility count
      // desc) then description.
      return (Number(b.is_reference) - Number(a.is_reference))
          || (b.prod_facility_count - a.prod_facility_count)
          || a.description.localeCompare(b.description)
    case 'facility_count_desc':
      return (b.prod_facility_count - a.prod_facility_count)
          || a.description.localeCompare(b.description)
    case 'fewest_prod_first':
      return (a.prod_regions_built.length - b.prod_regions_built.length)
          || (b.prod_facility_count - a.prod_facility_count)
          || a.description.localeCompare(b.description)
    case 'onboarding_first':
      return (Number(b.is_onboarding_related) - Number(a.is_onboarding_related))
          || (b.prod_facility_count - a.prod_facility_count)
          || a.description.localeCompare(b.description)
    case 'description':
      return a.description.localeCompare(b.description)
    case 'pyxis_id':
      return a.pyxis_id.localeCompare(b.pyxis_id, undefined, { numeric: true })
          || a.description.localeCompare(b.description)
    case 'cdm':
      return a.charge_number.localeCompare(b.charge_number, undefined, { numeric: true })
          || a.description.localeCompare(b.description)
  }
}

// Inner component — pure content, no chrome. Both the Next route below and
// the floating-desktop-window flavor (components/admin/StandardizationBacklogWindow)
// render this directly.
export function StandardizationBacklogContent() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('reference_first')
  const [searchQ, setSearchQ] = useState('')
  const [onlyOnboarding, setOnlyOnboarding] = useState(false)
  // 'all' = both, 'ref' = reference only (low-hanging fruit for backfill),
  // 'custom' = non-reference only (the slower custom builds).
  const [refFilter, setRefFilter] = useState<'all' | 'ref' | 'custom'>('all')
  // 'grouped' (default): drug list is bucketed into one section per category;
  //   drugs in N categories show up in N sections (left-join semantics).
  //   Drugs with no matching category fall into an "Uncategorized" catch-all
  //   at the bottom.
  // 'flat': single sorted table, same as the prior default view. Still useful
  //   for cross-category sorting (e.g. "highest impact regardless of category").
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped')
  // Per-section expanded state. Default: all sections collapsed (just headers
  // visible, click to expand). Jump bar at the top can scroll-and-open any
  // section. Expand-all / Collapse-all links toggle every section at once.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/standardization-backlog')
      .then(async r => {
        if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<ApiResponse>
      })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    if (!data) return [] as BacklogRow[]
    const q = searchQ.trim().toLowerCase()
    const filtered = data.rows.filter(r => {
      if (onlyOnboarding && !r.is_onboarding_related) return false
      if (refFilter === 'ref' && !r.is_reference) return false
      if (refFilter === 'custom' && r.is_reference) return false
      if (q) {
        const hay = `${r.description} ${r.charge_number} ${r.pyxis_id} ${r.generic_name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return filtered.sort((a, b) => compareRows(a, b, sortKey))
  }, [data, sortKey, searchQ, onlyOnboarding, refFilter])

  // Group rows into sections — one per category that has any drugs, plus an
  // "Uncategorized" catch-all section at the bottom for drugs that match no
  // category. Drugs in N categories appear in N sections (left-join). Sort
  // order within each section follows the global sortKey.
  type Section = { id: string; name: string; color: string; description: string; rows: BacklogRow[] }
  const sections = useMemo<Section[]>(() => {
    const all = new Map<string, Section>()
    const uncategorized: BacklogRow[] = []
    for (const r of rows) {
      if (r.categories.length === 0) {
        uncategorized.push(r)
        continue
      }
      for (const c of r.categories) {
        let s = all.get(c.id)
        if (!s) { s = { id: c.id, name: c.name, color: c.color, description: '', rows: [] }; all.set(c.id, s) }
        s.rows.push(r)
      }
    }
    const ordered = [...all.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name))
    if (uncategorized.length > 0) {
      ordered.push({ id: '__uncategorized__', name: 'Uncategorized', color: '#808080', description: 'No matching category — review and add to one if it fits a known build pattern.', rows: uncategorized })
    }
    return ordered
  }, [rows])

  const categoryCounts = useMemo(() => {
    const m = new Map<string, { name: string; color: string; count: number }>()
    for (const r of data?.rows ?? []) {
      for (const c of r.categories) {
        const e = m.get(c.id)
        if (e) e.count++
        else m.set(c.id, { name: c.name, color: c.color, count: 1 })
      }
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [data])

  const refCounts = useMemo(() => {
    const ref    = data?.rows.filter(r => r.is_reference).length ?? 0
    const custom = data?.rows.filter(r => !r.is_reference).length ?? 0
    return { ref, custom }
  }, [data])

  return (
    <>
      {loading && <div className="text-[#444]">Loading…</div>}
      {error && (
        <div className="border border-[#990000] bg-[#FCE4E4] p-2 text-[11px] text-[#660000]">
          Failed to load: {error}
        </div>
      )}
      {!loading && data && !data.run_id && (
        <div className="border border-[#808080] bg-white p-3 text-[11px]">
          <div className="font-semibold mb-1">No extract runs recorded yet.</div>
          <div className="text-[#444]">
            The next deploy via <code className="bg-[#F0F0F0] px-1">scripts/deploy-db.sh</code> will populate this view.
          </div>
        </div>
      )}

      {!loading && data?.run_id && (
        <>
          {/* Header */}
          <div className="border border-[#808080] bg-white p-2 mb-2 text-[11px]"
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <div className="flex flex-wrap items-baseline gap-x-4">
              <div><span className="text-[#666]">Latest run:</span> <span className="font-mono font-semibold">{data.run_id}</span></div>
              <div><span className="text-[#666]">Partial-build drugs:</span> <span className="font-semibold">{data.rows.length.toLocaleString()}</span></div>
              <div className="text-[11px]">
                <span className="text-[#666]">Type split:</span>{' '}
                <span style={{ color: '#0B6E27' }}><strong>{refCounts.ref}</strong> 📚 ref</span>
                <span className="text-[#999] mx-1">·</span>
                <span style={{ color: '#666' }}><strong>{refCounts.custom}</strong> ✎ custom</span>
              </div>
              <div className="text-[10px] text-[#666] italic w-full mt-1">
                Drugs with a new_build event in this extract whose prod coverage is incomplete.
                Reference drugs are quick wins (Multum data ready); custom builds (half-tabs,
                neonatal syringes, ADC oral liquids, one-liner Pyxis-storage products) require
                manual setup.
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="border border-[#808080] bg-white p-2 mb-2 flex flex-wrap items-center gap-3"
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <label className="flex items-center gap-1 text-[11px]">
              <span className="font-semibold">Sort by:</span>
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
                style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
              >
                {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              <input
                type="checkbox"
                checked={onlyOnboarding}
                onChange={e => setOnlyOnboarding(e.target.checked)}
              />
              <span>Only onboarding-related</span>
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              <span className="font-semibold">Reference:</span>
              <select
                value={refFilter}
                onChange={e => setRefFilter(e.target.value as 'all' | 'ref' | 'custom')}
                className="font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
                style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
                title="Reference drugs (Multum NDC match) are quick wins for backfill; custom builds (half-tabs, neonatal syringes, ADC oral liquids, etc.) are slower."
              >
                <option value="all">All ({refCounts.ref + refCounts.custom})</option>
                <option value="ref">📚 Reference only ({refCounts.ref})</option>
                <option value="custom">✎ Custom only ({refCounts.custom})</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px]">
              <span className="font-semibold">View:</span>
              <select
                value={viewMode}
                onChange={e => setViewMode(e.target.value as 'grouped' | 'flat')}
                className="font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
                style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
                title="Grouped: one section per category, drugs in N categories appear in N sections. Flat: single sorted table across all categories."
              >
                <option value="grouped">Group by category</option>
                <option value="flat">Flat list</option>
              </select>
            </label>
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Search by description, CDM, Pyxis, or generic name…"
              className="flex-1 min-w-[200px] font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
              style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
            />
            <span className="text-[10px] text-[#666]">
              Showing {rows.length.toLocaleString()} of {data.rows.length.toLocaleString()}
            </span>
          </div>

          {/* Drug listing — grouped by category (default) or flat table */}
          {viewMode === 'grouped' ? (
            <>
              {sections.length > 0 && (
                <CategoryJumpBar
                  sections={sections.map(s => ({ id: s.id, name: s.name, color: s.color, count: s.rows.length }))}
                  expanded={expandedSections}
                  onJump={(id) => {
                    setExpandedSections(prev => new Set(prev).add(id))
                    requestAnimationFrame(() => {
                      document.getElementById(`backlog-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    })
                  }}
                  onExpandAll={() => setExpandedSections(new Set(sections.map(s => s.id)))}
                  onCollapseAll={() => setExpandedSections(new Set())}
                />
              )}
              <div className="space-y-2">
                {sections.map(s => {
                  const open = expandedSections.has(s.id)
                  return (
                    <div key={s.id} id={`backlog-section-${s.id}`} className="border-2 bg-white"
                         style={{ borderColor: s.color, scrollMarginTop: 8 }}>
                      <button
                        onClick={() => setExpandedSections(prev => {
                          const n = new Set(prev)
                          if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                          return n
                        })}
                        className="w-full flex items-baseline justify-between px-2 py-1 text-left"
                        style={{ backgroundColor: s.color, color: 'white' }}
                      >
                        <div>
                          <span className="font-semibold text-[12px]">{open ? '−' : '+'} {s.name}</span>
                          <span className="text-[10px] ml-2 opacity-90">({s.rows.length} drug{s.rows.length === 1 ? '' : 's'})</span>
                        </div>
                      </button>
                      {open && s.description && (
                        <div className="px-2 py-1 text-[10px] text-[#444] italic border-b border-[#C0C0C0]">{s.description}</div>
                      )}
                      {open && <BacklogTable rows={s.rows} />}
                    </div>
                  )
                })}
                {sections.length === 0 && (
                  <div className="border border-[#808080] bg-white p-4 text-center text-[#666] italic text-[11px]">
                    {searchQ || onlyOnboarding || refFilter !== 'all'
                      ? 'No drugs match the active filter.'
                      : 'No partial-build drugs in this run — formulary is fully standardized 🎉'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="border border-[#808080] bg-white"
                 style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
              <BacklogTable rows={rows} />
              {rows.length === 0 && (
                <div className="text-center text-[#666] italic p-4 text-[11px]">
                  {searchQ || onlyOnboarding || refFilter !== 'all'
                    ? 'No drugs match the active filter.'
                    : 'No partial-build drugs in this run — formulary is fully standardized 🎉'}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}

// Default export = Next.js route. Wraps the reusable content in
// AdminWindowFrame for direct-URL access. The desktop-window flavor renders
// StandardizationBacklogContent inside a DesktopWindow instead.
export default function StandardizationBacklogPage() {
  return (
    <AdminWindowFrame icon="🛠️" title="Standardization Backlog" subtitle="(architect+)">
      <StandardizationBacklogContent />
    </AdminWindowFrame>
  )
}

// ── Reusable backlog table ─────────────────────────────────────────────────
// Same row layout in both grouped sections and the flat view; extracted so
// the markup isn't duplicated 80 lines apart.
function BacklogTable({ rows }: { rows: BacklogRow[] }) {
  if (rows.length === 0) return null
  return (
    <table className="w-full font-mono text-[11px]">
      <thead className="bg-[#D4D0C8] text-[#222]">
        <tr>
          <th className="text-left px-2 py-1 border-b border-[#808080] w-[110px]">CDM</th>
          <th className="text-left px-2 py-1 border-b border-[#808080] w-[80px]">Pyxis</th>
          <th className="text-left px-2 py-1 border-b border-[#808080]">Description</th>
          <th className="text-left px-2 py-1 border-b border-[#808080] w-[80px]">Prod</th>
          <th className="text-right px-2 py-1 border-b border-[#808080] w-[110px]" title="Distinct facilities the drug is currently active at across prod">Facilities</th>
          <th className="text-left px-2 py-1 border-b border-[#808080] w-[80px]" title="Reference (Multum NDC match) = quick win for backfill. Custom = manual build.">Type</th>
          <th className="text-left px-2 py-1 border-b border-[#808080] w-[100px]">Origin</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr
            key={r.drug_key}
            onDoubleClick={() => openInFormulary(r.charge_number || r.description)}
            className="hover:bg-[#FCFCFC] border-b border-dotted border-[#C0C0C0] cursor-pointer"
            title="Double-click to open in Product Search"
          >
            <td className="px-2 py-1.5">
              <CopyableValue value={r.charge_number} />
            </td>
            <td className="px-2 py-1.5">
              <CopyableValue value={r.pyxis_id} />
            </td>
            <td className="px-2 py-1.5">
              <div className="font-semibold">{r.description || '(no description)'}</div>
              {r.generic_name && r.generic_name !== r.description && (
                <div className="text-[10px] text-[#666]">{r.generic_name}</div>
              )}
              {r.categories.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {r.categories.map(c => (
                    <span
                      key={c.id}
                      className="inline-block px-1 py-px text-[9px] border align-middle"
                      style={{ backgroundColor: c.color + '22', color: c.color, borderColor: c.color }}
                      title={`Category: ${c.name}`}
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td className="px-2 py-1.5">
              <DomainCoveragePill litRegions={new Set(r.prod_regions_built)} emptyTitle="not yet built" />
            </td>
            <td className="px-2 py-1.5 text-right">
              <span className="font-bold">{r.prod_facility_count.toLocaleString()}</span>
            </td>
            <td className="px-2 py-1.5">
              {r.is_reference ? (
                <span className="inline-block px-1.5 py-px text-[10px] border"
                      style={{ backgroundColor: '#E4F5E4', color: '#0B6E27', borderColor: '#0B6E27' }}
                      title={`${r.ref_ndc_count} of ${r.supply_count} supply NDC${r.supply_count === 1 ? '' : 's'} match Multum reference. Faster to backfill.`}>
                  📚 ref
                </span>
              ) : (
                <span className="inline-block px-1.5 py-px text-[10px] border"
                      style={{ backgroundColor: '#F0F0F0', color: '#666', borderColor: '#808080' }}
                      title={`No supply NDC matches Multum. Custom build (half-tab / neonatal syringe / one-liner / ADC oral liquid / etc).`}>
                  ✎ custom
                </span>
              )}
            </td>
            <td className="px-2 py-1.5">
              {r.is_onboarding_related ? (
                <span className="inline-block px-1.5 py-px text-[10px] border"
                      style={{ backgroundColor: '#DCEAF7', color: '#1E5391', borderColor: '#1E5391' }}
                      title="This new build came along with a facility onboarding (likely a go-live deliverable).">
                  🏥 go-live
                </span>
              ) : (
                <span className="text-[#666]">Cerner push</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
