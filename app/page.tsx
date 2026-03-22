"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { OEDefaultsTab } from "@/components/formulary/OEDefaultsTab"
import { DispenseTab } from "@/components/formulary/DispenseTab"
import { InventoryTab } from "@/components/formulary/InventoryTab"
import { ClinicalTab } from "@/components/formulary/ClinicalTab"
import { SupplyTab } from "@/components/formulary/SupplyTab"
import { IdentifiersTab } from "@/components/formulary/IdentifiersTab"
import { FormularyHeader } from "@/components/formulary/FormularyHeader"
import { SearchModal } from "@/components/formulary/SearchModal"
import { ImportModal } from "@/components/formulary/ImportModal"
import { RecentSearchDropdown } from "@/components/formulary/RecentSearchDropdown"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import type { FieldValueMap, DomainRecord } from "@/lib/formulary-diff"

type Scope =
  | { type: 'all' }
  | { type: 'domain'; region: string; env: string }
  | { type: 'region'; region: string }
  | { type: 'env'; env: string }

function scopeLabel(scope: Scope): string {
  switch (scope.type) {
    case 'all': return 'All Domains'
    case 'domain': return `${scope.region} ${scope.env}`
    case 'region': return `${scope.region} (all)`
    case 'env': return `${scope.env} (all regions)`
  }
}

type TabId = "oe-defaults" | "dispense" | "inventory" | "clinical" | "supply" | "identifiers" | "tpn-details" | "change-log"

// Clinical pharmacy formulary interface v2
const TABS: { id: TabId; label: string }[] = [
  { id: "oe-defaults", label: "OE Defaults" },
  { id: "dispense", label: "Dispense" },
  { id: "inventory", label: "Inventory" },
  { id: "clinical", label: "Clinical" },
  { id: "supply", label: "Supply" },
  { id: "identifiers", label: "Identifiers" },
  { id: "tpn-details", label: "TPN Details" },
  { id: "change-log", label: "Change Log" },
]

const TOOLBAR_ICONS = [
  "📄", "💾", "✂️", "📋", "🔍", "⭐", "🔧", "📊", "🏷️", "📋", "📦", "📊", "🔍"
]

function ToolbarIcon({ children }: { children: React.ReactNode }) {
  return (
    <button className="w-6 h-6 flex items-center justify-center border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs leading-none">
      {children}
    </button>
  )
}

