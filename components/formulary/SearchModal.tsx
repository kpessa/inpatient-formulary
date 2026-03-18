"use client"

import { useState, useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FormularyItem } from "@/lib/types"
import type { SearchResult } from "@/app/api/formulary/search/route"

interface SearchModalProps {
  onClose: () => void
  initialSearchValue?: string
  onSelect: (item: FormularyItem) => void
}

const ALL_FACILITIES = [
  "A & G Logistics",
  "ABM Main",
  "Advanced Testing Solutions LLC Good will",
  "AIK- Spectra Laboratories",
  "AIK-ARCPoint",
  "AIK-BCN",
  "AIK-BnI",
  "AIK-BstnHrtDiag",
  "AIK-Cardiodx",
  "AIK-Dr.Page",
  "AIK-DRMBrickman",
  "AIK-LAB CORP",
  "AIK-LightBoA",
  "AIK-RadOnc",
  "AIK Centers",
  "AIKB Psych",
  "AIKE Emp Health",
  "AIKS - ER at Sweetwater",
  "Aiken County Human Resources",
  "Aiken County Sheriff's Office",
  "Aiken Professional Association, LLC",
  "Aiken Professional Billing",
  "Anchor Hospital-BH",
  "Brooke Glen Behavioral Hospital",
  "CHR- Main",
  "CHRB- Cedar Hill Regional Behavioral Hea",
  "EPBH FAIRMOUNT",
  "EPBH FAIRMOUNT RTC",
  "Fort Lauderdale Behavioral Health",
  "GW Hospital",
  "GW Psych",
  "GWU Liver and Pancreas",
  "GWU Spine and Pain",
  "GWU Transplant",
  "GWUW Wound",
  "Hampton Behavioral Health Center",
  "LWR Main",
  "MMH Main",
  "MMHB Psych",
  "Peachford Hospital-BH",
  "Psychiatric Institute of Washington",
  "Summit Ridge Hospital-BH",
  "UHS Corp",
  "UHSB",
  "UHST",
  "Windmoor Healthcare of Clearwater",
  "WRM Center",
]

const DEFAULT_COLUMNS = [
  { name: "Product Type", checked: false },
  { name: "Order Type", checked: true },
  { name: "Facility", checked: true },
  { name: "Charge Number", checked: true },
  { name: "Other", checked: false },
  { name: "Mnemonic", checked: true },
  { name: "Generic Name", checked: false },
  { name: "Strength / Form", checked: false },
  { name: "Description", checked: false },
  { name: "Brand Name", checked: true },
  { name: "1*", checked: true },
  { name: "NDC", checked: true },
  { name: "Inner NDC", checked: false },
  { name: "Brand Indicator", checked: false },
  { name: "Manufacturer", checked: true },
  { name: "Formulary Status", checked: true },
  { name: "QOH Location 1", checked: false },
  { name: "QOH Location 2", checked: false },
]

