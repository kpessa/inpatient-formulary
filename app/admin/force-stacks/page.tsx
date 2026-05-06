"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import type { ForceStackRow } from "@/app/api/admin/force-stacks/route"

/**
 * Force-stack worklist — `/admin/force-stacks`.
 *
 * Lists every CDM where the flexed NDCs span ≥2 distinct Multum main
 * drug codes. Architects use this to find products that need to be
 * split into separate CDMs because they merge clinically different
 * drugs (e.g. bacitracin + bacitracin zinc under one CDM).
 *
 * Each row pivots into:
 *   • Open in Formulary Manager — fires the existing pharmnet:load-drug
 *     event (same hand-off pattern as Standardization Backlog).
 *   • Alert facilities → opens NDC Move Alert in a new tab pre-filled
 *     with NDCs from the largest MMDC group (the most likely "wrong"
 *     stack — but the user can switch groups in the alert page).
 *
 * Filters are client-side: search, min-MMDC count, region. The list is
 * small enough (typically <500 rows even on a busy build) that fetching
 * everything once and filtering in-browser is faster than paginated
 * server queries.
 */

function openInFormulary(query: string) {
  if (!query) return
  window.dispatchEvent(new CustomEvent('pharmnet:load-drug', {
    detail: { value: query, source: 'force-stacks' },
  }))
}

const REGION_ORDER: Record<string, number> = {
  'east_prod': 0, 'central_prod': 1, 'west_prod': 2,
}
const REGION_BADGE: Record<string, string> = {
  'east_prod': 'E', 'central_prod': 'C', 'west_prod': 'W',
}
const REGION_BG: Record<string, string> = {
  'east_prod': '#316AC5', 'central_prod': '#A66B00', 'west_prod': '#0F8C5C',
}

