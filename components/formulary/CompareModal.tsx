"use client"

import { useState, useEffect, useRef } from "react"
import type { FormularyItem } from "@/lib/types"
import {
  getDomainColor,
  getDomainBadge,
  computeHeaderDiffs,
  computeTabDiffs,
  buildFieldValueMap,
  buildDomainRecords,
  REGION_ORDER,
} from "@/lib/formulary-diff"
import type { FieldValueMap } from "@/lib/formulary-diff"
import { FormularyHeader } from "./FormularyHeader"
import { OEDefaultsTab } from "./OEDefaultsTab"
import { DispenseTab } from "./DispenseTab"
import { ClinicalTab } from "./ClinicalTab"
import { InventoryTab } from "./InventoryTab"
import { IdentifiersTab } from "./IdentifiersTab"
import { SupplyTab } from "./SupplyTab"

export type { DomainValue, FieldValueMap } from "@/lib/formulary-diff"

interface CompareModalProps {
  groupId: string
  domains: string[]
  onClose: () => void
}

const TABS = [
  { id: "oe-defaults", label: "OE Defaults" },
  { id: "dispense",    label: "Dispense" },
  { id: "clinical",    label: "Clinical" },
  { id: "inventory",   label: "Inventory" },
  { id: "identifiers", label: "Identifiers" },
  { id: "supply",      label: "Supply" },
]

type Rect = { x: number; y: number; w: number; h: number }
type NonProdEnv = 'cert' | 'mock' | 'both'
type ViewMode = 'unified' | 'split'

function loadSettings(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem('pharmnet-compare-settings') ?? '{}') } catch { return {} }
}

function saveSetting(key: string, val: unknown) {
  try {
    const s = loadSettings()
    localStorage.setItem('pharmnet-compare-settings', JSON.stringify({ ...s, [key]: val }))
  } catch {}
}


