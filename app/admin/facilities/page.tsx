"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import type { FacilityListRow } from "@/app/api/admin/facilities/route"

/**
 * Facility admin list — `/admin/facilities`.
 *
 * Browse all 62 canonical facilities with at-a-glance counts (contacts,
 * aliases, Cerner domain mappings) and quick filters for the most common
 * data-quality issues (no pharmacy director, no email, no phone). Click a
 * row to drill into the detail / edit view.
 *
 * Row selection here does NOT use the `pharmnet:load-drug` event the other
 * admin tabs use — facilities aren't drugs. Just a Next.js Link to the
 * detail route.
 */
export default function FacilitiesAdminPage() {
  const [rows, setRows] = useState<FacilityListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<'all' | 'no_pd' | 'no_email' | 'no_phone' | 'acute' | 'bh'>('all')

  useEffect(() => {
    fetch('/api/admin/facilities')
      .then(r => r.json())
      .then((p: { facilities: FacilityListRow[] }) => setRows(p.facilities))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (filter === 'no_pd')    list = list.filter(r => !r.hasPharmacyDirector)
    if (filter === 'no_email') list = list.filter(r => !r.hasAnyEmail)
    if (filter === 'no_phone') list = list.filter(r => !r.hasAnyPhone)
    if (filter === 'acute')    list = list.filter(r => r.isAcute)
    if (filter === 'bh')       list = list.filter(r => !r.isAcute)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.mnemonic.toLowerCase().includes(q) || r.longName.toLowerCase().includes(q),
      )
    }
    return list
  }, [rows, search, filter])

  const counts = useMemo(() => {
    if (!rows) return null
    return {
      total: rows.length,
      acute: rows.filter(r => r.isAcute).length,
      bh: rows.filter(r => !r.isAcute).length,
      missingPd: rows.filter(r => !r.hasPharmacyDirector).length,
      missingEmail: rows.filter(r => !r.hasAnyEmail).length,
      missingPhone: rows.filter(r => !r.hasAnyPhone).length,
    }
  }, [rows])

  return (
    <AdminWindowFrame icon="🏥" title="UHS Facilities" subtitle="(admin)">
      <div className="p-3 space-y-2 font-mono text-xs">
        {error && (
          <div className="border border-red-600 bg-red-50 text-red-900 px-2 py-1.5">
            {error}
          </div>
        )}

        {!rows && !error && (
          <div className="text-[#404040] italic">Loading facilities…</div>
        )}

        {counts && (
          <div className="border border-[#808080] bg-white p-2 flex flex-wrap gap-x-4 gap-y-1 items-baseline">
            <span><b>{counts.total}</b> facilities</span>
            <span className="text-[#606060]">acute={counts.acute} · BH={counts.bh}</span>
            <span className="text-[#606060]">
              missing pharmacy director: <b>{counts.missingPd}</b> · no email: <b>{counts.missingEmail}</b> · no phone: <b>{counts.missingPhone}</b>
            </span>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex gap-2 items-center flex-wrap">
          <input
            placeholder="search mnemonic / long name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-[#808080] bg-white px-2 py-0.5 text-xs font-mono w-64"
          />
          <FilterChip current={filter} value="all"      label="All"      onSelect={setFilter} />
          <FilterChip current={filter} value="acute"    label="Acute"    onSelect={setFilter} />
          <FilterChip current={filter} value="bh"       label="BH"       onSelect={setFilter} />
          <span className="text-[#808080]">·</span>
          <FilterChip current={filter} value="no_pd"    label="Missing PD"    onSelect={setFilter} />
          <FilterChip current={filter} value="no_email" label="No emails"     onSelect={setFilter} />
          <FilterChip current={filter} value="no_phone" label="No phones"     onSelect={setFilter} />
          <span className="text-[#606060] ml-auto">{filtered.length} shown</span>
        </div>

        {/* Table */}
        <div className="border border-[#808080] bg-white overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-xs font-mono">
            <thead className="sticky top-0 bg-[#D4D0C8] z-10">
              <tr className="border-b border-[#808080]">
                <th className="px-2 py-1 text-left border-r border-[#808080] w-20">Mnemonic</th>
                <th className="px-2 py-1 text-left border-r border-[#808080]">Long Name</th>
                <th className="px-2 py-1 text-left border-r border-[#808080] w-20">Region</th>
                <th className="px-2 py-1 text-left border-r border-[#808080] w-12">Type</th>
                <th className="px-2 py-1 text-right border-r border-[#808080] w-16">Contacts</th>
                <th className="px-2 py-1 text-right border-r border-[#808080] w-16">Aliases</th>
                <th className="px-2 py-1 text-right border-r border-[#808080] w-16">Cerner</th>
                <th className="px-2 py-1 text-center w-24">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.mnemonic}
                  className="border-b border-[#E0E0E0] hover:bg-[#F0F0F0] cursor-pointer"
                >
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] font-bold">
                    <Link
                      href={`/admin/facilities/${r.mnemonic}`}
                      className="hover:underline"
                      style={{ color: '#0000FF' }}
                    >
                      {r.mnemonic}
                    </Link>
                  </td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8]">{r.longName}</td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-[#606060]">{r.region ?? '—'}</td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-[10px]">
                    {r.isAcute ? <span title="Acute care hospital">acute</span>
                              : <span className="text-[#9C5500]" title="Behavioral health">BH</span>}
                  </td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-right">{r.contactCount}</td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-right">{r.aliasCount}</td>
                  <td className="px-2 py-0.5 border-r border-[#E8E8E8] text-right">{r.cernerDomainCount}</td>
                  <td className="px-2 py-0.5 text-[10px]">
                    <CoverageDots row={r} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && rows && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-center text-[#808080] italic">
                    No facilities match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminWindowFrame>
  )
}

function FilterChip<T extends string>({
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

/** Three-dot indicator showing PD / Email / Phone presence at a glance.
 *  Green = has, grey = missing. Read in that order: PD → Email → Phone. */
function CoverageDots({ row }: { row: FacilityListRow }) {
  return (
    <span className="inline-flex gap-0.5 font-mono items-center" title="Pharmacy Director · any email · any phone">
      <Dot ok={row.hasPharmacyDirector} label="PD" />
      <Dot ok={row.hasAnyEmail}         label="@" />
      <Dot ok={row.hasAnyPhone}         label="☎" />
    </span>
  )
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-block w-4 text-center text-[10px]"
      style={{
        color: ok ? '#0F8C5C' : '#A0A0A0',
        fontWeight: ok ? 'bold' : 'normal',
      }}
    >
      {label}
    </span>
  )
}