export default function ForceStacksPage() {
  const [rows, setRows] = useState<ForceStackRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [minMmdc, setMinMmdc] = useState<2 | 3>(2)

  useEffect(() => {
    fetch('/api/admin/force-stacks')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((p: { rows: ForceStackRow[] }) => setRows(p.rows))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (minMmdc > 2) list = list.filter(r => r.mmdcCount >= minMmdc)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        r.chargeNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.mmdcSummary.some(m => m.label.toLowerCase().includes(q)),
      )
    }
    return list
  }, [rows, search, minMmdc])

  return (
    <AdminWindowFrame
      icon="⚠"
      title="Force-Stack Worklist"
      subtitle="(architect)"
    >
      <div className="p-3 space-y-2 font-mono text-xs">
        <div className="border border-[#C0C0C0] bg-[#FFFAE5] px-2 py-1.5 text-[11px]">
          <div className="font-bold mb-0.5">CDMs with mixed Multum drug codes</div>
          <div className="text-[#404040] leading-relaxed">
            Each row is a charge number where the flexed NDCs resolve to
            ≥2 distinct Multum MMDCs — meaning Cerner has clinically
            different drugs stacked under one CDM. These are candidates
            for splitting into separate CDMs. Open the product in the
            Formulary Manager to see the per-row breakdown, or jump
            straight to NDC Move Alert to find which facilities scan
            each MMDC group.
          </div>
        </div>

        {error && (
          <div className="border border-red-600 bg-red-50 text-red-900 px-2 py-1.5">{error}</div>
        )}

        {!rows && !error && (
          <div className="text-[#404040] italic">Scanning every flexed NDC against Multum…</div>
        )}

        {rows && (
          <>
            <div className="border border-[#808080] bg-white p-2 flex flex-wrap gap-x-4 gap-y-1 items-baseline">
              <span><b>{rows.length}</b> products with force-stacks</span>
              <span className="text-[#606060]">
                {rows.filter(r => r.mmdcCount >= 3).length} with 3+ MMDCs ·
                {' '}{rows.reduce((sum, r) => sum + r.totalNdcCount, 0).toLocaleString()} total NDCs affected
              </span>
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <input
                placeholder="search CDM / description / drug name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-[#808080] bg-white px-2 py-0.5 text-xs font-mono w-72"
              />
              <FilterChip current={minMmdc} value={2} label="2+ MMDCs" onSelect={setMinMmdc} />
              <FilterChip current={minMmdc} value={3} label="3+ MMDCs" onSelect={setMinMmdc} />
              <span className="text-[#606060] ml-auto">{filtered.length} shown</span>
            </div>

            <div className="border border-[#808080] bg-white overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-xs font-mono">
                <thead className="sticky top-0 bg-[#D4D0C8] z-10">
                  <tr className="border-b border-[#808080]">
                    <th className="px-2 py-1 text-left border-r border-[#808080] w-24">CDM</th>
                    <th className="px-2 py-1 text-left border-r border-[#808080] w-12 text-center" title="Number of distinct MMDCs flexed under this CDM">×MMDC</th>
                    <th className="px-2 py-1 text-left border-r border-[#808080] w-20">Regions</th>
                    <th className="px-2 py-1 text-left border-r border-[#808080]">Description / per-MMDC breakdown</th>
                    <th className="px-2 py-1 text-right border-r border-[#808080] w-12">NDCs</th>
                    <th className="px-2 py-1 text-left w-44">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <ForceStackRowView key={r.chargeNumber} row={r} />
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-3 text-center text-[#808080] italic">
                        {rows.length === 0
                          ? 'No force-stacks detected — every CDM has a single MMDC.'
                          : 'No force-stacks match.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminWindowFrame>
  )
}

function ForceStackRowView({ row }: { row: ForceStackRow }) {
  const largestGroup = row.mmdcSummary[0]
  // For the "Alert facilities" hand-off we need NDCs of one group. The
  // worklist API doesn't return NDCs (would bloat the response); the
  // pre-fill instead passes the CDM, and the alert page resolves NDCs
  // server-side. Skip the alert button for now and rely on Open + the
  // supply-tab banner workflow that already exists.
  return (
    <tr className="border-b border-[#E0E0E0] hover:bg-[#F0F0F0]">
      <td className="px-2 py-0.5 border-r border-[#E8E8E8] font-bold align-top">
        <button
          onClick={() => openInFormulary(row.chargeNumber)}
          className="text-[#0000FF] hover:underline font-mono"
          title="Open this product in the Formulary Manager"
        >
          {row.chargeNumber}
        </button>
      </td>
      <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-center align-top">
        <span
          className="text-[10px] font-bold px-1 py-px"
          style={{
            background: row.mmdcCount >= 3 ? '#CC0000' : '#A66B00',
            color: 'white',
          }}
        >
          ×{row.mmdcCount}
        </span>
      </td>
      <td className="px-2 py-0.5 border-r border-[#E8E8E8] align-top">
        <div className="flex gap-0.5">
          {row.regions
            .slice()
            .sort((a, b) => (REGION_ORDER[a] ?? 9) - (REGION_ORDER[b] ?? 9))
            .map(reg => (
              <span
                key={reg}
                className="text-[9px] font-bold w-4 h-4 inline-flex items-center justify-center leading-none"
                style={{ background: REGION_BG[reg] ?? '#808080', color: 'white' }}
                title={reg}
              >
                {REGION_BADGE[reg] ?? '?'}
              </span>
            ))}
        </div>
      </td>
      <td className="px-2 py-0.5 border-r border-[#E8E8E8]">
        <div className="text-[#404040]">{row.description || <span className="text-[#A0A0A0] italic">no description</span>}</div>
        <div className="mt-0.5 space-y-0 text-[10px]">
          {row.mmdcSummary.map(m => (
            <div key={m.mmdc} className="flex items-baseline gap-1.5">
              <span
                className="font-mono font-bold leading-none px-1"
                style={{ background: mmdcColor(m.mmdc), color: 'white' }}
              >
                {m.mmdc}
              </span>
              <span className="text-[#606060]">({m.ndcCount} NDC{m.ndcCount !== 1 ? 's' : ''})</span>
              <span className="text-[#202020]">{m.label}</span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-right tabular-nums align-top">
        {row.totalNdcCount}
      </td>
      <td className="px-2 py-0.5 align-top">
        <button
          onClick={() => openInFormulary(row.chargeNumber)}
          className="text-[10px] border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white px-2 py-0.5"
          title="Load this product in Formulary Manager — supply tab will show the per-MMDC banner with hand-off buttons."
        >
          Open →
        </button>
        <Link
          href={`/admin/ndc-move-alert?inputs=${encodeURIComponent(row.chargeNumber)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-2 py-0.5 ml-1"
          title="Open NDC Move Alert with this CDM as input"
        >
          Alert
        </Link>
      </td>
    </tr>
  )
}

/** Same stable per-MMDC palette as the supply tab so the badge color
 *  matches what the user sees when they open the product. */
function mmdcColor(mmdc: number): string {
  const palette = ['#0F8C5C', '#A66B00', '#0050A0', '#7A2A8A', '#A02C2C', '#3F6F00']
  return palette[Math.abs(mmdc) % palette.length]
}

function FilterChip<T extends number>({
  current, value, label, onSelect,
}: {
  current: T
  value: T
  label: string
  onSelect: (v: T) => void
}) {
  const active = current === value
  return (
    <button
      onClick={() => onSelect(value)}
      className={`text-[11px] px-2 py-0.5 border ${
        active
          ? 'border-[#000] bg-[#316AC5] text-white'
          : 'border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black'
      }`}
    >
      {label}
    </button>
  )
}