export default function PharmNetFormulary() {
  const [activeTab, setActiveTab] = useState<TabId>("oe-defaults")
  const [searchValue, setSearchValue] = useState("")
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [selectedItemPreview, setSelectedItemPreview] = useState<FormularyItem | null>(null)
  const [domainItems, setDomainItems] = useState<Record<string, FormularyItem | null>>({})
  const [domainLoading, setDomainLoading] = useState<Record<string, boolean>>({})
  const [baseDomain, setBaseDomain] = useState<string | null>(null)
  const [dateStr, setDateStr] = useState<string | null>(null)
  const [timeStr, setTimeStr] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>({ type: 'all' })
  const [availableDomains, setAvailableDomains] = useState<{ region: string; env: string; domain: string }[]>([])
  const [searchTrigger, setSearchTrigger] = useState<{ value: string; seq: number } | null>(null)

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setDateStr(`${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`)
      setTimeStr(now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }))
    }
    updateTime()
    const interval = setInterval(updateTime, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    fetch('/api/formulary/domains')
      .then((r) => r.json())
      .then((d) => setAvailableDomains(d.domains ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    try { setRecentSearches(JSON.parse(localStorage.getItem('pharmnet-recent-searches') ?? '[]')) } catch {}
  }, [])

  // Derived diff values — prod domains sorted west → central → east
  const prodDomains = availableDomains
    .filter(d => d.env === 'prod')
    .sort((a, b) => REGION_ORDER.indexOf(a.region as typeof REGION_ORDER[number]) - REGION_ORDER.indexOf(b.region as typeof REGION_ORDER[number]))
    .map(d => d.domain)
  const domainItemsList = prodDomains.map(dk => domainItems[dk] ?? null)
  const selectedItem = (baseDomain && domainItems[baseDomain])
    ? domainItems[baseDomain]!
    : selectedItemPreview
  const loadedItems = domainItemsList.filter(Boolean)
  const fieldValueMap: FieldValueMap | undefined =
    loadedItems.length >= 2 ? buildFieldValueMap(prodDomains, domainItemsList) : undefined
  const domainRecords: DomainRecord[] = buildDomainRecords(prodDomains, domainItemsList)
  const headerDiffs = computeHeaderDiffs(domainItemsList)
  const isAnyDomainLoading = Object.values(domainLoading).some(Boolean)
  // Inventory diffs are expected across regions — exclude from the summary count
  const totalDiffs = headerDiffs.size + TABS
    .filter(t => t.id !== 'inventory')
    .reduce((n, t) => n + computeTabDiffs(domainItemsList, t.id).count, 0)

  const [rect, setRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null)
  const isResizing = useRef<{ dir: string, startX: number, startY: number, startRect: { x: number, y: number, w: number, h: number } } | null>(null)

  useEffect(() => {
    setRect({
      x: Math.max(0, (window.innerWidth - 740) / 2),
      y: Math.max(0, (window.innerHeight - 620) / 2),
      w: 740,
      h: 620,
    })
  }, [])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const { dir, startX, startY, startRect } = isResizing.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      
      if (dir === 'move') {
        setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy })
        return
      }
      
      let newW = startRect.w
      let newH = startRect.h
      let newX = startRect.x
      let newY = startRect.y
      
      if (dir.includes('e')) newW = Math.max(500, startRect.w + dx)
      if (dir.includes('w')) {
        const potentialW = Math.max(500, startRect.w - dx)
        newX = startRect.x + (startRect.w - potentialW)
        newW = potentialW
      }
      if (dir.includes('s')) newH = Math.max(400, startRect.h + dy)
      if (dir.includes('n')) {
        const potentialH = Math.max(400, startRect.h - dy)
        newY = startRect.y + (startRect.h - potentialH)
        newH = potentialH
      }
      
      setRect({ x: newX, y: newY, w: newW, h: newH })
    }
    const handlePointerUp = () => {
      if (isResizing.current) {
        isResizing.current = null
      }
    }
    
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])
  
  const handlePointerDown = (dir: string) => (e: React.PointerEvent) => {
    if (!rect) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
    const target = e.target as HTMLElement
    // We let the window pointermove handle tracking
  }

  const openSearch = (query?: string) => {
    setIsSearchModalOpen(true)
    if (query?.trim()) {
      const trimmed = query.trim()
      setRecentSearches(prev => {
        const next = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 10)
        try { localStorage.setItem('pharmnet-recent-searches', JSON.stringify(next)) } catch {}
        return next
      })
      setSearchTrigger(prev => ({ value: trimmed, seq: (prev?.seq ?? 0) + 1 }))
    }
  }

  if (!rect) {
    return <div className="min-h-screen bg-[#808080]" /> // Avoid hydration mismatch
  }

  return (
    <div className="min-h-screen bg-[#808080] overflow-hidden">
      <div
        className="absolute flex flex-col bg-[#D4D0C8] font-mono text-xs select-none shadow-2xl border border-white border-r-[#808080] border-b-[#808080]"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {/* Resize Handles */}
        <div onPointerDown={handlePointerDown('n')} className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-20" />
        <div onPointerDown={handlePointerDown('s')} className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-20" />
        <div onPointerDown={handlePointerDown('e')} className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-20" />
        <div onPointerDown={handlePointerDown('w')} className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-20" />
        <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-20" />
        <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-20" />
        <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-20" />
        <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-20" />

        {/* Title bar */}
        <div 
          className="flex items-center justify-between bg-[#C85A00] text-white px-2 h-7 shrink-0 cursor-default"
          onPointerDown={handlePointerDown('move')}
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
          {/* App icon placeholder */}
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">Rx</div>
          <span className="text-sm font-bold font-mono tracking-tight">PharmNet Inpatient Formulary Manager</span>
        </div>
        <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">□</button>
          <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">✕</button>
        </div>
      </div>

      {/* Menu bar */}
      <div className="flex items-center gap-4 bg-[#D4D0C8] px-2 h-6 border-b border-[#808080] shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-xs font-mono px-1 hover:bg-[#316AC5] hover:text-white focus:outline-none">
              Task
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="rounded-none border-[#808080] bg-[#D4D0C8] p-0 font-mono text-xs min-w-[200px] shadow-[2px_2px_0_#000]"
          >
            <DropdownMenuItem
              className="rounded-none px-4 py-1 cursor-default hover:bg-[#316AC5] hover:text-white focus:bg-[#316AC5] focus:text-white"
              onSelect={() => setIsImportModalOpen(true)}
            >
              Import CSV Extract...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {["Edit", "View", "Help"].map((item) => (
          <button key={item} className="text-xs font-mono px-1 hover:bg-[#316AC5] hover:text-white">
            {item}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 bg-[#D4D0C8] px-2 py-1 border-b border-[#808080] shrink-0">
        <div className="flex gap-0.5 mr-1">
          {[..."📄💾✂️📋"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5 mr-1">
          {[..."🔍⚡"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5 mr-1">
          {[..."📊📋📦🏷️🔧📊"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        <div className="w-px h-5 bg-[#808080] mx-0.5" />
        <div className="flex gap-0.5">
          {["⬛"].map((icon, i) => (
            <ToolbarIcon key={i}>{icon}</ToolbarIcon>
          ))}
        </div>
        {/* Search area */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs font-mono">Search for:</span>
          <div className="flex items-center">
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchValue(""); return }
                if (e.key === "Enter") { openSearch(searchValue) }
              }}
              className="h-5 text-xs font-mono rounded-none border-[#808080] px-1 py-0 w-40 bg-white"
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue("")}
                className="h-5 w-4 flex items-center justify-center text-[10px] text-[#808080] bg-[#D4D0C8] border border-t-white border-l-white border-b-[#808080] border-r-[#808080] hover:text-black active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white shrink-0 cursor-default"
                title="Clear search (Esc)"
                tabIndex={-1}
              >
                ✕
              </button>
            )}
            <RecentSearchDropdown
              recentSearches={recentSearches}
              onSelect={s => {
                setSearchValue(s)
                openSearch(s)
              }}
              onClear={() => {
                setRecentSearches([])
                try { localStorage.removeItem('pharmnet-recent-searches') } catch {}
              }}
            />
          </div>
          <button
            onClick={() => openSearch(searchValue)}
            className="w-6 h-5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] flex items-center justify-center text-xs"
          >
            🔍
          </button>
        </div>
      </div>

      {/* Global fields area */}
      <FormularyHeader item={selectedItem} highlightedFields={headerDiffs} fieldValueMap={fieldValueMap} />

      {/* Domain status bar */}
      {prodDomains.length > 1 && selectedItemPreview && (
        <div className="flex items-center gap-2.5 px-3 py-1 bg-[#D4D0C8] border-b border-[#808080] shrink-0">
          {/* Horizontal segmented pill — W | C | E */}
          <div className="inline-flex rounded-sm overflow-hidden border border-[#808080] shrink-0">
            {REGION_ORDER.map((reg, i) => {
              const dk = `${reg}_prod`
              if (!prodDomains.includes(dk)) return null
              const { bg, text } = getDomainColor(reg, 'prod')
              const hasData = !!domainItems[dk]
              const isLoading = !!domainLoading[dk]
              const isBase = dk === baseDomain
              return (
                <button
                  key={dk}
                  onClick={() => hasData && !isLoading && setBaseDomain(dk)}
                  title={isBase ? `${dk} — active domain` : hasData ? `Switch to ${dk}` : isLoading ? 'Loading…' : 'No data'}
                  style={{
                    background: hasData ? bg : '#D0CCC4',
                    color: hasData ? text : '#909090',
                    boxShadow: isBase ? 'inset 0 0 0 2px rgba(255,255,255,0.85)' : 'none',
                    opacity: isLoading ? 0.6 : 1,
                  }}
                  className={`text-[9px] font-mono font-bold px-1.5 h-[18px] leading-none select-none flex items-center justify-center cursor-default${i > 0 ? ' border-l border-l-black/20' : ''}`}
                >
                  {isLoading ? '·' : getDomainBadge(reg, 'prod')}
                </button>
              )
            })}
          </div>
          <span className="text-[10px] font-mono text-[#808080]">
            {isAnyDomainLoading
              ? 'Loading domains…'
              : totalDiffs === 0 ? 'All domains match' : `${totalDiffs} field${totalDiffs !== 1 ? 's' : ''} differ`}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 px-3 pt-2 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
        {TABS.map((tab) => {
          const diffs = computeTabDiffs(domainItemsList, tab.id)
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-1.5 py-0.5 text-xs font-sans border-t border-l border-r border-[#808080] rounded-t-sm
                ${activeTab === tab.id
                  ? "bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px] shadow-sm pb-1"
                  : "bg-[#D4D0C8] hover:bg-[#E0DBD0] mt-0.5 border-b-[#808080]"
                }
              `}
            >
              {activeTab === tab.id ? <u>{tab.label}</u> : tab.label}
              {diffs.count > 0 && (
                <span className={`ml-1 text-[9px] px-1 rounded-full font-bold ${tab.id === 'inventory' ? 'bg-[#909090] text-white' : 'bg-amber-500 text-white'}`}>
                  *{diffs.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content area */}
      <div className="bg-[#D4D0C8] flex-1 flex flex-col border border-[#808080] mx-3 mb-2 overflow-hidden min-h-0">
        {activeTab === "oe-defaults" && <OEDefaultsTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'oe-defaults').fields} fieldValueMap={fieldValueMap} />}
        {activeTab === "dispense" && <DispenseTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'dispense').fields} fieldValueMap={fieldValueMap} />}
        {activeTab === "inventory" && <InventoryTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'inventory').fields} fieldValueMap={fieldValueMap} />}
        {activeTab === "clinical" && <ClinicalTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'clinical').fields} fieldValueMap={fieldValueMap} />}
        {activeTab === "supply" && <SupplyTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'supply').fields} fieldValueMap={fieldValueMap} domainRecords={domainRecords} />}
        {activeTab === "identifiers" && <IdentifiersTab item={selectedItem} highlightedFields={computeTabDiffs(domainItemsList, 'identifiers').fields} fieldValueMap={fieldValueMap} domainRecords={domainRecords} />}
        {activeTab === "tpn-details" && (
          <div className="p-4 text-xs font-mono text-[#808080]">TPN Details tab content</div>
        )}
        {activeTab === "change-log" && (
          <div className="p-4 text-xs font-mono text-[#808080]">Change Log tab content</div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center h-6 bg-[#D4D0C8] border-t border-[#808080] px-2 shrink-0" suppressHydrationWarning>
        <span className="flex-1 text-xs font-mono">Ready.</span>
        <div className="flex gap-0" suppressHydrationWarning>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center gap-1 hover:bg-[#316AC5] hover:text-white focus:outline-none">
                {scopeLabel(scope)} ▾
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs font-mono min-w-[160px]">
              <DropdownMenuItem onClick={() => setScope({ type: 'all' })}>
                All Domains
              </DropdownMenuItem>
              {availableDomains.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {availableDomains.map((d) => (
                    <DropdownMenuItem key={`${d.region}-${d.env}`} onClick={() => setScope({ type: 'domain', region: d.region, env: d.env })}>
                      {d.region} {d.env}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {[...new Set(availableDomains.map((d) => d.region))].map((r) => (
                    <DropdownMenuItem key={`region-${r}`} onClick={() => setScope({ type: 'region', region: r })}>
                      {r} (all)
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {[...new Set(availableDomains.map((d) => d.env))].map((e) => (
                    <DropdownMenuItem key={`env-${e}`} onClick={() => setScope({ type: 'env', env: e })}>
                      {e} (all regions)
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center">PESSK</span>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center" suppressHydrationWarning>{dateStr}</span>
          <span className="text-xs font-mono px-2 border-l border-[#808080] h-5 flex items-center" suppressHydrationWarning>{timeStr}</span>
        </div>
      </div>
      <SearchModal
        hidden={!isSearchModalOpen}
        searchTrigger={searchTrigger}
        scope={scope}
        availableDomains={availableDomains}
        onClose={() => setIsSearchModalOpen(false)}
        onSelect={(item) => {
          setSelectedItemPreview(item)
          setIsSearchModalOpen(false)

          const available = availableDomains.filter(d => d.env === 'prod').map(d => d.domain)
          if (available.length <= 1) return

          const initialLoading: Record<string, boolean> = {}
          available.forEach(dk => { initialLoading[dk] = true })
          setDomainLoading(initialLoading)
          setDomainItems({})
          setBaseDomain(null)

          const pyxisId      = item.identifiers?.pyxisId?.trim()      || undefined
          const chargeNumber = item.identifiers?.chargeNumber?.trim() || undefined
          const params = new URLSearchParams({ groupId: item.groupId })
          if (pyxisId)      params.set('pyxisId', pyxisId)
          if (chargeNumber) params.set('chargeNumber', chargeNumber)

          fetch(`/api/formulary/items?${params}`)
            .then(r => r.json())
            .then((data: { items: Record<string, FormularyItem> }) => {
              const newItems: Record<string, FormularyItem | null> = {}
              available.forEach(dk => { newItems[dk] = data.items[dk] ?? null })
              setDomainItems(newItems)
              const firstLoaded = available.find(dk => data.items[dk])
              if (firstLoaded) setBaseDomain(firstLoaded)
            })
            .catch(() => {
              const nullItems: Record<string, FormularyItem | null> = {}
              available.forEach(dk => { nullItems[dk] = null })
              setDomainItems(nullItems)
            })
            .finally(() => {
              const doneLoading: Record<string, boolean> = {}
              available.forEach(dk => { doneLoading[dk] = false })
              setDomainLoading(doneLoading)
            })
        }}
      />
      {isImportModalOpen && (
        <ImportModal onClose={() => setIsImportModalOpen(false)} />
      )}
    </div>
    </div>
  )
}
