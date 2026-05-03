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
    detail: { value: query, source: 'extract-changes' },
  }))
}

// Pre-computed extract changeset viewer — see project_extract_changeset_viewer.md.
// Surfaces:
//   1. Dashboard tile strip — unique-drug counts per clinical event type. Tiles
//      are click-to-filter (multi-select).
//   2. Drug-first tree — one row per unique drug (keyed by CDM/charge_number).
//      Domain/environment hidden under expand. Designed to match how admins
//      think: "which drug changed, then where."

type EventType =
  | 'new_build' | 'cross_domain_add'
  | 'flex' | 'unflex'
  | 'facility_onboarding' | 'facility_offboarding'
  | 'stack'
  | 'status_change' | 'description_change'
  | 'other_modified' | 'removed'

interface FieldDiff { field: string; old: string; new: string }

interface ExtractChange {
  id: number
  change_type: string
  event_type: EventType
  domain: string
  group_id: string
  description: string
  charge_number: string
  pyxis_id: string
  generic_name: string
  strength: string
  strength_unit: string
  dosage_form: string
  field_diffs: FieldDiff[]
  categories: { id: string; name: string; color: string }[]
}

interface ApiResponse {
  run: {
    id: string
    ran_at: string
    prev_run_id: string | null
    summary: {
      totals?: Partial<Record<EventType, number>>
      // facility_name → drug count (events of facility_onboarding / _offboarding)
      new_facilities?: Record<string, number>
      offboarded_facilities?: Record<string, number>
    }
  } | null
  prev_runs: { id: string; ran_at: string }[]
  changes: ExtractChange[]
}

// ── Event presentation ──────────────────────────────────────────────────────
const EVENT_DEFS: { type: EventType; label: string; icon: string; color: string; tone: string }[] = [
  { type: 'flex',                label: 'Flexes',          icon: '➕', color: '#0B6E27', tone: '#E4F5E4' },
  { type: 'unflex',              label: 'Unflexes',        icon: '➖', color: '#990000', tone: '#FCE4E4' },
  { type: 'new_build',           label: 'New builds',      icon: '★',  color: '#1E5391', tone: '#DCEAF7' },
  { type: 'cross_domain_add',    label: 'Cross-domain',    icon: '↔',  color: '#5B2A86', tone: '#EAE0F4' },
  { type: 'stack',               label: 'Stacks (NDC+)',   icon: '⊞',  color: '#8C5A00', tone: '#F7EBC8' },
  { type: 'status_change',       label: 'Status change',   icon: '⚑',  color: '#9C2A00', tone: '#FBE4D8' },
  { type: 'description_change',  label: 'Description',     icon: '✎',  color: '#444',    tone: '#EAEAEA' },
  { type: 'other_modified',      label: 'Other edits',     icon: '~',  color: '#666',    tone: '#F0F0F0' },
  { type: 'removed',             label: 'Removed',         icon: '✕',  color: '#660000', tone: '#FBE4E4' },
  // The two below are NOT shown in the main tile strip — they get their own
  // section. Listed here so the EVENT_BY_TYPE lookup + chip rendering still
  // know how to color them.
  { type: 'facility_onboarding', label: 'Facility on-board',  icon: '🏥', color: '#1E5391', tone: '#DCEAF7' },
  { type: 'facility_offboarding',label: 'Facility off-board', icon: '🏥', color: '#660000', tone: '#FBE4E4' },
]
// Tiles shown in the main dashboard strip (regular maintenance pane). Facility
// events are pulled out into their own panel below, so go-live noise doesn't
// drown out the regular work.
const MAIN_TILE_TYPES: EventType[] = [
  'flex', 'unflex', 'new_build', 'cross_domain_add', 'stack',
  'status_change', 'description_change', 'other_modified', 'removed',
]
// Tiles shown inside the onboarding panel (drugs touched by go-live). Leads
// with facility_onboarding so the dominant signal is visible — without it,
// "Flexes 102" reads confusingly when the actual go-live flexes (1500+) are
// implicit. Other tiles read as "in addition to onboarding, this many of
// those drugs also got X."
const PANEL_TILE_TYPES: EventType[] = [
  'facility_onboarding',
  'flex', 'unflex', 'new_build', 'cross_domain_add', 'stack',
  'status_change', 'description_change', 'other_modified', 'removed',
]
const EVENT_BY_TYPE = new Map<EventType, typeof EVENT_DEFS[number]>(EVENT_DEFS.map(d => [d.type, d]))