export function SearchModal({ onClose, initialSearchValue = "", onSelect }: SearchModalProps) {
  const [activeTab, setActiveTab] = useState("main")
  const [searchValue, setSearchValue] = useState(initialSearchValue)

  // Results state
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  // Columns: unified label + width, order is mutable
  const [cols, setCols] = useState([
    { id: "order",       label: "Order...",          width: 90  },
    { id: "facility",    label: "Facility",           width: 100 },
    { id: "charge",      label: "Charge Nu...",       width: 100 },
    { id: "pyxis",       label: "Pyxis Interface ID", width: 120 },
    { id: "mnemonic",    label: "Mnemonic",           width: 90  },
    { id: "generic",     label: "Generic Name",       width: 140 },
    { id: "strength",    label: "Strength / Form",    width: 110 },
    { id: "description", label: "Description",        width: 160 },
    { id: "brand",       label: "Brand Name",         width: 100 },
  ])
  const resizingCol = useRef<{ idx: number; startX: number; startWidth: number } | null>(null)
  // Drag-to-reorder
  const [colDrag, setColDrag] = useState<{ from: number; to: number } | null>(null)
  const colDragRef = useRef<{ from: number; to: number; startX: number; colId: string } | null>(null)
  const [sortState, setSortState] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null)
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const tableRef = useRef<HTMLTableElement | null>(null)

  // Advanced tab state
  const [showIvSetFilter, setShowIvSetFilter] = useState(false)
  const [formularyStatusFilter, setFormularyStatusFilter] = useState(false)
  const [formularyStatusValue, setFormularyStatusValue] = useState("")
  const [showInactive, setShowInactive] = useState(false)
  const [showTpnOnly, setShowTpnOnly] = useState(false)
  const [availableFacs, setAvailableFacs] = useState<string[]>([])
  const [selectedFacs, setSelectedFacs] = useState<string[]>([...ALL_FACILITIES])
  const [highlightedAvail, setHighlightedAvail] = useState<string | null>(null)
  const [highlightedSel, setHighlightedSel] = useState<string | null>(null)

  // Settings tab state
  const [maxResults, setMaxResults] = useState(20)
  const [columns, setColumns] = useState(DEFAULT_COLUMNS)
  const [selectedColumnName, setSelectedColumnName] = useState<string | null>(null)

  // Modal position and sizing logic
  const [rect, setRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null)
  const isResizing = useRef<{ dir: string, startX: number, startY: number, startRect: { x: number, y: number, w: number, h: number } } | null>(null)

  // Center initially
  useEffect(() => {
    setRect({
      x: Math.max(0, (window.innerWidth - 850) / 2),
      y: Math.max(0, (window.innerHeight - 550) / 2),
      w: 850,
      h: 550
    })
  }, [])

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // Modal resize/move
      if (isResizing.current) {
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

        if (dir.includes('e')) newW = Math.max(700, startRect.w + dx)
        if (dir.includes('w')) {
          const potentialW = Math.max(700, startRect.w - dx)
          newX = startRect.x + (startRect.w - potentialW)
          newW = potentialW
        }
        if (dir.includes('s')) newH = Math.max(450, startRect.h + dy)
        if (dir.includes('n')) {
          const potentialH = Math.max(450, startRect.h - dy)
          newY = startRect.y + (startRect.h - potentialH)
          newH = potentialH
        }

        setRect({ x: newX, y: newY, w: newW, h: newH })
        return
      }

      // Column resize
      if (resizingCol.current) {
        const { idx, startX, startWidth } = resizingCol.current
        const dx = e.clientX - startX
        const newWidth = Math.max(40, startWidth + dx)
        setCols(prev => prev.map((c, j) => j === idx ? { ...c, width: newWidth } : c))
        return
      }

      // Column drag-to-reorder
      if (colDragRef.current) {
        let toIdx = colDragRef.current.from
        for (let i = 0; i < thRefs.current.length; i++) {
          const el = thRefs.current[i]
          if (!el) continue
          const r = el.getBoundingClientRect()
          if (e.clientX >= r.left && e.clientX < r.right) { toIdx = i; break }
        }
        const next = { ...colDragRef.current, to: toIdx }
        colDragRef.current = next
        setColDrag({ from: next.from, to: next.to })
      }
    }
    const handlePointerUp = (e: PointerEvent) => {
      if (isResizing.current) {
        isResizing.current = null
      }
      if (resizingCol.current) {
        resizingCol.current = null
      }
      if (colDragRef.current) {
        const { from, to, startX, colId } = colDragRef.current
        if (Math.abs(e.clientX - startX) < 5) {
          // Click: toggle sort on this column
          setSortState(prev =>
            prev?.colId === colId
              ? { colId, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
              : { colId, dir: 'asc' }
          )
        } else if (from !== to) {
          setCols(prev => {
            const next = [...prev]
            const [removed] = next.splice(from, 1)
            next.splice(to, 0, removed)
            return next
          })
        }
        colDragRef.current = null
        setColDrag(null)
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
  }

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const autoFitColumn = (colIdx: number) => {
    if (!tableRef.current) return

    // Create a hidden probe span to measure text at the exact font used in cells
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:nowrap'
    document.body.appendChild(probe)

    // Match font from an actual body cell (or fall back to table style)
    const firstTd = tableRef.current.querySelector('tbody td')
    probe.style.font = firstTd
      ? window.getComputedStyle(firstTd).font
      : '12px ui-monospace, SFMono-Regular, monospace'

    let maxWidth = 40

    // Measure header label text
    const th = thRefs.current[colIdx]
    if (th) {
      const span = th.querySelector('span')
      probe.textContent = span?.textContent ?? ''
      // 16px cell padding + 8px resize handle clearance
      maxWidth = Math.max(maxWidth, probe.offsetWidth + 24)
    }

    // Measure every visible body cell in this column
    tableRef.current.querySelectorAll('tbody tr').forEach(row => {
      const cell = row.querySelectorAll('td')[colIdx + 1] // +1 skips the icon column
      if (!cell) return
      probe.textContent = cell.textContent ?? ''
      // 16px cell padding + 4px buffer
      maxWidth = Math.max(maxWidth, probe.offsetWidth + 20)
    })

    document.body.removeChild(probe)
    setCols(prev => prev.map((c, j) => j === colIdx ? { ...c, width: maxWidth } : c))
  }

  const handleSearch = async () => {
    setIsLoading(true)
    setSelectedGroupId(null)
    try {
      const params = new URLSearchParams({ q: searchValue, limit: String(maxResults) })
      if (selectedFacs.length < ALL_FACILITIES.length) {
        params.set("facilities", selectedFacs.join(","))
      }
      if (!showInactive) params.set("showInactive", "false")
      const res = await fetch(`/api/formulary/search?${params}`)
      const data = await res.json()
      setResults(data.results)
      setTotal(data.total)
    } finally {
      setIsLoading(false)
    }
  }

  const handleOkForGroup = async (groupId: string) => {
    const res = await fetch(`/api/formulary/item?groupId=${encodeURIComponent(groupId)}`)
    const data = await res.json()
    if (data.item) {
      onSelect(data.item)
    }
    onClose()
  }

  const handleOk = async () => {
    if (selectedGroupId) {
      await handleOkForGroup(selectedGroupId)
    } else {
      onClose()
    }
  }

  // Facilities dual-list handlers
  const handleAddFacility = () => {
    if (!highlightedAvail) return
    setSelectedFacs(prev => [...prev, highlightedAvail].sort())
    setAvailableFacs(prev => prev.filter(f => f !== highlightedAvail))
    setHighlightedAvail(null)
  }

  const handleRemoveFacility = () => {
    if (!highlightedSel) return
    setAvailableFacs(prev => [...prev, highlightedSel].sort())
    setSelectedFacs(prev => prev.filter(f => f !== highlightedSel))
    setHighlightedSel(null)
  }

  const handleSelectAllFacilities = () => {
    setSelectedFacs(prev => [...prev, ...availableFacs].sort())
    setAvailableFacs([])
    setHighlightedAvail(null)
  }

  // Settings column handlers
  const handleColumnCheck = (name: string, checked: boolean) => {
    setColumns(prev => prev.map(c => c.name === name ? { ...c, checked } : c))
  }

  const handleColumnMoveUp = () => {
    if (!selectedColumnName) return
    setColumns(prev => {
      const idx = prev.findIndex(c => c.name === selectedColumnName)
      if (idx <= 0) return prev
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }

  const handleColumnMoveDown = () => {
    if (!selectedColumnName) return
    setColumns(prev => {
      const idx = prev.findIndex(c => c.name === selectedColumnName)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  const getSortValue = (r: SearchResult, colId: string): string => {
    switch (colId) {
      case "order":       return r.formularyStatus
      case "facility":    return r.activeFacilities[0] ?? ""
      case "charge":      return r.chargeNumber
      case "pyxis":       return r.pyxisId
      case "mnemonic":    return r.mnemonic
      case "generic":     return r.genericName
      case "strength":    return `${r.strength} ${r.strengthUnit} ${r.dosageForm}`.trim()
      case "description": return r.description
      case "brand":       return r.brandName
      default:            return ""
    }
  }

  const sortedResults = sortState
    ? [...results].sort((a, b) => {
        const av = getSortValue(a, sortState.colId).toLowerCase()
        const bv = getSortValue(b, sortState.colId).toLowerCase()
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortState.dir === 'asc' ? cmp : -cmp
      })
    : results

  if (!rect) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto overflow-hidden">
      {/* Dimmed background overlay */}
      <div className="absolute inset-0" />

      <div
        className="absolute flex flex-col bg-[#D4D0C8] font-sans text-xs select-none shadow-[2px_2px_0px_#000000,-1px_-1px_0px_#FFFFFF] border border-[#808080]"
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
          className="flex items-center justify-between bg-[#E69138] text-white px-2 h-7 shrink-0"
          onPointerDown={handlePointerDown('move')}
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
            <div className="w-4 h-4 bg-white border border-white/40 flex items-center justify-center text-[8px] rounded-full text-blue-500 shadow-sm leading-none pt-0.5">💊</div>
            <span className="text-sm font-bold tracking-wide">Product Search</span>
          </div>
          <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
            <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
            <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">□</button>
            <button onClick={onClose} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none active:bg-[#808080]">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-2 pt-2 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
          {[
            { id: "main", label: "Main" },
            { id: "advanced", label: "Advanced" },
            { id: "settings", label: "Settings" }
          ].map(tab => (
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
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="p-2 flex-1 flex flex-col gap-2 overflow-hidden min-h-0 bg-[#F0F0F0]">

          {/* ── MAIN TAB ─────────────────────────────────────────── */}
          {activeTab === "main" && (
            <>
              {/* Top Section: Group Boxes */}
              <div className="flex gap-2 shrink-0">
                {/* Identifiers */}
                <fieldset className="border border-gray-300 p-2 pt-3 relative flex-1">
                  <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Identifiers</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {["Generic name", "Brand name", "Mnemonic", "Description", "Charge number", "NDC"].map(label => (
                      <label key={label} className="flex items-center gap-1 cursor-pointer">
                        <Checkbox defaultChecked className="h-3 w-3 rounded-none border-[#808080] bg-white outline-none ring-0 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
                        <span>{label}</span>
                      </label>
                    ))}
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <Checkbox defaultChecked className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
                        <span>Other:</span>
                      </label>
                      <span className="text-red-600 font-bold">*</span>
                      <Select defaultValue="pyxis">
                        <SelectTrigger className="h-5 py-0 px-1 text-xs font-sans rounded-none border-[#808080] bg-white w-32 border shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="text-xs font-sans rounded-none">
                          <SelectItem value="pyxis">Pyxis Interface ID</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </fieldset>

                <div className="flex flex-col gap-2 shrink-0 w-56">
                  {/* Product Type */}
                  <fieldset className="border border-gray-300 p-2 pt-3 relative">
                    <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Product Type</legend>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      {["Product", "IV Set", "Compound"].map(label => (
                        <label key={label} className="flex items-center gap-1 cursor-pointer">
                          <Checkbox defaultChecked className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
                          <span>{label}</span>
                        </label>
                      ))}
                      <label className="flex items-center gap-1 cursor-pointer">
                        <Checkbox className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
                        <span>Order Set</span>
                      </label>
                    </div>
                  </fieldset>

                  {/* Order Type */}
                  <fieldset className="border border-gray-300 p-2 pt-3 relative">
                    <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Order Type</legend>
                    <div className="flex gap-x-3 gap-y-1 flex-wrap">
                      {["Medication", "Intermittent", "Continuous"].map(label => (
                        <label key={label} className="flex items-center gap-1 cursor-pointer">
                          <Checkbox defaultChecked className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </div>

              {/* Search Bar */}
              <div className="flex items-center gap-2 mt-1 shrink-0 px-1">
                <span className="text-xs">Search for:</span>
                <Input
                  value={searchValue}
                  onChange={e => setSearchValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSearch() }}
                  className="h-5 text-xs font-sans rounded-none border-t-[#808080] border-l-[#808080] border-b-white border-r-white border px-1 py-0 w-64 bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <button
                  onClick={handleSearch}
                  className="h-6 px-4 border border-[#808080] text-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center text-xs ml-auto shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                >
                  Search
                </button>
              </div>

              {/* Results hint */}
              {total > 0 && total > results.length && (
                <div className="px-1 text-xs text-[#808080] shrink-0">
                  Showing {results.length} of {total} results. Refine your search to see more.
                </div>
              )}

              {/* Table */}
              <div className="flex-1 border border-[#808080] bg-white mt-1 overflow-auto shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                <table ref={tableRef} className="table-fixed w-max min-w-full text-left border-collapse whitespace-nowrap">
                  <colgroup>
                    <col style={{ width: 24 }} />
                    {cols.map((c) => <col key={c.id} style={{ width: c.width }} />)}
                  </colgroup>
                  <thead className="bg-[#EAEAEA] sticky top-0 z-10 border-b border-[#808080]">
                    <tr>
                      <th className="border-r border-b border-[#C0C0C0] px-1 font-normal text-center bg-gradient-to-b from-white to-[#EAEAEA] shadow-[inset_-1px_-1px_0_#A0A0A0]"></th>
                      {cols.map((col, i) => {
                        const isDragging = colDrag?.from === i
                        const isDropTarget = colDrag !== null && colDrag.to === i && colDrag.from !== i
                        return (
                          <th
                            key={col.id}
                            ref={el => { thRefs.current[i] = el }}
                            className={[
                              "relative border-r border-b border-[#C0C0C0] px-2 py-0.5 font-normal text-xs bg-gradient-to-b from-white to-[#EAEAEA] shadow-[inset_-1px_-1px_0_#A0A0A0] overflow-hidden select-none",
                              isDragging ? "opacity-40" : "",
                              isDropTarget ? "border-l-2 border-l-[#316AC5]" : "",
                            ].join(" ")}
                          >
                            {/* Drag-to-reorder grab area */}
                            <span
                              className={`block truncate pr-2 ${colDrag ? "cursor-grabbing" : "cursor-grab"}`}
                              onPointerDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                colDragRef.current = { from: i, to: i, startX: e.clientX, colId: col.id }
                                setColDrag({ from: i, to: i })
                              }}
                            >
                              {col.label}
                              {sortState?.colId === col.id && (
                                <span className="ml-1 text-[10px]">{sortState.dir === 'asc' ? '▲' : '▼'}</span>
                              )}
                            </span>
                            {/* Resize handle */}
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-[#316AC5]/40 active:bg-[#316AC5]/60 z-10"
                              onPointerDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                resizingCol.current = { idx: i, startX: e.clientX, startWidth: col.width }
                              }}
                              onDoubleClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                autoFitColumn(i)
                              }}
                            />
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={cols.length + 1} className="px-2 py-1 text-center text-[#808080]">Searching...</td>
                      </tr>
                    ) : results.length === 0 && total === 0 && !isLoading ? (
                      <tr>
                        <td colSpan={cols.length + 1} className="px-2 py-1 text-center text-[#808080]">
                          {searchValue ? "No results found." : "Enter a search term and click Search."}
                        </td>
                      </tr>
                    ) : (
                      sortedResults.map((r, idx) => {
                        const isSelected = selectedGroupId === r.groupId
                        const strengthForm = [r.strength, r.strengthUnit, r.dosageForm].filter(Boolean).join(" ").trim()
                        const facCount = r.activeFacilities.length
                        const facDisplay = facCount === 0 ? "" : facCount === 1 ? r.activeFacilities[0] : "Multiple"
                        return (
                          <tr
                            key={r.groupId}
                            onClick={() => setSelectedGroupId(r.groupId)}
                            onDoubleClick={() => { setSelectedGroupId(r.groupId); handleOkForGroup(r.groupId) }}
                            className={`border-b border-[#E0E0E0] cursor-pointer ${
                              isSelected
                                ? "bg-[#316AC5] text-white"
                                : idx % 2 === 0
                                ? "bg-white hover:bg-[#F0F8FF]"
                                : "bg-[#F8F8F8] hover:bg-[#F0F8FF]"
                            }`}
                          >
                            <td className="px-1 py-0 text-center"><span className="text-[10px] text-gray-500">▦</span></td>
                            {cols.map(col => {
                              switch (col.id) {
                                case "order":
                                  return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.formularyStatus}</td>
                                case "facility":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 relative group overflow-hidden">
                                      {facCount > 1 ? (
                                        <>
                                          <span className={`underline decoration-dashed ${isSelected ? "decoration-white bg-[#4a7fd4]" : "decoration-[#808080] bg-[#FFFFE1]"} px-1`}>Multiple</span>
                                          <div className="hidden group-hover:block absolute left-0 top-full bg-[#FFFFE1] border border-black p-1 shadow z-50 min-w-[120px] text-black">
                                            {r.activeFacilities.map(f => <div key={f}>{f}</div>)}
                                          </div>
                                        </>
                                      ) : (
                                        <span>{facDisplay}</span>
                                      )}
                                    </td>
                                  )
                                case "charge":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 overflow-hidden">
                                      {r.chargeNumber && (
                                        <span className="flex items-center gap-1.5">
                                          <div className={`w-2 h-2 border ${isSelected ? "bg-white border-white" : "bg-red-500 border-red-800"}`}></div>
                                          {r.chargeNumber}
                                        </span>
                                      )}
                                    </td>
                                  )
                                case "pyxis":       return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.pyxisId}</td>
                                case "mnemonic":    return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.mnemonic}</td>
                                case "generic":     return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.genericName}</td>
                                case "strength":    return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{strengthForm}</td>
                                case "description": return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.description}</td>
                                case "brand":       return <td key={col.id} className="px-2 py-0.5 overflow-hidden truncate">{r.brandName}</td>
                                default:            return <td key={col.id} />
                              }
                            })}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── ADVANCED TAB ─────────────────────────────────────── */}
          {activeTab === "advanced" && (
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              {/* Other */}
              <fieldset className="border border-[#808080] px-3 pb-2 pt-1 relative shrink-0 bg-white shadow-[inset_1px_1px_0_#FFFFFF]">
                <legend className="px-1 text-xs bg-white">Other</legend>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={showIvSetFilter}
                      onCheckedChange={v => setShowIvSetFilter(!!v)}
                      className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]"
                    />
                    <span>Items in an IV Set, Order Set, or Compound</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      checked={formularyStatusFilter}
                      onCheckedChange={v => setFormularyStatusFilter(!!v)}
                      className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]"
                    />
                    <span>Formulary status:</span>
                    <span className="text-red-600 font-bold">*</span>
                    <Select
                      value={formularyStatusValue}
                      onValueChange={setFormularyStatusValue}
                    >
                      <SelectTrigger className="h-5 py-0 px-1 text-xs font-sans rounded-none border-[#808080] bg-white w-44 border shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                        <SelectValue placeholder="" />
                      </SelectTrigger>
                      <SelectContent className="text-xs font-sans rounded-none">
                        <SelectItem value="formulary">Formulary</SelectItem>
                        <SelectItem value="non-formulary">Non-Formulary</SelectItem>
                        <SelectItem value="restricted">Restricted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={showInactive}
                      onCheckedChange={v => setShowInactive(!!v)}
                      className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]"
                    />
                    <span>Show inactive products, IV Sets, Order Sets or Compounds</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={showTpnOnly}
                      onCheckedChange={v => setShowTpnOnly(!!v)}
                      className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]"
                    />
                    <span>Show TPN products only</span>
                  </label>
                </div>
              </fieldset>

              {/* Facilities */}
              <fieldset className="border border-[#808080] px-3 pb-2 pt-1 relative flex-1 min-h-0 bg-white shadow-[inset_1px_1px_0_#FFFFFF] flex flex-col">
                <legend className="px-1 text-xs bg-white">Facilities</legend>
                <div className="flex gap-3 flex-1 min-h-0">
                  {/* Available list */}
                  <div className="flex flex-col flex-1 min-h-0 min-w-0">
                    <span className="text-xs mb-1">Available:</span>
                    <div className="flex-1 border border-[#808080] bg-white overflow-y-auto shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                      {availableFacs.map(fac => (
                        <div
                          key={fac}
                          onClick={() => setHighlightedAvail(fac)}
                          className={`px-1.5 py-0.5 cursor-pointer text-xs ${highlightedAvail === fac ? "bg-[#316AC5] text-white" : "hover:bg-[#E8F0FE]"}`}
                        >
                          {fac}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="flex flex-col justify-center gap-1.5 shrink-0">
                    <button
                      onClick={handleAddFacility}
                      className="h-6 px-3 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50"
                      disabled={!highlightedAvail}
                    >
                      Add &gt;
                    </button>
                    <button
                      onClick={handleRemoveFacility}
                      className="h-6 px-3 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50"
                      disabled={!highlightedSel}
                    >
                      &lt; Remove
                    </button>
                    <button
                      onClick={handleSelectAllFacilities}
                      className="h-6 px-3 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50"
                      disabled={availableFacs.length === 0}
                    >
                      Select All
                    </button>
                  </div>

                  {/* Selected list */}
                  <div className="flex flex-col flex-1 min-h-0 min-w-0">
                    <span className="text-xs mb-1">Selected:</span>
                    <div className="flex-1 border border-[#808080] bg-white overflow-y-auto shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                      {selectedFacs.map(fac => (
                        <div
                          key={fac}
                          onClick={() => setHighlightedSel(fac)}
                          className={`px-1.5 py-0.5 cursor-pointer text-xs ${highlightedSel === fac ? "bg-[#316AC5] text-white" : "hover:bg-[#E8F0FE]"}`}
                        >
                          {fac}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </fieldset>
            </div>
          )}

          {/* ── SETTINGS TAB ─────────────────────────────────────── */}
          {activeTab === "settings" && (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              {/* Results */}
              <fieldset className="border border-[#808080] px-3 pb-2 pt-1 relative shrink-0 bg-white shadow-[inset_1px_1px_0_#FFFFFF]">
                <legend className="px-1 text-xs bg-white">Results</legend>
                <div className="flex items-center gap-1.5">
                  <span>Return at most</span>
                  <span className="text-red-600 font-bold">*</span>
                  <input
                    type="number"
                    value={maxResults}
                    min={1}
                    max={999}
                    onChange={e => setMaxResults(Number(e.target.value))}
                    className="w-14 h-5 text-xs px-1 border border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] focus:outline-none"
                  />
                  <span>products at a time.</span>
                </div>
              </fieldset>

              {/* Spreadsheet Columns */}
              <fieldset className="border border-[#808080] px-3 pb-2 pt-1 relative flex-1 min-h-0 bg-white shadow-[inset_1px_1px_0_#FFFFFF] flex flex-col">
                <legend className="px-1 text-xs bg-white">Spreadsheet Columns</legend>
                <div className="flex gap-3 flex-1 min-h-0">
                  {/* Column checklist */}
                  <div className="flex-1 border border-[#808080] bg-white overflow-y-auto shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] min-h-0">
                    {columns.map(col => (
                      <div
                        key={col.name}
                        onClick={() => setSelectedColumnName(col.name)}
                        className={`flex items-center gap-2 px-2 py-0.5 cursor-pointer ${selectedColumnName === col.name ? "bg-[#316AC5] text-white" : "hover:bg-[#E8F0FE]"}`}
                      >
                        <Checkbox
                          checked={col.checked}
                          onCheckedChange={v => handleColumnCheck(col.name, !!v)}
                          onClick={e => e.stopPropagation()}
                          className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)] shrink-0"
                        />
                        <span className="text-xs">{col.name}</span>
                      </div>
                    ))}
                  </div>

                  {/* Up/Down buttons */}
                  <div className="flex flex-col justify-start pt-2 gap-1.5 shrink-0">
                    <button
                      onClick={handleColumnMoveUp}
                      className="w-7 h-7 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] flex items-center justify-center shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50"
                      disabled={!selectedColumnName || columns.findIndex(c => c.name === selectedColumnName) <= 0}
                      title="Move up"
                    >
                      <span className="text-xs leading-none">▲</span>
                    </button>
                    <button
                      onClick={handleColumnMoveDown}
                      className="w-7 h-7 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] flex items-center justify-center shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50"
                      disabled={!selectedColumnName || columns.findIndex(c => c.name === selectedColumnName) >= columns.length - 1}
                      title="Move down"
                    >
                      <span className="text-xs leading-none">▼</span>
                    </button>
                  </div>
                </div>
              </fieldset>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-2 pl-3 shrink-0 border-t border-[#808080] bg-[#F0F0F0]">
          <label className="flex items-center gap-1 cursor-pointer">
            <Checkbox className="h-3 w-3 rounded-none border-[#808080] bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]" />
            <span>Show all manufacturers</span>
          </label>
          <div className="flex gap-2 pr-2">
            <button
              onClick={handleOk}
              className="h-6 w-20 border border-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
            >
              {activeTab === "settings" ? "Save" : "OK"}
            </button>
            <button onClick={onClose} className="h-6 w-20 border border-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]">
              Cancel
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
