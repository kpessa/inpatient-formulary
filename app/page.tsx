"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { OEDefaultsTab } from "@/components/formulary/OEDefaultsTab"
import { DispenseTab } from "@/components/formulary/DispenseTab"
import { InventoryTab } from "@/components/formulary/InventoryTab"
import { ClinicalTab } from "@/components/formulary/ClinicalTab"
import { SupplyTab } from "@/components/formulary/SupplyTab"
import { IdentifiersTab } from "@/components/formulary/IdentifiersTab"
import { FormField } from "@/components/formulary/FormField"
import { SearchModal } from "@/components/formulary/SearchModal"
import { ImportModal } from "@/components/formulary/ImportModal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { FormularyItem } from "@/lib/types"

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
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<FormularyItem | null>(null)
  const [dateStr, setDateStr] = useState<string | null>(null)
  const [timeStr, setTimeStr] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>({ type: 'all' })
  const [availableDomains, setAvailableDomains] = useState<{ region: string; env: string; domain: string }[]>([])

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
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setIsSearchModalOpen(true)
              }
            }}
            className="h-5 text-xs font-mono rounded-none border-[#808080] px-1 py-0 w-40 bg-white"
          />
          <button onClick={() => setIsSearchModalOpen(true)} className="w-6 h-5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] flex items-center justify-center text-xs">
            🔍
          </button>
        </div>
      </div>

      {/* Global fields area */}
      <div className="px-3 py-2 bg-[#D4D0C8] border-b border-[#808080] shrink-0">
        {/* Row 1: Description / Strength / Status / Therapeutic Substitutions */}
        <div className="flex gap-3 items-end mb-2">
          <FormField label="Description:" required className="flex-1 min-w-0 max-w-[220px]">
            <Input
              value={selectedItem?.description ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Strength:" required className="w-28">
            <Input
              value={selectedItem ? `${selectedItem.strength} ${selectedItem.strengthUnit}`.trim() : ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Status:" className="w-28">
            <Input
              value={selectedItem?.status ?? ""}
              disabled
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
            />
          </FormField>
          <div className="flex items-start gap-1 pb-0.5 ml-2">
            <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="text-xs font-mono leading-tight">Therapeutic<br />Substitutions</span>
          </div>
        </div>

        {/* Row 2: Generic / Dosage form / Legal status / Mnemonic */}
        <div className="flex gap-3 items-end">
          <FormField label="Generic:" required className="flex-1 min-w-0 max-w-[220px]">
            <Input
              value={selectedItem?.genericName ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Dosage form:" required className="w-28">
            <Input
              value={selectedItem?.dosageForm ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Legal status:" required className="w-28">
            <Input
              value={selectedItem?.legalStatus ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
          <FormField label="Mnemonic:" required className="flex-1 min-w-0 max-w-[140px]">
            <Input
              value={selectedItem?.mnemonic ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
            />
          </FormField>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-3 pt-2 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
        {TABS.map((tab) => (
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
          </button>
        ))}
      </div>

      {/* Tab content area */}
      <div className="bg-[#D4D0C8] flex-1 flex flex-col border border-[#808080] mx-3 mb-2 overflow-hidden min-h-0">
        {activeTab === "oe-defaults" && <OEDefaultsTab item={selectedItem} />}
        {activeTab === "dispense" && <DispenseTab item={selectedItem} />}
        {activeTab === "inventory" && <InventoryTab item={selectedItem} />}
        {activeTab === "clinical" && <ClinicalTab item={selectedItem} />}
        {activeTab === "supply" && <SupplyTab item={selectedItem} />}
        {activeTab === "identifiers" && <IdentifiersTab item={selectedItem} />}
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
      {isSearchModalOpen && (
        <SearchModal
          initialSearchValue={searchValue}
          scope={scope}
          availableDomains={availableDomains}
          onClose={() => setIsSearchModalOpen(false)}
          onSelect={(item) => { setSelectedItem(item); setIsSearchModalOpen(false) }}
        />
      )}
      {isImportModalOpen && (
        <ImportModal onClose={() => setIsImportModalOpen(false)} />
      )}
    </div>
    </div>
  )
}