// ── Drug rollup ─────────────────────────────────────────────────────────────
// Keyed primarily by CDM (charge_number) — the admin-facing identifier.
// Falls back to a (description, strength, dosage_form) tuple for drugs
// without a CDM number assigned. group_ids are tracked but not used as
// the key since admins don't recognize them.
function drugKey(c: ExtractChange): string {
  if (c.charge_number) return `cdm:${c.charge_number}`
  return `desc:${c.description}|${c.strength}|${c.strength_unit}|${c.dosage_form}`
}

interface DrugRollup {
  key: string
  description: string         // representative description across rows for this drug
  charge_number: string
  pyxis_id: string
  generic_name: string
  strength: string
  strength_unit: string
  dosage_form: string
  group_ids: Set<string>
  domains: Set<string>
  events: Set<EventType>
  changesByEvent: Map<EventType, ExtractChange[]>
  // Union of categories matched by any change row of this drug. Empty array
  // → uncategorized (catch-all bucket at the bottom of the grouped view).
  categories: { id: string; name: string; color: string }[]
}

function buildRollups(changes: ExtractChange[]): Map<string, DrugRollup> {
  const m = new Map<string, DrugRollup>()
  for (const c of changes) {
    const k = drugKey(c)
    let r = m.get(k)
    if (!r) {
      r = {
        key: k,
        description: c.description,
        charge_number: c.charge_number,
        pyxis_id: c.pyxis_id,
        generic_name: c.generic_name,
        strength: c.strength,
        strength_unit: c.strength_unit,
        dosage_form: c.dosage_form,
        group_ids: new Set(),
        domains: new Set(),
        events: new Set(),
        changesByEvent: new Map(),
        categories: [],
      }
      m.set(k, r)
    }
    // Categories are computed per-change-row server-side. They should be
    // identical for every row of the same drug (same description / TC etc.),
    // so just take from the first row that has them.
    if (r.categories.length === 0 && c.categories?.length) r.categories = c.categories
    // Capture identifiers from any row that has them (some domains may have
    // empty pyxis_id while others have it populated — keep the first non-empty).
    if (!r.charge_number && c.charge_number) r.charge_number = c.charge_number
    if (!r.pyxis_id && c.pyxis_id) r.pyxis_id = c.pyxis_id
    if (!r.generic_name && c.generic_name) r.generic_name = c.generic_name
    r.group_ids.add(c.group_id)
    r.domains.add(c.domain)
    r.events.add(c.event_type)
    const arr = r.changesByEvent.get(c.event_type) ?? []
    arr.push(c)
    r.changesByEvent.set(c.event_type, arr)
  }
  return m
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTs(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}
function trunc(s: string, n: number): string { return s.length > n ? s.slice(0, n) + '…' : s }

function PlusMinus({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-[13px] h-[13px] mr-1 select-none border border-[#808080] bg-white font-mono text-[11px] leading-none cursor-pointer shrink-0"
      style={{ padding: 0 }}
      aria-label={open ? 'Collapse' : 'Expand'}
    >{open ? '−' : '+'}</button>
  )
}

// Field-diff renderer with special handling for facilities (flex/unflex) and stack NDCs
function FieldDiffLine({ diff, eventType }: { diff: FieldDiff; eventType: EventType }) {
  if (diff.field === 'facilities') {
    const facs = JSON.parse(eventType === 'flex' ? diff.new : diff.old) as string[]
    const isFlex = eventType === 'flex'
    return (
      <div className="font-mono text-[11px] leading-tight py-px">
        <span style={{ color: isFlex ? '#0B6E27' : '#990000' }}>
          {isFlex ? '+ flexed to: ' : '− unflexed from: '}
        </span>
        <span>{facs.join(', ')}</span>
      </div>
    )
  }
  if (diff.field === 'ndc') {
    return (
      <div className="font-mono text-[11px] leading-tight py-px">
        <span style={{ color: '#8C5A00' }}>+ NDC: </span>
        <span>{diff.new}</span>
      </div>
    )
  }
  const isJson = diff.field.endsWith('_json')
  return (
    <div className="font-mono text-[11px] leading-tight py-px">
      <span className="text-[#444]">{diff.field}:</span>{' '}
      {isJson ? (
        <span className="text-[#8C5A00] italic">(JSON changed — {diff.old.length}→{diff.new.length} chars)</span>
      ) : (
        <>
          <span className="bg-[#FCE4E4] line-through">{trunc(diff.old || '∅', 60)}</span>
          <span className="mx-1 text-[#808080]">→</span>
          <span className="bg-[#E4F5E4]">{trunc(diff.new || '∅', 60)}</span>
        </>
      )}
    </div>
  )
}

// One per (event-type, domain) row inside an expanded drug
function DomainEventRow({ change }: { change: ExtractChange }) {
  return (
    <div className="border-l-2 border-[#C0C0C0] pl-2 py-1 mb-1">
      <div className="font-mono text-[10px] text-[#444] mb-0.5">
        <span className="font-semibold">{change.domain}</span>
        <span className="text-[#888]"> · group_id {change.group_id}</span>
      </div>
      {change.field_diffs.map((d, i) => <FieldDiffLine key={i} diff={d} eventType={change.event_type} />)}
    </div>
  )
}

// Per-event group inside an expanded drug
function DrugEventBucket({ type, changes }: { type: EventType; changes: ExtractChange[] }) {
  const def = EVENT_BY_TYPE.get(type)!
  const sorted = [...changes].sort((a, b) => a.domain.localeCompare(b.domain))
  return (
    <div className="mb-2">
      <div className="font-mono text-[11px] mb-1" style={{ color: def.color }}>
        {def.icon} {def.label} <span className="text-[#666]">({sorted.length} {sorted.length === 1 ? 'domain' : 'domains'})</span>
      </div>
      <div className="ml-2">
        {sorted.map(c => <DomainEventRow key={c.id} change={c} />)}
      </div>
    </div>
  )
}

// ── Drug row (top-level) ────────────────────────────────────────────────────
function DrugRow({ rollup, totalDomains }: { rollup: DrugRollup; totalDomains: number }) {
  const [open, setOpen] = useState(false)

  const eventChips = useMemo(() => {
    return EVENT_DEFS
      .filter(def => rollup.events.has(def.type))
      .map(def => ({ ...def, count: rollup.changesByEvent.get(def.type)?.length ?? 0 }))
  }, [rollup])

  // For new builds, surface a prod-region coverage pill (W/C/E). The build
  // is "complete" when the drug exists in all 3 prod regions; partial when
  // some segments are gray. Mirrors the existing Search Modal / NDC stack
  // pill convention — prod-only because cert is essentially sandbox.
  const isNewBuild = rollup.events.has('new_build')
  const prodRegionsBuilt = useMemo(() => {
    const s = new Set<string>()
    for (const dom of rollup.domains) {
      const [region, env] = dom.split('_')
      if (env === 'prod') s.add(region)
    }
    return s
  }, [rollup])

  return (
    <div
      onDoubleClick={() => openInFormulary(rollup.charge_number || rollup.description)}
      className="border-b border-dotted border-[#C0C0C0] py-1.5 px-1 hover:bg-[#FCFCFC] cursor-pointer"
      title="Double-click to open in Product Search"
    >
      <div className="flex items-baseline gap-1">
        <PlusMinus open={open} onClick={() => setOpen(!open)} />
        <div className="flex-1 min-w-0">
          {/* Identifiers row — CDM + Pyxis on the left for quick scan/copy. */}
          <div className="font-mono text-[10px] text-[#444] flex items-center gap-1 flex-wrap">
            {rollup.charge_number && (
              <>
                <span className="text-[#666]">CDM</span>
                <CopyableValue value={rollup.charge_number} className="text-[#222] font-semibold" />
              </>
            )}
            {rollup.pyxis_id && (
              <>
                <span className="text-[#666] ml-1">Pyxis</span>
                <CopyableValue value={rollup.pyxis_id} className="text-[#222] font-semibold" />
              </>
            )}
            <span className="text-[#666] ml-1">· {rollup.domains.size}/{totalDomains} {rollup.domains.size === 1 ? 'domain' : 'domains'}</span>
          </div>
          <div className="font-semibold text-[12px] truncate flex items-center gap-2 mt-0.5">
            <span className="truncate">{rollup.description || '(no description)'}</span>
            {isNewBuild && (
              <DomainCoveragePill
                litRegions={prodRegionsBuilt}
                emptyTitle="not yet built"
              />
            )}
          </div>
          {rollup.generic_name && rollup.generic_name !== rollup.description && (
            <div className="font-mono text-[10px] text-[#666]">{rollup.generic_name}</div>
          )}
          <div className="mt-0.5 flex flex-wrap gap-1">
            {eventChips.map(c => (
              <span
                key={c.type}
                className="inline-block px-1.5 py-0.5 text-[10px] font-mono border"
                style={{ backgroundColor: c.tone, color: c.color, borderColor: c.color }}
                title={`${c.label}: ${c.count} ${c.count === 1 ? 'domain' : 'domains'}`}
              >
                {c.icon} {c.label}{c.count > 1 ? ` ×${c.count}` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-2 ml-5 pl-2 border-l border-[#C0C0C0]">
          {EVENT_DEFS
            .filter(def => rollup.events.has(def.type))
            .map(def => (
              <DrugEventBucket
                key={def.type}
                type={def.type}
                changes={rollup.changesByEvent.get(def.type) ?? []}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ── Reusable tile strip ────────────────────────────────────────────────────
function TileStrip({
  types, countsByEvent, activeEvents, onClick,
}: {
  types: EventType[]
  countsByEvent: Partial<Record<EventType, number>>
  activeEvents: Set<EventType>
  onClick: (t: EventType) => void
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-9 gap-1">
      {types.map(t => {
        const def = EVENT_BY_TYPE.get(t)!
        const count = countsByEvent[def.type] ?? 0
        const active = activeEvents.has(def.type)
        const dimmed = activeEvents.size > 0 && !active
        return (
          <button
            key={def.type}
            onClick={() => onClick(def.type)}
            disabled={count === 0}
            className={`px-2 py-2 text-left border ${active ? 'border-[#0A246A] border-2' : 'border-[#808080]'} ${count === 0 ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:brightness-95'} ${dimmed ? 'opacity-50' : ''}`}
            style={{
              backgroundColor: count > 0 ? def.tone : '#F5F5F5',
              boxShadow: active
                ? 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff'
                : 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080',
            }}
            title={count > 0
              ? `${count} unique drug${count === 1 ? '' : 's'} with ${def.label.toLowerCase()} event`
              : `No drugs with ${def.label.toLowerCase()} in this scope`}
          >
            <div className="text-[10px] font-mono" style={{ color: def.color }}>
              {def.icon} {def.label}
            </div>
            <div className="text-[16px] font-bold leading-tight" style={{ color: def.color }}>
              {count.toLocaleString()}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Facility onboarding/offboarding panel ──────────────────────────────────
// Lists go-live (or decom'd) facilities with how many drugs flexed/unflexed
// to/from each. Click the section title to filter the drug list to drugs
// affected by these facility changes.
function FacilityPanel({
  kind, facilities, eventTotal, drugTotal, isFiltered, onToggle,
  countsByEvent, activeEvents, onTileClick,
  selectedFacility, onFacilityClick,
}: {
  kind: 'onboarding' | 'offboarding'
  facilities: Record<string, number>
  eventTotal: number
  drugTotal: number
  isFiltered: boolean
  onToggle: () => void
  countsByEvent?: Partial<Record<EventType, number>>
  activeEvents?: Set<EventType>
  onTileClick?: (t: EventType) => void
  selectedFacility?: string | null
  onFacilityClick?: (f: string) => void
}) {
  const entries = Object.entries(facilities).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null

  const isOnboard = kind === 'onboarding'
  const accentColor = isOnboard ? '#1E5391' : '#660000'
  const accentTone  = isOnboard ? '#DCEAF7' : '#FBE4E4'
  const verb = isOnboard ? 'flexed to' : 'unflexed from'
  const title = isOnboard ? 'Facility Onboarding' : 'Facility Offboarding'
  const sub = isOnboard
    ? 'New sites went live in this extract — work below is what was done as part of the go-live, separate from regular maintenance.'
    : 'Sites left the formulary universe — work below is the decom, separate from regular maintenance.'

  return (
    <div className="border-2 mb-2"
         style={{ borderColor: accentColor, backgroundColor: accentTone }}>
      <div className="flex items-baseline justify-between px-2 py-1" style={{ backgroundColor: accentColor, color: 'white' }}>
        <div>
          <span className="font-semibold text-[12px]">🏥 {title}</span>
          <span className="text-[10px] ml-2 opacity-90">({entries.length} {entries.length === 1 ? 'facility' : 'facilities'} · {drugTotal.toLocaleString()} unique drugs · {eventTotal.toLocaleString()} events)</span>
        </div>
        <button
          onClick={onToggle}
          className="text-[10px] px-2 py-0.5 border border-white bg-white/10 hover:bg-white/20 cursor-pointer"
        >
          {isFiltered ? '✓ Filtered — click to clear' : 'Show all onboarded drugs'}
        </button>
      </div>
      <div className="px-2 py-1 text-[10px] text-[#444] italic bg-white border-b border-[#C0C0C0]">{sub}</div>
      <div className="bg-white px-2 py-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
        {entries.map(([name, count]) => {
          const active = selectedFacility === name
          return (
            <button
              key={name}
              onClick={() => onFacilityClick?.(name)}
              className={`text-left border px-2 py-1 text-[11px] cursor-pointer hover:brightness-95 ${active ? 'border-2 border-[#0A246A]' : 'border-[#C0C0C0]'}`}
              style={{
                backgroundColor: active ? '#FFF7C4' : '#FCFCFC',
                boxShadow: active
                  ? 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff'
                  : 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080',
              }}
              title={`Click to filter drug list to drugs ${verb} ${name}`}
            >
              <div className="font-semibold truncate">{name}</div>
              <div className="text-[10px] text-[#666] font-mono">
                {count.toLocaleString()} drug{count === 1 ? '' : 's'} {verb} this site
                {active && <span className="ml-1 text-[#0A246A]">✓ filtered</span>}
              </div>
            </button>
          )
        })}
      </div>
      {countsByEvent && onTileClick && (
        <div className="bg-white border-t border-[#C0C0C0] px-2 py-2">
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: accentColor }}>
            {isOnboard ? 'Onboarding work — drugs by event' : 'Decom work — drugs by event'}
            <span className="text-[#666] font-normal"> · leading tile is the {isOnboard ? 'onboarding' : 'decom'} itself; rest is what else happened to those drugs</span>
          </div>
          <TileStrip
            types={isOnboard ? PANEL_TILE_TYPES : PANEL_TILE_TYPES.map(t => t === 'facility_onboarding' ? 'facility_offboarding' as EventType : t)}
            countsByEvent={countsByEvent}
            activeEvents={activeEvents ?? new Set()}
            onClick={onTileClick}
          />
        </div>
      )}
    </div>
  )
}

// ── Category section (drug list bucketed by category, paginated) ───────────
// Open/closed state is controlled by the parent so the jump-bar at the top
// can scroll-and-open any section. Default is closed for all sections; user
// expands via header click, jump-bar chip, or the Expand-all link.
function CategorySection({
  section, totalDomains, open, onToggle,
}: {
  section: { id: string; name: string; color: string; drugs: DrugRollup[] }
  totalDomains: number
  open: boolean
  onToggle: () => void
}) {
  const PAGE = 50
  const [limit, setLimit] = useState(PAGE)
  const visible = section.drugs.slice(0, limit)
  return (
    <div id={`extract-section-${section.id}`} className="border-2 bg-white" style={{ borderColor: section.color, scrollMarginTop: 8 }}>
      <button
        onClick={onToggle}
        className="w-full flex items-baseline justify-between px-2 py-1 text-left"
        style={{ backgroundColor: section.color, color: 'white' }}
      >
        <div>
          <span className="font-semibold text-[12px]">{open ? '−' : '+'} {section.name}</span>
          <span className="text-[10px] ml-2 opacity-90">({section.drugs.length} drug{section.drugs.length === 1 ? '' : 's'})</span>
        </div>
      </button>
      {open && (
        <div className="px-2 py-1">
          {visible.map(d => <DrugRow key={d.key} rollup={d} totalDomains={totalDomains} />)}
          {section.drugs.length > limit && (
            <div className="p-1 text-center">
              <button
                onClick={() => setLimit(l => l + PAGE)}
                className="px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] text-[10px] font-semibold cursor-pointer hover:bg-[#C8C4BC]"
                style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}
              >
                Show {Math.min(PAGE, section.drugs.length - limit)} more in this category ({(section.drugs.length - limit).toLocaleString()} hidden)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 200

type Scope = 'all' | 'regular' | 'onboarding'

// Inner component — pure content, no chrome. Both the Next route below and
// the floating-desktop-window flavor (components/admin/ExtractChangesWindow)
// render this directly. Keeping it as a named export so neither consumer
// has to re-implement the data fetching + state + view-mode logic.
export function ExtractChangesContent() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<Set<EventType>>(new Set())
  // 'regular' = drugs without any facility_onboarding event (normal Cerner work)
  // 'onboarding' = drugs touched by a go-live (flexed to an onboarded facility)
  const [scope, setScope] = useState<Scope>('all')
  // When a specific facility card is clicked, narrow the drug list to drugs
  // whose facility_onboarding events touched that facility. null = no facility
  // narrowing.
  const [facilityFilter, setFacilityFilter] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState('')
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE)
  // 'by-category' (default): drug list bucketed by Pattern/Category Manager
  //   category. Drugs in N categories appear in N sections. "Uncategorized"
  //   catch-all at the bottom.
  // 'flat': single sorted list of unique drugs (no grouping).
  const [drugViewMode, setDrugViewMode] = useState<'by-category' | 'flat'>('by-category')
  // Per-section expanded state. Default: all collapsed; user expands via
  // header click, jump-bar chip, or Expand-all.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/extract-changes')
      .then(async r => {
        if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<ApiResponse>
      })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const drugs = useMemo(() => {
    if (!data) return [] as DrugRollup[]
    const m = buildRollups(data.changes)
    return [...m.values()].sort((a, b) => a.description.localeCompare(b.description))
  }, [data])

  // Universe of domains in this extract — used to flag partial builds. A
  // drug with a new_build event in fewer than all of these is incomplete.
  const totalDomains = useMemo(() => {
    if (!data) return 0
    const s = new Set<string>()
    for (const c of data.changes) s.add(c.domain)
    return s.size
  }, [data])

  // Partition drugs by onboarding involvement. A drug is "onboarding" if it
  // has any facility_onboarding event — i.e. it was flexed to a go-live site
  // this extract. The two tile strips count drugs in each partition by event,
  // so the user sees "regular maintenance" separate from "work tied to the
  // go-live" (the latter often inflates raw event totals during a phase).
  const onboardingDrugs = useMemo(() => drugs.filter(d => d.events.has('facility_onboarding')), [drugs])
  const regularDrugs    = useMemo(() => drugs.filter(d => !d.events.has('facility_onboarding')), [drugs])

  const regularCountsByEvent = useMemo(() => {
    const m: Partial<Record<EventType, number>> = {}
    for (const d of regularDrugs) for (const ev of d.events) m[ev] = (m[ev] ?? 0) + 1
    return m
  }, [regularDrugs])
  const onboardingCountsByEvent = useMemo(() => {
    const m: Partial<Record<EventType, number>> = {}
    for (const d of onboardingDrugs) for (const ev of d.events) m[ev] = (m[ev] ?? 0) + 1
    return m
  }, [onboardingDrugs])

  // Aggregate (used by the FacilityPanel header which still wants overall totals)
  const drugCountsByEvent = useMemo(() => {
    const m: Partial<Record<EventType, number>> = {}
    for (const d of drugs) for (const ev of d.events) m[ev] = (m[ev] ?? 0) + 1
    return m
  }, [drugs])

  // Index of (drugKey → set of onboarding facility names this drug was flexed
  // to). Used by the facility card filter — clicking "Streamwood" should
  // restrict the drug list to drugs whose facility_onboarding events name
  // Streamwood specifically.
  const drugFacilities = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of data?.changes ?? []) {
      if (c.event_type !== 'facility_onboarding') continue
      const k = drugKey(c)
      let set = m.get(k); if (!set) { set = new Set(); m.set(k, set) }
      // field_diffs[0].new is a JSON-stringified facility array
      try {
        const facs = JSON.parse(c.field_diffs[0]?.new ?? '[]') as string[]
        for (const f of facs) set.add(f)
      } catch {}
    }
    return m
  }, [data])

  const visibleDrugs = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    return drugs.filter(d => {
      if (scope === 'regular' && d.events.has('facility_onboarding')) return false
      if (scope === 'onboarding' && !d.events.has('facility_onboarding')) return false
      if (facilityFilter) {
        const facs = drugFacilities.get(d.key)
        if (!facs || !facs.has(facilityFilter)) return false
      }
      if (activeFilter.size > 0) {
        let any = false
        for (const t of activeFilter) if (d.events.has(t)) { any = true; break }
        if (!any) return false
      }
      if (q) {
        const hay = `${d.description} ${d.charge_number} ${d.pyxis_id} ${d.generic_name} ${[...d.domains].join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [drugs, activeFilter, scope, facilityFilter, drugFacilities, searchQ])

  const pagedDrugs = useMemo(() => visibleDrugs.slice(0, pageLimit), [visibleDrugs, pageLimit])

  // Group visible drugs into category sections (left-join semantics). A drug
  // matching N categories appears in N sections. Drugs with no matching
  // category fall into an "Uncategorized" catch-all at the end. Sections
  // are sorted by drug count (largest first), with Uncategorized last.
  type Section = { id: string; name: string; color: string; drugs: DrugRollup[] }
  const categorySections = useMemo<Section[]>(() => {
    const all = new Map<string, Section>()
    const uncategorized: DrugRollup[] = []
    for (const d of visibleDrugs) {
      if (d.categories.length === 0) {
        uncategorized.push(d)
        continue
      }
      for (const c of d.categories) {
        let s = all.get(c.id)
        if (!s) { s = { id: c.id, name: c.name, color: c.color, drugs: [] }; all.set(c.id, s) }
        s.drugs.push(d)
      }
    }
    const ordered = [...all.values()].sort((a, b) => b.drugs.length - a.drugs.length || a.name.localeCompare(b.name))
    if (uncategorized.length > 0) {
      ordered.push({ id: '__uncategorized__', name: 'Uncategorized', color: '#808080', drugs: uncategorized })
    }
    return ordered
  }, [visibleDrugs])

  // Tile click handler that knows which strip the tile lives in. Switching
  // scope (regular ↔ onboarding) resets the event filter so cross-pane
  // selections don't pile up confusingly.
  const onTileClick = (t: EventType, fromScope: 'regular' | 'onboarding') => {
    if (scope !== fromScope) {
      setScope(fromScope)
      setActiveFilter(new Set([t]))
    } else {
      setActiveFilter(prev => {
        const next = new Set(prev)
        if (next.has(t)) next.delete(t); else next.add(t)
        return next
      })
    }
    setPageLimit(PAGE_SIZE)
  }
  const clearFilters = () => { setActiveFilter(new Set()); setScope('all'); setFacilityFilter(null); setPageLimit(PAGE_SIZE) }

  return (
    <>
      {loading && <div className="text-[#444]">Loading…</div>}
      {error && (
        <div className="border border-[#990000] bg-[#FCE4E4] p-2 text-[11px] text-[#660000]">
          Failed to load: {error}
        </div>
      )}
      {!loading && data && !data.run && (
        <div className="border border-[#808080] bg-white p-3 text-[11px]">
          <div className="font-semibold mb-1">No extract runs recorded yet.</div>
          <div className="text-[#444]">
            The next deploy via <code className="bg-[#F0F0F0] px-1">scripts/deploy-db.sh</code> will populate this view.
          </div>
        </div>
      )}

      {!loading && data?.run && (
        <>
          <div className="border border-[#808080] bg-white p-2 mb-2 text-[11px]"
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <div className="flex flex-wrap items-baseline gap-x-4">
              <div><span className="text-[#666]">Run:</span> <span className="font-mono font-semibold">{data.run.id}</span></div>
              <div><span className="text-[#666]">vs:</span> <span className="font-mono">{data.run.prev_run_id ?? '(none)'}</span></div>
              <div><span className="text-[#666]">Generated:</span> <span>{fmtTs(data.run.ran_at as string)}</span></div>
              <div><span className="text-[#666]">Unique drugs touched:</span> <span className="font-semibold">{drugs.length.toLocaleString()}</span></div>
            </div>
          </div>

          {/* Main tile strip — REGULAR (non-onboarded) drugs only.
              Counts here are pure Cerner-pushed maintenance work, with all
              go-live noise extracted into the panel below. */}
          <div className={`border ${scope === 'regular' ? 'border-2 border-[#0A246A]' : 'border-[#808080]'} bg-white p-2 mb-2`}
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-[11px]">
                Regular maintenance — drugs by event
                <span className="text-[#666] font-normal"> · {regularDrugs.length.toLocaleString()} drugs not touched by go-live</span>
                {scope === 'regular' && activeFilter.size > 0 && <span className="text-[#666] font-normal"> · filtered to {activeFilter.size} event type(s)</span>}
              </div>
              {(scope !== 'all' || activeFilter.size > 0) && (
                <button onClick={clearFilters} className="text-[10px] underline text-[#1E5391] hover:text-[#0A246A]">
                  Clear filters
                </button>
              )}
            </div>
            <TileStrip
              types={MAIN_TILE_TYPES.filter(t => t !== 'facility_onboarding' && t !== 'facility_offboarding')}
              countsByEvent={regularCountsByEvent}
              activeEvents={scope === 'regular' ? activeFilter : new Set()}
              onClick={t => onTileClick(t, 'regular')}
            />
          </div>

          {/* Facility Onboarding panel — only renders when there were go-live
              facilities. Surfaces the work done by adding new sites separately
              from regular Cerner-pushed flexes. */}
          <FacilityPanel
            kind="onboarding"
            facilities={data.run!.summary?.new_facilities ?? {}}
            eventTotal={data.run!.summary?.totals?.facility_onboarding ?? 0}
            drugTotal={drugCountsByEvent.facility_onboarding ?? 0}
            isFiltered={scope === 'onboarding' && activeFilter.size === 0 && !facilityFilter}
            onToggle={() => {
              if (scope === 'onboarding' && !facilityFilter) clearFilters()
              else { setScope('onboarding'); setActiveFilter(new Set()); setFacilityFilter(null); setPageLimit(PAGE_SIZE) }
            }}
            countsByEvent={onboardingCountsByEvent}
            activeEvents={scope === 'onboarding' ? activeFilter : new Set()}
            onTileClick={t => onTileClick(t, 'onboarding')}
            selectedFacility={facilityFilter}
            onFacilityClick={f => {
              // Clicking a facility scopes to onboarding drugs for that site;
              // clicking the same facility again clears the facility filter.
              if (facilityFilter === f) {
                setFacilityFilter(null)
              } else {
                setScope('onboarding')
                setActiveFilter(new Set())
                setFacilityFilter(f)
              }
              setPageLimit(PAGE_SIZE)
            }}
          />
          <FacilityPanel
            kind="offboarding"
            facilities={data.run!.summary?.offboarded_facilities ?? {}}
            eventTotal={data.run!.summary?.totals?.facility_offboarding ?? 0}
            drugTotal={drugCountsByEvent.facility_offboarding ?? 0}
            isFiltered={false}
            onToggle={() => { /* offboarding panel kept symmetric but no scoped filter for now */ }}
          />

          <div className="border border-[#808080] bg-white p-2 mb-2"
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={searchQ}
                onChange={e => { setSearchQ(e.target.value); setPageLimit(PAGE_SIZE) }}
                placeholder="Search by description, CDM, Pyxis ID, or domain…"
                className="flex-1 font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
                style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
              />
              <label className="flex items-center gap-1 text-[11px] shrink-0">
                <span className="font-semibold">View:</span>
                <select
                  value={drugViewMode}
                  onChange={e => setDrugViewMode(e.target.value as 'by-category' | 'flat')}
                  className="font-mono text-[11px] px-1 py-0.5 border border-[#808080] bg-white"
                  style={{ boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff' }}
                  title="Group by category: drugs bucketed into category sections (drugs in N categories appear N times). Flat: single list across all drugs."
                >
                  <option value="by-category">Group by category</option>
                  <option value="flat">Flat list</option>
                </select>
              </label>
            </div>
            <div className="text-[10px] text-[#666] mt-1">
              Showing {pagedDrugs.length.toLocaleString()} of {visibleDrugs.length.toLocaleString()} drugs
              {scope === 'regular' && <> · scope: regular maintenance only</>}
              {scope === 'onboarding' && <> · scope: drugs touched by go-live only</>}
              {facilityFilter && <> · facility: <strong>{facilityFilter}</strong></>}
              {visibleDrugs.length !== drugs.length && <> ({drugs.length.toLocaleString()} total before filters)</>}
            </div>
          </div>

          {/* Drug list — grouped by category (default) or flat */}
          {drugViewMode === 'by-category' ? (
            <>
              {categorySections.length > 0 && (
                <CategoryJumpBar
                  sections={categorySections.map(s => ({ id: s.id, name: s.name, color: s.color, count: s.drugs.length }))}
                  expanded={expandedSections}
                  onJump={(id) => {
                    setExpandedSections(prev => new Set(prev).add(id))
                    requestAnimationFrame(() => {
                      document.getElementById(`extract-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    })
                  }}
                  onExpandAll={() => setExpandedSections(new Set(categorySections.map(s => s.id)))}
                  onCollapseAll={() => setExpandedSections(new Set())}
                />
              )}
              <div className="space-y-2">
                {categorySections.map(s => (
                  <CategorySection
                    key={s.id}
                    section={s}
                    totalDomains={totalDomains}
                    open={expandedSections.has(s.id)}
                    onToggle={() => setExpandedSections(prev => {
                      const n = new Set(prev)
                      if (n.has(s.id)) n.delete(s.id); else n.add(s.id)
                      return n
                    })}
                  />
                ))}
                {categorySections.length === 0 && (
                  <div className="border border-[#808080] bg-white p-2 text-[#666] text-[11px] italic">
                    {searchQ ? 'No drugs match that search.' : 'No drugs match the active filter.'}
                  </div>
                )}
              </div>
            </>
          ) : (
          <div className="border border-[#808080] bg-white p-1"
               style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}>
            {pagedDrugs.map(d => <DrugRow key={d.key} rollup={d} totalDomains={totalDomains} />)}
            {visibleDrugs.length === 0 && (
              <div className="text-[#666] text-[11px] italic p-2">
                {searchQ ? 'No drugs match that search.' : 'No drugs match the active filter.'}
              </div>
            )}
            {visibleDrugs.length > pageLimit && (
              <div className="p-2 text-center">
                <button
                  onClick={() => setPageLimit(pageLimit + PAGE_SIZE)}
                  className="px-3 py-1 border border-[#808080] bg-[#D4D0C8] text-[11px] font-semibold cursor-pointer hover:bg-[#C8C4BC]"
                  style={{ boxShadow: 'inset 1px 1px 0 #fff, inset -1px -1px 0 #808080' }}
                >
                  Show {Math.min(PAGE_SIZE, visibleDrugs.length - pageLimit)} more drugs ({(visibleDrugs.length - pageLimit).toLocaleString()} hidden)
                </button>
              </div>
            )}
          </div>
          )}
        </>
      )}
    </>
  )
}

// Default export = Next.js route entry point. Wraps the reusable content
// in AdminWindowFrame for direct-URL access. The desktop-window flavor
// renders ExtractChangesContent inside a DesktopWindow instead.
export default function ExtractChangesPage() {
  return (
    <AdminWindowFrame icon="📊" title="Extract Changeset Viewer">
      <ExtractChangesContent />
    </AdminWindowFrame>
  )
}