export function CompareModal({ groupId, domains, onClose }: CompareModalProps) {
  const [items, setItems] = useState<(FormularyItem | null)[]>(domains.map(() => null))
  const [loading, setLoading] = useState<boolean[]>(domains.map(() => true))
  const [activeTab, setActiveTab] = useState("oe-defaults")
  const [showHeader, setShowHeader] = useState(true)
  const [domainFilter, setDomainFilter] = useState<'prod' | 'both' | 'non-prod'>('prod')
  const [nonProdEnv, setNonProdEnvState] = useState<NonProdEnv>(() => (loadSettings().nonProdEnv as NonProdEnv) ?? 'cert')
  const [viewMode, setViewModeState] = useState<ViewMode>(() => (loadSettings().viewMode as ViewMode) ?? 'unified')
  const [baseDomainIdx, setBaseDomainIdx] = useState(0)

  const setNonProdEnv = (v: NonProdEnv) => {
    setNonProdEnvState(v)
    saveSetting('nonProdEnv', v)
  }

  const [rect, setRect] = useState<Rect | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)

  useEffect(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    const storedMode = (loadSettings().viewMode as ViewMode) ?? 'unified'
    let w: number
    if (storedMode === 'split') {
      const prodCount = domains.filter(dk => dk.split('_')[1] === 'prod').length
      const colCount = Math.max(1, prodCount)
      w = colCount === 1 ? 720 : colCount === 2 ? 1440 : 2160
    } else {
      w = 720
    }
    const h = Math.min(vh - 80, 560)
    setRect({ x: Math.max(40, (vw - w) / 2), y: Math.max(40, (vh - h) / 2), w, h })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    domains.forEach((dk, i) => {
      fetch(`/api/formulary/item?groupId=${encodeURIComponent(groupId)}&domain=${encodeURIComponent(dk)}`)
        .then(r => r.json())
        .then(data => {
          setItems(prev => { const n = [...prev]; n[i] = data.item ?? null; return n })
          setLoading(prev => { const n = [...prev]; n[i] = false; return n })
        })
        .catch(() => {
          setLoading(prev => { const n = [...prev]; n[i] = false; return n })
        })
    })
  }, [groupId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTitleBarDrag = (e: React.PointerEvent) => {
    if (isMaximized) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY
    const startRect = rect!
    const onMove = (ev: PointerEvent) => setRect({ ...startRect, x: startRect.x + ev.clientX - startX, y: startRect.y + ev.clientY - startY })
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const toggleMaximize = () => {
    if (isMaximized) {
      setIsMaximized(false)
      if (preMaxRect.current) setRect(preMaxRect.current)
    } else {
      preMaxRect.current = rect
      setIsMaximized(true)
      const w = Math.min(window.innerWidth - 16, 1600)
      setRect({ x: (window.innerWidth - w) / 2, y: 8, w, h: window.innerHeight - 16 })
    }
  }

  const ALL_REGIONS = REGION_ORDER

  const visibleDomainKeys: string[] = (() => {
    const prodKeys = ALL_REGIONS.map(r => `${r}_prod`).filter(dk => domains.includes(dk))

    const nonProdEnvs: string[] = nonProdEnv === 'both' ? ['cert', 'mock'] : [nonProdEnv]
    const nonProdKeys = nonProdEnvs.flatMap(env => ALL_REGIONS.map(r => `${r}_${env}`))

    if (domainFilter === 'prod') return prodKeys
    if (domainFilter === 'non-prod') return nonProdKeys
    return [...prodKeys, ...nonProdKeys]
  })()

  const visibleItems = visibleDomainKeys.map(dk => {
    const idx = domains.indexOf(dk)
    return idx === -1 ? null : items[idx]
  })

  const visibleLoading = visibleDomainKeys.map(dk => {
    const idx = domains.indexOf(dk)
    return idx === -1 ? false : loading[idx]
  })

  const headerDiffs = computeHeaderDiffs(visibleItems)

  // Unified mode derived values
  const effectiveBaseIdx = (() => {
    if (visibleItems[baseDomainIdx] !== null) return baseDomainIdx
    const first = visibleItems.findIndex(i => i !== null)
    return first === -1 ? 0 : first
  })()
  const baseItem = visibleItems[effectiveBaseIdx] ?? null
  const totalDiffs = headerDiffs.size + TABS
    .filter(t => t.id !== 'inventory')
    .reduce((n, t) => n + computeTabDiffs(visibleItems, t.id).count, 0)
  const fieldValueMap: FieldValueMap | undefined =
    viewMode === 'unified' ? buildFieldValueMap(visibleDomainKeys, visibleItems) : undefined
  const domainRecords = buildDomainRecords(visibleDomainKeys, visibleItems)

  const setViewMode = (v: ViewMode) => {
    setViewModeState(v)
    saveSetting('viewMode', v)
    if (v === 'unified') {
      setRect(prev => prev ? { ...prev, w: 720 } : prev)
    } else {
      const col = visibleDomainKeys.length
      setRect(prev => prev ? { ...prev, w: col === 1 ? 720 : col === 2 ? 1440 : 2160 } : prev)
    }
  }

  // Split mode grid vars
  const colCount = visibleDomainKeys.length
  const gridClass = colCount <= 1 ? 'grid-cols-1'
    : colCount === 2 ? 'grid-cols-2'
    : colCount === 3 ? 'grid-cols-3'
    : colCount === 4 ? 'grid-cols-4'
    : colCount === 5 ? 'grid-cols-5'
    : 'grid-cols-6'

  const renderTabStrip = () => (
    <div className="flex items-center gap-0.5 px-2 pt-2 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
      {TABS.map(tab => {
        const diffs = computeTabDiffs(visibleItems, tab.id)
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-3 py-1 text-xs font-sans border-t border-l border-r border-[#808080] rounded-t-sm
              ${activeTab === tab.id
                ? "bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px] shadow-sm pb-1.5"
                : "bg-[#D4D0C8] hover:bg-[#E0DBD0] mt-0.5 border-b-[#808080]"
              }
            `}
          >
            {tab.label}
            {diffs.count > 0 && (
              <span className={`ml-1 text-[9px] px-1 rounded-full font-bold ${tab.id === 'inventory' ? 'bg-[#909090] text-white' : 'bg-amber-500 text-white'}`}>
                *{diffs.count}
              </span>
            )}
          </button>
        )
      })}
      <div className="ml-auto flex items-center pr-1 pb-1">
        <button
          onClick={() => setShowHeader(v => !v)}
          className={`px-1.5 py-0.5 text-[9px] border border-[#808080] rounded-sm ${showHeader ? 'bg-[#316AC5] text-white' : 'bg-[#D4D0C8] text-[#404040]'}`}
          title="Toggle header fields"
        >
          Hdr
        </button>
      </div>
    </div>
  )

  if (!rect) return null

  return (
    <div className="fixed inset-0 z-[60] overflow-auto">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      <div
        className="absolute flex flex-col bg-[#D4D0C8] border border-white border-r-[#808080] border-b-[#808080] shadow-[2px_2px_8px_rgba(0,0,0,0.45)] select-none"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between bg-[#C85A00] text-white px-2 h-7 shrink-0 cursor-default"
          onPointerDown={handleTitleBarDrag}
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
            <div className="w-4 h-4 bg-white border border-white/40 flex items-center justify-center text-[8px] rounded-full text-blue-500 shadow-sm leading-none pt-0.5">⊞</div>
            <span className="text-sm font-bold tracking-wide">Domain Compare</span>
            <span className="text-xs font-mono opacity-80 ml-2">[{groupId}]</span>
          </div>
          <div className="flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
            {/* View mode toggle */}
            <div className="flex border border-white/40 rounded-sm overflow-hidden mr-1">
              {(['unified', 'split'] as const).map((m, i) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={`px-2 py-0.5 text-[10px] ${i > 0 ? 'border-l border-white/30' : ''} ${viewMode === m ? 'bg-white text-black font-semibold' : 'bg-transparent text-white/70 hover:text-white'}`}
                  title={m === 'unified' ? 'Unified view' : 'Side-by-side view'}
                >
                  {m === 'unified' ? '≡' : '⊞'}
                </button>
              ))}
            </div>
            {/* Segmented filter */}
            <div className="flex border border-white/40 rounded-sm overflow-hidden">
              {(['prod', 'both', 'non-prod'] as const).map((f, i) => (
                <button
                  key={f}
                  onClick={() => setDomainFilter(f)}
                  className={`px-2 py-0.5 text-[9px] ${i > 0 ? 'border-l border-white/30' : ''} ${domainFilter === f ? 'bg-white text-black font-semibold' : 'bg-transparent text-white/70 hover:text-white'}`}
                >
                  {f === 'prod' ? 'Prod' : f === 'both' ? 'Both' : 'Non-Prod'}
                </button>
              ))}
            </div>
            {/* Non-prod env selector */}
            <select
              value={nonProdEnv}
              onChange={e => setNonProdEnv(e.target.value as NonProdEnv)}
              onPointerDown={e => e.stopPropagation()}
              className="bg-transparent text-white/80 text-[9px] border border-white/30 rounded-sm px-1 py-0.5 cursor-pointer focus:outline-none hover:border-white/60"
              title="Non-prod environment"
            >
              <option value="cert" className="bg-[#333] text-white">cert</option>
              <option value="mock" className="bg-[#333] text-white">mock</option>
              <option value="both" className="bg-[#333] text-white">cert+mock</option>
            </select>
            {/* Window controls */}
            <button onClick={toggleMaximize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none active:bg-[#808080]">
              {isMaximized ? '❐' : '□'}
            </button>
            <button onClick={onClose} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none active:bg-[#808080]">✕</button>
          </div>
        </div>

        {viewMode === 'unified' ? (
          visibleDomainKeys.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[#808080] text-sm font-mono">
              No domains match filter
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Domain status bar */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#D4D0C8] border-b border-[#808080] shrink-0 flex-wrap">
                {visibleDomainKeys.map((dk, vi) => {
                  const [reg, env] = dk.split('_')
                  const { bg, text } = getDomainColor(reg, env)
                  const hasData = visibleItems[vi] !== null
                  const isBase = vi === effectiveBaseIdx
                  return (
                    <button
                      key={dk}
                      onClick={() => hasData && setBaseDomainIdx(vi)}
                      style={{ background: bg, color: text, opacity: hasData ? 1 : 0.4, outline: isBase ? '2px solid white' : 'none', outlineOffset: '1px' }}
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm cursor-default"
                      title={hasData ? (isBase ? 'Current base domain' : 'Click to use as base') : 'No data for this domain'}
                    >
                      {getDomainBadge(reg, env)} {dk}
                    </button>
                  )
                })}
                <span className="ml-auto text-[10px] font-mono text-[#808080]">
                  {totalDiffs === 0 ? 'All domains match' : `${totalDiffs} field${totalDiffs !== 1 ? 's' : ''} differ`}
                </span>
              </div>

              {/* Header */}
              {showHeader && (
                <FormularyHeader item={baseItem} highlightedFields={headerDiffs} fieldValueMap={fieldValueMap} />
              )}

              {/* Tab strip */}
              {renderTabStrip()}

              {/* Tab content */}
              <div className="flex-1 overflow-auto min-h-0 bg-[#F0F0F0]">
                {!baseItem ? (
                  <div className="p-4 text-[#808080] text-xs font-mono animate-pulse">
                    {visibleLoading.some(Boolean) ? 'Loading…' : 'No data available for selected domains'}
                  </div>
                ) : (() => {
                  const diffs = computeTabDiffs(visibleItems, activeTab)
                  return (
                    <>
                      {activeTab === 'oe-defaults' && <OEDefaultsTab  item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} />}
                      {activeTab === 'dispense'    && <DispenseTab    item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} />}
                      {activeTab === 'clinical'    && <ClinicalTab    item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} />}
                      {activeTab === 'inventory'   && <InventoryTab   item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} />}
                      {activeTab === 'identifiers' && <IdentifiersTab item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} domainRecords={domainRecords} />}
                      {activeTab === 'supply'      && <SupplyTab      item={baseItem} highlightedFields={diffs.fields} fieldValueMap={fieldValueMap} domainRecords={domainRecords} />}
                    </>
                  )
                })()}
              </div>
            </div>
          )
        ) : (
          // Split view
          <>
            {renderTabStrip()}
            {visibleDomainKeys.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-[#808080] text-sm font-mono">
                No domains match filter
              </div>
            ) : (
              <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
                <div className={`grid ${gridClass} h-full`} style={{ minWidth: visibleDomainKeys.length * 720 }}>
                {visibleDomainKeys.map((dk, vi) => {
                  const [reg, env] = dk.split('_')
                  const { bg, text } = getDomainColor(reg, env)
                  const item = visibleItems[vi]
                  const isLoading = visibleLoading[vi]
                  const diffs = computeTabDiffs(visibleItems, activeTab)
                  return (
                    <div key={dk} className="flex flex-col border-r border-[#808080] last:border-r-0 min-h-0 overflow-hidden min-w-[720px]">
                      {/* Domain badge row */}
                      <div style={{ background: bg, color: text }} className="px-3 py-1.5 text-xs font-bold shrink-0 flex items-center gap-1.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.2)' }}>
                          {getDomainBadge(reg, env)}
                        </span>
                        {dk}
                      </div>

                      {isLoading ? (
                        <div className="p-4 text-[#808080] text-xs animate-pulse font-mono">Loading {dk}…</div>
                      ) : item === null ? (
                        <div className="flex-1 flex items-center justify-center text-[#808080] text-xs font-mono italic">
                          Product does not exist in domain
                        </div>
                      ) : (
                        <>
                          {showHeader && (
                            <FormularyHeader item={item} highlightedFields={headerDiffs} />
                          )}

                          {/* Tab content */}
                          <div className="flex-1 overflow-auto min-h-0 bg-[#F0F0F0]">
                            {activeTab === "oe-defaults" && <OEDefaultsTab item={item} highlightedFields={diffs.fields} />}
                            {activeTab === "dispense"    && <DispenseTab    item={item} highlightedFields={diffs.fields} />}
                            {activeTab === "clinical"    && <ClinicalTab    item={item} highlightedFields={diffs.fields} />}
                            {activeTab === "inventory"   && <InventoryTab   item={item} highlightedFields={diffs.fields} />}
                            {activeTab === "identifiers" && <IdentifiersTab item={item} highlightedFields={diffs.fields} />}
                            {activeTab === "supply"      && <SupplyTab      item={item} highlightedFields={diffs.fields} />}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
