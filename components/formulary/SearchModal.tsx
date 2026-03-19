"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { FormularyItem } from "@/lib/types"
import type { SearchResult } from "@/app/api/formulary/search/route"

type UnifiedResult = SearchResult & { _allDomains: string[] }

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

interface SearchModalProps {
  onClose: () => void
  initialSearchValue?: string
  scope: Scope
  availableDomains: { region: string; env: string; domain: string }[]
  onSelect: (item: FormularyItem) => void
}

const CACHE_VERSION = 'v2'
const LS_CACHE_PREFIX = `pharmnet-search-cache:${CACHE_VERSION}:`

const CORP_FACILITIES = new Set(["UHS Corp", "UHST", "UHSB"])

const DOMAIN_PRIORITY: Record<string, number> = {
  east_prod: 1, west_prod: 2, central_prod: 3,
  east_cert: 4, west_cert: 5, central_cert: 6,
  east_mock: 7, west_mock: 8, central_mock: 9,
  east_build: 10, west_build: 11, central_build: 12,
}
function getDomainKey(r: SearchResult): string { return `${r.region}_${r.environment}` }
function getDomainPriority(r: SearchResult): number { return DOMAIN_PRIORITY[getDomainKey(r)] ?? 99 }
function getDomainBadge(region: string, env: string): string {
  const letter = region === 'east' ? 'E' : region === 'west' ? 'W' : 'C'
  return env === 'prod' ? letter : letter.toLowerCase()
}


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

const IDENTIFIER_FIELDS = [
  { label: 'Description',        field: 'description'   as const },
  { label: 'Generic name',       field: 'generic_name'  as const },
  { label: 'Brand name',         field: 'brand_name'    as const },
  { label: 'Mnemonic',           field: 'mnemonic'      as const },
  { label: 'Charge number',      field: 'charge_number' as const },
  { label: 'NDC',                field: 'ndc'           as const },
  { label: 'Pyxis Interface ID', field: 'pyxis_id'      as const },
]

function classifyActiveFields(q: string, activeFields: Set<string>): Set<string> {
  const allDigits = /^\d+$/.test(q)
  const looksLikeNdc =
    (allDigits && q.length >= 10) ||
    /^\d{1,5}-\d{1,4}(-\d{0,2})?$/.test(q)

  let candidates: string[]
  if (looksLikeNdc) {
    candidates = ['ndc']
  } else if (allDigits) {
    candidates = ['charge_number', 'pyxis_id']
  } else {
    candidates = ['description', 'generic_name', 'brand_name', 'mnemonic']
  }
  return new Set(candidates.filter(f => activeFields.has(f)))
}

export function SearchModal({ onClose, initialSearchValue = "", scope: initialScope, availableDomains, onSelect }: SearchModalProps) {
  const [activeTab, setActiveTab] = useState("main")
  const [searchValue, setSearchValue] = useState(initialSearchValue)
  const [scope, setScope] = useState<Scope>(initialScope)
  const [activeFields, setActiveFields] = useState<Set<string>>(
    () => new Set(['description', 'generic_name', 'brand_name', 'mnemonic', 'charge_number', 'pyxis_id', 'ndc'])
  )

  const [isUnified, setIsUnified] = useState(true)

  const [detailsLoading, setDetailsLoading] = useState(false)

  // Fetch activeFacilities + searchMedication/Continuous/Intermittent for a result set.
  // Groups by (region, env) and fires one parallel inventory request per domain,
  // then merges the details back into the results state.
  const loadDetails = async (items: SearchResult[]) => {
    if (items.length === 0) return
    setDetailsLoading(true)
    try {
      const domainGroups = new Map<string, { groupIds: string[]; region: string; environment: string }>()
      for (const r of items) {
        const key = `${r.region}|${r.environment}`
        if (!domainGroups.has(key)) domainGroups.set(key, { groupIds: [], region: r.region, environment: r.environment })
        domainGroups.get(key)!.groupIds.push(r.groupId)
      }
      const fetches = [...domainGroups.values()].map(async ({ groupIds, region, environment }) => {
        const params = new URLSearchParams({ groupIds: groupIds.join(','), region, environment })
        const res = await fetch(`/api/formulary/inventory?${params}`)
        if (!res.ok) throw new Error(`inventory ${res.status}`)
        const data = await res.json() as Record<string, { activeFacilities: string[]; searchMedication: boolean; searchContinuous: boolean; searchIntermittent: boolean }>
        return { data, region, environment }
      })
      const detailResults = await Promise.all(fetches)
      const detailMap = new Map<string, typeof detailResults[0]['data'][string]>()
      for (const { data, region, environment } of detailResults) {
        for (const [groupId, detail] of Object.entries(data)) {
          detailMap.set(`${groupId}|${region}|${environment}`, detail)
        }
      }
      setResults(prev => prev.map(r => {
        const detail = detailMap.get(`${r.groupId}|${r.region}|${r.environment}`)
        return detail ? { ...r, ...detail } : r
      }))
    } catch (err) {
      console.error('loadDetails failed:', err)
    } finally {
      setDetailsLoading(false)
    }
  }

  // Per-field query status (parallel mode only)
  type FieldStatus = { state: 'loading' | 'done'; count: number; ms: number; limit: number }
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({})
  // Results state
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanding, setIsExpanding] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const [fromCachedAt, setFromCachedAt] = useState<number | null>(null)
  const searchCache = useRef<Map<string, { results: SearchResult[]; total: number; cachedAt: number }>>(new Map())
  const [total, setTotal] = useState(0)
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)
  const [selectedResultIdx, setSelectedResultIdx] = useState<number | null>(null)
  const [queryMs, setQueryMs] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState<number | null>(null)
  const searchStartRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Columns: unified label + width, order is mutable
  const [cols, setCols] = useState([
    { id: "domain",      label: "Domain",             width: 90  },
    { id: "order",       label: "Order...",            width: 90  },
    { id: "facility",    label: "Facility",            width: 100 },
    { id: "charge",      label: "Charge Nu...",        width: 100 },
    { id: "pyxis",       label: "Pyxis Interface ID",  width: 120 },
    { id: "mnemonic",    label: "Mnemonic",            width: 90  },
    { id: "generic",     label: "Generic Name",        width: 140 },
    { id: "strength",    label: "Strength / Form",     width: 110 },
    { id: "description", label: "Description",         width: 160 },
    { id: "brand",       label: "Brand Name",          width: 100 },
  ])
  const resizingCol = useRef<{ idx: number; startX: number; startWidth: number } | null>(null)
  // Drag-to-reorder
  const [colDrag, setColDrag] = useState<{ from: number; to: number } | null>(null)
  const colDragRef = useRef<{ from: number; to: number; startX: number; colId: string } | null>(null)
  const [sortState, setSortState] = useState<{ colId: string; dir: 'asc' | 'desc' } | null>(null)
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const tableRef = useRef<HTMLTableElement | null>(null)

  // Column filter state
  const [colFilters, setColFilters] = useState<Record<string, { text: string; selected: Set<string> }>>({})
  const [filterPanel, setFilterPanel] = useState<{ colId: string; x: number; y: number } | null>(null)
  const [filterPanelSearch, setFilterPanelSearch] = useState("")
  const filterPanelRef = useRef<HTMLDivElement | null>(null)

  // Advanced tab state
  const [showIvSetFilter, setShowIvSetFilter] = useState(false)
  const [formularyStatusFilter, setFormularyStatusFilter] = useState(false)
  const [formularyStatusValue, setFormularyStatusValue] = useState("")
  const [showInactive, setShowInactive] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem('pharmnet-search-settings')
      return s ? (JSON.parse(s).showInactive ?? false) : false
    } catch { return false }
  })
  const [showTpnOnly, setShowTpnOnly] = useState(false)
  const [allFacilities, setAllFacilities] = useState<string[]>([])
  const [facilitiesLoading, setFacilitiesLoading] = useState(true)
  const [availableFacs, setAvailableFacs] = useState<string[]>([])
  const [selectedFacs, setSelectedFacs] = useState<string[]>([])
  const [highlightedAvail, setHighlightedAvail] = useState<string | null>(null)
  const [highlightedSel, setHighlightedSel] = useState<string | null>(null)

  // Settings tab state — loaded from / saved to localStorage
  const [maxResults, setMaxResults] = useState<number>(() => {
    try {
      const s = localStorage.getItem('pharmnet-search-settings')
      return s ? (JSON.parse(s).maxResults ?? 50) : 50
    } catch { return 50 }
  })
  const [columns, setColumns] = useState<typeof DEFAULT_COLUMNS>(() => {
    try {
      const s = localStorage.getItem('pharmnet-search-settings')
      return s ? (JSON.parse(s).columns ?? DEFAULT_COLUMNS) : DEFAULT_COLUMNS
    } catch { return DEFAULT_COLUMNS }
  })
  const [selectedColumnName, setSelectedColumnName] = useState<string | null>(null)

  // Modal position and sizing logic
  const [rect, setRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const preMaxRect = useRef<{ x: number, y: number, w: number, h: number } | null>(null)
  const isResizing = useRef<{ dir: string, startX: number, startY: number, startRect: { x: number, y: number, w: number, h: number } } | null>(null)

  const toggleMaximize = () => {
    if (isMaximized) {
      setIsMaximized(false)
      if (preMaxRect.current) setRect(preMaxRect.current)
    } else {
      preMaxRect.current = rect
      setIsMaximized(true)
    }
  }

  // Load facilities from DB on mount
  useEffect(() => {
    fetch('/api/formulary/facilities')
      .then(r => r.json())
      .then(({ facilities }: { facilities: string[] }) => {
        setAllFacilities(facilities)
        setSelectedFacs(facilities)
      })
      .catch(() => {})
      .finally(() => setFacilitiesLoading(false))
  }, [])

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pharmnet-search-settings', JSON.stringify({ maxResults, columns, showInactive }))
    } catch {}
  }, [maxResults, columns, showInactive])

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
        const newWidth = Math.max(10, startWidth + dx)
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

  // Close filter panel on outside click
  useEffect(() => {
    if (!filterPanel) return
    const handleMouseDown = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setFilterPanel(null)
        setFilterPanelSearch("")
      }
    }
    document.addEventListener("mousedown", handleMouseDown)
    return () => document.removeEventListener("mousedown", handleMouseDown)
  }, [filterPanel])

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
    setSelectedResultIdx(null)
    setQueryMs(null)
    setFromCachedAt(null)
    setColFilters({})
    setElapsedSec(null)
    setFieldStatus({})
    const t0 = performance.now()
    searchStartRef.current = t0
    const showAfter = setTimeout(() => {
      setElapsedSec(1)
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((performance.now() - t0) / 1000))
      }, 1000)
    }, 1000)
    try {
      const hasFacilityFilter = selectedFacs.length < allFacilities.length
      const isWildcard = searchValue.includes('*')
      const useParallel = !hasFacilityFilter && !isWildcard && activeFields.size > 0 && searchValue.trim().length > 0

      // Base params shared by both paths
      const baseParams = new URLSearchParams({ q: searchValue, limit: String(maxResults) })
      if (hasFacilityFilter) baseParams.set("facilities", selectedFacs.join(","))
      if (!showInactive) baseParams.set("showInactive", "false")
      if (scope.type === 'domain') { baseParams.set('region', scope.region); baseParams.set('environment', scope.env) }
      else if (scope.type === 'region') baseParams.set('region', scope.region)
      else if (scope.type === 'env') baseParams.set('environment', scope.env)

      // For parallel path, classify which fields to actually query based on input format
      const fieldsToQuery = useParallel ? classifyActiveFields(searchValue, activeFields) : new Set<string>()

      // Stable cache key: sorted fields suffix for parallel, base params for single-query
      const cacheKey = useParallel
        ? `${baseParams}&fields=${[...fieldsToQuery].sort().join(',')}`
        : baseParams.toString()

      // L1: in-memory
      let cached = searchCache.current.get(cacheKey)
      // L2: localStorage
      if (!cached) {
        try {
          const raw = localStorage.getItem(LS_CACHE_PREFIX + cacheKey)
          if (raw) { cached = JSON.parse(raw); searchCache.current.set(cacheKey, cached!) }
        } catch { /* ignore */ }
      }

      if (cached) {
        setResults(cached.results)
        setTotal(cached.total)
        setFromCachedAt(cached.cachedAt)
        loadDetails(cached.results)
      } else if (useParallel) {
        // ── Parallel path: one fetch per field, results trickle in as each resolves ──
        if (fieldsToQuery.size === 0) {
          setResults([])
          setTotal(0)
          setQueryMs(Math.round(performance.now() - t0))
        } else {
        setResults([])
        setFieldStatus(Object.fromEntries([...fieldsToQuery].map(f =>
          [f, { state: 'loading' as const, count: 0, ms: 0, limit: maxResults }]
        )))

        const fieldResults: Record<string, SearchResult[]> = {}
        const fieldFetches = [...fieldsToQuery].map(field => {
          const fp = new URLSearchParams([...baseParams.entries(), ['fields', field]])
          return fetch(`/api/formulary/search?${fp}`)
            .then(r => r.text())
            .then(text => {
              const chunk = JSON.parse(text.trim()) as { field: string; results: SearchResult[]; ms: number; rawCount: number }
              fieldResults[chunk.field] = chunk.results
              setResults(prev => {
                const existingIds = new Set(prev.map(r => `${r.groupId}|${r.region}|${r.environment}`))
                const fresh = chunk.results.filter(r => !existingIds.has(`${r.groupId}|${r.region}|${r.environment}`))
                return [...prev, ...fresh]
              })
              setFieldStatus(prev => ({
                ...prev,
                [chunk.field]: { state: 'done', count: chunk.rawCount, ms: chunk.ms, limit: maxResults },
              }))
            })
        })

        await Promise.all(fieldFetches)

        // Deduplicate merged results for cache
        const seen = new Set<string>()
        const finalResults = Object.values(fieldResults).flat().filter(r => {
          const key = `${r.groupId}|${r.region}|${r.environment}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        const finalTotal = finalResults.length
        setTotal(finalTotal)
        setQueryMs(Math.round(performance.now() - t0))

        const entry = { results: finalResults, total: finalTotal, cachedAt: Date.now() }
        searchCache.current.set(cacheKey, entry)
        try { localStorage.setItem(LS_CACHE_PREFIX + cacheKey, JSON.stringify(entry)) } catch { /* quota */ }
        loadDetails(finalResults)
        } // end else (fieldsToQuery.size > 0)
      } else {
        // ── Single-query path: NDJSON stream (wildcard / facility filter) ─────
        const res = await fetch(`/api/formulary/search?${baseParams}`)
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let finalResults: SearchResult[] = []
        let finalTotal = 0
        outer: while (true) {
          const { done, value } = await reader.read()
          if (value) buf += decoder.decode(value, { stream: !done })
          const lines = buf.split('\n')
          buf = lines.pop()!
          for (const line of lines) {
            if (!line.trim()) continue
            const chunk = JSON.parse(line)
            if ('results' in chunk) { finalResults = chunk.results; finalTotal = chunk.total }
            else if ('total' in chunk) { setPendingTotal(chunk.total) }
          }
          if (done) break outer
        }
        const elapsed = Math.round(performance.now() - t0)
        const entry = { results: finalResults, total: finalTotal, cachedAt: Date.now() }
        searchCache.current.set(cacheKey, entry)
        try { localStorage.setItem(LS_CACHE_PREFIX + cacheKey, JSON.stringify(entry)) } catch { /* quota */ }
        setResults(finalResults)
        setTotal(finalTotal)
        setQueryMs(elapsed)
        loadDetails(finalResults)
      }
    } finally {
      clearTimeout(showAfter)
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
      setElapsedSec(null)
      setPendingTotal(null)
      setIsLoading(false)
    }
  }

  const getCellText = (colId: string, r: SearchResult): string => {
    switch (colId) {
      case 'domain':      return `${r.region}/${r.environment}`
      case 'order':       return [r.searchMedication ? 'M' : '', r.searchIntermittent ? 'I' : '', r.searchContinuous ? 'C' : ''].filter(Boolean).join('')
      case 'facility':    return r.activeFacilities.join(', ')
      case 'charge':      return r.chargeNumber
      case 'pyxis':       return r.pyxisId
      case 'mnemonic':    return r.mnemonic
      case 'generic':     return r.genericName
      case 'strength':    return [r.strength, r.strengthUnit, r.dosageForm].filter(Boolean).join(' ').trim()
      case 'description': return r.description
      case 'brand':       return r.brandName
      default:            return ''
    }
  }

  // Auto-kick search when modal opens with a pre-filled value
  useEffect(() => {
    if (initialSearchValue.trim()) handleSearch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpandSearch = async () => {
    setIsExpanding(true)
    try {
      const params = new URLSearchParams({ q: searchValue, limit: String(maxResults) })
      if (selectedFacs.length < allFacilities.length) {
        params.set("facilities", selectedFacs.join(","))
      }
      if (!showInactive) params.set("showInactive", "false")
      if (scope.type === 'domain') {
        params.set('region', scope.region)
        params.set('environment', scope.env)
      } else if (scope.type === 'region') {
        params.set('region', scope.region)
      } else if (scope.type === 'env') {
        params.set('environment', scope.env)
      }
      for (const [colId, filter] of Object.entries(colFilters)) {
        if (filter.text) params.set(`cft_${colId}`, filter.text)
        if ((filter.selected?.size ?? 0) > 0) params.set(`cfv_${colId}`, [...(filter.selected ?? new Set())].join(','))
      }
      const res = await fetch(`/api/formulary/search?${params}`)
      const data = await res.json()
      const existingIds = new Set(results.map(r => `${r.groupId}|${r.region}|${r.environment}`))
      const newOnes = (data.results as SearchResult[]).filter(r => !existingIds.has(`${r.groupId}|${r.region}|${r.environment}`))
      if (newOnes.length > 0) {
        const merged = [...results, ...newOnes]
        setResults(merged)
        setTotal(merged.length)
      } else {
        setTotal(results.length)
      }
    } finally {
      setIsExpanding(false)
    }
  }

  const handleOkForGroup = async (groupId: string) => {
    setIsSelecting(true)
    try {
      const res = await fetch(`/api/formulary/item?groupId=${encodeURIComponent(groupId)}`)
      const data = await res.json()
      if (data.item) {
        onSelect(data.item)
      }
      onClose()
    } finally {
      setIsSelecting(false)
    }
  }

  const handleOk = async () => {
    if (selectedResultIdx !== null) {
      const r = sortedResults[selectedResultIdx]
      if (r) await handleOkForGroup(r.groupId)
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
      case "domain":      return `${r.region} ${r.environment}`
      case "order":       return [r.searchMedication ? 'M' : '', r.searchIntermittent ? 'I' : '', r.searchContinuous ? 'C' : ''].join('')
      case "facility":    return String(r.activeFacilities.filter(f => !CORP_FACILITIES.has(f)).length).padStart(4, '0')
      case "charge":      return r.chargeNumber
      case "pyxis":       return r.pyxisId
      case "mnemonic":    return r.mnemonic
      case "generic":     return r.genericName
      case "strength": {
        const str = `${r.strength} ${r.strengthUnit} ${r.dosageForm}`.trim()
        const match = str.replace(/,(\d)/g, '$1').match(/(\d+(?:\.\d+)?)/)
        const num = match ? parseFloat(match[1]) : 0
        const [intPart, decPart] = num.toFixed(4).split('.')
        return intPart.padStart(8, '0') + '.' + decPart
      }
      case "description": return r.description
      case "brand":       return r.brandName
      default:            return ""
    }
  }

  const getFilterKey = (r: SearchResult, colId: string): string => {
    if (colId === 'strength') return r.dosageForm
    if (colId === 'facility') {
      const rf = r.activeFacilities.filter(f => !CORP_FACILITIES.has(f))
      if (rf.length === 0) return r.activeFacilities.length > 0 ? 'corp only' : ''
      if (rf.length === 1) return rf[0]
      return `${rf.length} facilities`
    }
    return getSortValue(r, colId)
  }

  const filteredResults = useMemo(() => {
    const activeFilters = Object.entries(colFilters).filter(
      ([, f]) => f.text || (f.selected?.size ?? 0) > 0
    )
    if (activeFilters.length === 0) return results
    return results.filter(r =>
      activeFilters.every(([colId, filter]) => {
        const cellVal = colId === 'facility'
          ? r.activeFacilities.filter(f => !CORP_FACILITIES.has(f)).join(' ').toLowerCase()
          : getSortValue(r, colId).toLowerCase()
        const textPass = !filter.text || cellVal.includes(filter.text.toLowerCase())
        const selectPass =
          (filter.selected?.size ?? 0) === 0 || (
            colId === 'facility'
              ? r.activeFacilities.filter(f => !CORP_FACILITIES.has(f)).some(f => filter.selected?.has(f))
              : filter.selected?.has(getFilterKey(r, colId)) ?? false
          )
        return textPass && selectPass
      })
    )
  }, [results, colFilters])

  const baseResults = useMemo((): UnifiedResult[] => {
    if (!isUnified) {
      return filteredResults.map(r => ({ ...r, _allDomains: [getDomainKey(r)] }))
    }
    const byGroupId = new Map<string, UnifiedResult>()
    for (const r of filteredResults) {
      const existing = byGroupId.get(r.groupId)
      if (!existing || getDomainPriority(r) < getDomainPriority(existing)) {
        byGroupId.set(r.groupId, {
          ...r,
          _allDomains: existing ? [...existing._allDomains, getDomainKey(r)] : [getDomainKey(r)],
        })
      } else {
        existing._allDomains.push(getDomainKey(r))
      }
    }
    return Array.from(byGroupId.values())
  }, [filteredResults, isUnified])

  const sortedResults = sortState
    ? [...baseResults].sort((a, b) => {
        const av = getSortValue(a, sortState.colId).toLowerCase()
        const bv = getSortValue(b, sortState.colId).toLowerCase()
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortState.dir === 'asc' ? cmp : -cmp
      })
    : baseResults

  // Filter panel computed values
  const fpFilter = filterPanel
    ? (colFilters[filterPanel.colId] ?? { text: "", selected: new Set<string>() })
    : null
  const fpAllValues = filterPanel
    ? filterPanel.colId === 'facility'
      ? [...new Set(results.flatMap(r => r.activeFacilities.filter(f => !CORP_FACILITIES.has(f))))].sort()
      : [...new Set(results.map(r => getFilterKey(r, filterPanel.colId)))].sort()
    : []
  const fpVisibleValues = filterPanel && filterPanelSearch
    ? fpAllValues.filter(v => v.toLowerCase().includes(filterPanelSearch.toLowerCase()))
    : fpAllValues
  const fpAllVisibleSelected =
    fpVisibleValues.length > 0 && fpFilter !== null &&
    fpVisibleValues.every(v => fpFilter!.selected.has(v))

  if (!rect) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto overflow-hidden">
      {/* Dimmed background overlay */}
      <div className="absolute inset-0" />

      <div
        className={`flex flex-col bg-[#D4D0C8] font-sans text-xs select-none border border-[#808080] ${isMaximized ? "absolute inset-0" : "absolute shadow-[2px_2px_0px_#000000,-1px_-1px_0px_#FFFFFF]"}`}
        style={isMaximized ? undefined : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        {/* Resize Handles — hidden when maximized */}
        {!isMaximized && <>
          <div onPointerDown={handlePointerDown('n')} className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-20" />
          <div onPointerDown={handlePointerDown('s')} className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-20" />
          <div onPointerDown={handlePointerDown('e')} className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-20" />
          <div onPointerDown={handlePointerDown('w')} className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-20" />
          <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-20" />
          <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-20" />
          <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-20" />
          <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-20" />
        </>}

        {/* Title bar */}
        <div
          className="flex items-center justify-between bg-[#E69138] text-white px-2 h-7 shrink-0"
          onPointerDown={isMaximized ? undefined : handlePointerDown('move')}
          onDoubleClick={toggleMaximize}
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
            <div className="w-4 h-4 bg-white border border-white/40 flex items-center justify-center text-[8px] rounded-full text-blue-500 shadow-sm leading-none pt-0.5">💊</div>
            <span className="text-sm font-bold tracking-wide">Product Search</span>
            <span className="text-xs font-mono opacity-80 ml-2">[{scopeLabel(scope)}]</span>
          </div>
          <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
            <button className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
            <button onClick={toggleMaximize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none active:bg-[#808080]">
              {isMaximized ? '❐' : '□'}
            </button>
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
              <div className="flex flex-col gap-2 shrink-0">
                {/* Identifiers */}
                <fieldset className="border border-gray-300 p-2 pt-3 relative">
                  <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Identifiers</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {IDENTIFIER_FIELDS.map(({ label, field }) => {
                      const fs = field ? fieldStatus[field] : undefined
                      return (
                        <label
                          key={label}
                          className={`flex items-center gap-1 ${field ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                        >
                          <Checkbox
                            checked={field ? activeFields.has(field) : false}
                            disabled={!field}
                            onCheckedChange={field ? (checked) => {
                              setActiveFields(prev => {
                                const next = new Set(prev)
                                if (checked) next.add(field)
                                else next.delete(field)
                                return next
                              })
                            } : undefined}
                            className="h-3 w-3 rounded-none border-[#808080] bg-white outline-none ring-0 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.3)]"
                          />
                          <span>{label}</span>
                          {fs?.state === 'loading' && (
                            <span className="text-[10px] text-[#808080] animate-pulse">…</span>
                          )}
                          {fs?.state === 'done' && (
                            <span className="text-[10px] text-[#808080]">
                              {fs.count >= fs.limit ? `${fs.count}+` : fs.count} · {fs.ms}ms
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                <div className="flex gap-2">
                  {/* Product Type */}
                  <fieldset className="border border-gray-300 p-2 pt-3 relative flex-1">
                    <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Product Type</legend>
                    <div className="flex gap-x-4 gap-y-1 flex-wrap">
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
                  <fieldset className="border border-gray-300 p-2 pt-3 relative flex-1">
                    <legend className="absolute -top-2 left-2 px-1 bg-[#F0F0F0] text-xs">Order Type</legend>
                    <div className="flex gap-x-4 gap-y-1 flex-wrap">
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
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (selectedResultIdx !== null) {
                        handleOk()
                      } else {
                        handleSearch()
                      }
                    }
                  }}
                  className="h-5 text-xs font-sans rounded-none border-t-[#808080] border-l-[#808080] border-b-white border-r-white border px-1 py-0 w-64 bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <span className="text-xs text-[#808080]">in:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-5 px-2 border border-[#808080] text-black bg-white text-xs flex items-center gap-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] hover:bg-[#E8E8E0] min-w-[90px] max-w-[140px] truncate">
                      {scopeLabel(scope)} ▾
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="text-xs font-mono min-w-[160px]">
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
                <button
                  onClick={handleSearch}
                  className="h-6 px-4 border border-[#808080] text-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center text-xs ml-auto shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                >
                  Search
                </button>
                <label className="flex items-center gap-1 text-xs cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={isUnified}
                    onChange={e => setIsUnified(e.target.checked)}
                    className="accent-[#316AC5]"
                  />
                  Unified
                </label>
              </div>

              {/* Status bar — fixed height, no layout shift */}
              <div className="h-5 px-1 shrink-0 flex items-center justify-between text-xs text-[#808080]">
                {isSelecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-3 border border-[#808080] bg-[#D4D0C8] overflow-hidden relative">
                      <div className="absolute top-0 bottom-0 w-10 bg-[#316AC5] animate-[marquee_1.4s_linear_infinite]" />
                    </div>
                    <span>Loading…</span>
                  </div>
                ) : isLoading ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-3 border border-[#808080] bg-[#D4D0C8] overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 w-10 bg-[#316AC5] animate-[marquee_1.4s_linear_infinite]" />
                      </div>
                      <span>{pendingTotal !== null ? `Found ${pendingTotal}${elapsedSec !== null ? ` — ${elapsedSec}s…` : ' — loading…'}` : elapsedSec !== null ? `${elapsedSec}s…` : 'Searching…'}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5">
                      {total > results.length
                        ? `Showing ${results.length} of ${total} results — refine to narrow.`
                        : results.length > 0
                        ? isUnified && baseResults.length < results.length
                          ? `${baseResults.length} unique (${results.length} total).`
                          : `${sortedResults.length} result${sortedResults.length !== 1 ? 's' : ''}.`
                        : queryMs !== null
                        ? 'No results found.'
                        : ''}
                      {results.length > 0 && filteredResults.length < results.length && (
                        <>
                          <span className="text-[#316AC5]">({filteredResults.length} filtered)</span>
                          <button
                            onClick={() => setColFilters({})}
                            className="text-[#316AC5] hover:text-red-600 font-bold leading-none"
                            title="Clear all column filters"
                          >
                            ×
                          </button>
                          {total > results.length && (
                            <button
                              onClick={handleExpandSearch}
                              className="text-[#316AC5] hover:underline text-[10px]"
                              title="Re-run search with these column filters applied at the database level to find more matches"
                            >
                              Expand in DB ↻
                            </button>
                          )}
                        </>
                      )}
                    </span>
                    {detailsLoading ? (
                      <span className="text-[10px] text-[#808080] animate-pulse font-mono">loading details…</span>
                    ) : isExpanding ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-2 border border-[#808080] bg-[#D4D0C8] overflow-hidden relative">
                          <div className="absolute top-0 bottom-0 w-5 bg-[#316AC5] animate-[marquee_1.4s_linear_infinite]" />
                        </div>
                        <span>Finding more…</span>
                      </div>
                    ) : fromCachedAt !== null ? (
                      <span className="font-mono text-[10px] border border-[#C0C0C0] px-1 bg-[#FFFFF0] text-[#808080]" title={`Cached at ${new Date(fromCachedAt).toLocaleTimeString()}`}>
                        {(() => { const age = Date.now() - fromCachedAt; return age < 60_000 ? 'cached <1m ago' : age < 3_600_000 ? `cached ${Math.round(age / 60_000)}m ago` : age < 86_400_000 ? `cached ${Math.round(age / 3_600_000)}h ago` : `cached ${Math.round(age / 86_400_000)}d ago` })()}
                      </span>
                    ) : queryMs !== null ? (
                      <span className="font-mono text-[10px] border border-[#C0C0C0] px-1 bg-[#FFFFF0]">
                        {queryMs >= 1000 ? `${(queryMs / 1000).toFixed(1)}s` : `${queryMs}ms`}
                      </span>
                    ) : null}
                  </>
                )}
              </div>

              {/* Table */}
              <div className="flex-1 border border-[#808080] bg-white mt-1 overflow-auto shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]">
                <table ref={tableRef} className="table-fixed w-max text-left border-collapse whitespace-nowrap">
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
                        const isFiltered = !!(colFilters[col.id] && (colFilters[col.id].text || (colFilters[col.id].selected?.size ?? 0) > 0))
                        return (
                          <th
                            key={col.id}
                            ref={el => { thRefs.current[i] = el }}
                            className={[
                              "relative border-r border-b border-[#C0C0C0] px-2 py-0.5 font-normal text-xs bg-gradient-to-b from-white to-[#EAEAEA] shadow-[inset_-1px_-1px_0_#A0A0A0] max-w-0 overflow-hidden select-none",
                              isDragging ? "opacity-40" : "",
                              isDropTarget ? "border-l-2 border-l-[#316AC5]" : "",
                              isFiltered ? "border-b-2 border-b-[#316AC5]" : "",
                            ].join(" ")}
                          >
                            {/* Drag-to-reorder grab area */}
                            <span
                              className={`block truncate pr-6 ${colDrag ? "cursor-grabbing" : "cursor-grab"}`}
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
                            {/* Filter button */}
                            <button
                              className={`absolute right-2 top-0 bottom-0 w-4 flex items-center justify-center text-[10px] hover:bg-[#316AC5]/20 z-10 ${isFiltered ? 'text-[#316AC5]' : 'text-[#A0A0A0]'}`}
                              onPointerDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                const r = e.currentTarget.getBoundingClientRect()
                                if (filterPanel?.colId === col.id) {
                                  setFilterPanel(null)
                                  setFilterPanelSearch("")
                                } else {
                                  setFilterPanel({ colId: col.id, x: r.left, y: r.bottom })
                                  setFilterPanelSearch("")
                                }
                              }}
                            >
                              ▾
                            </button>
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
                    {results.length === 0 && !isLoading ? (
                      <tr>
                        <td colSpan={cols.length + 1} className="px-2 py-1 text-center text-[#808080]">
                          {queryMs !== null ? "No results found." : "Enter a search term and click Search."}
                        </td>
                      </tr>
                    ) : (
                      sortedResults.map((r, idx) => {
                        const isSelected = selectedResultIdx === idx
                        const strengthForm = [r.strength, r.strengthUnit, r.dosageForm].filter(Boolean).join(" ").trim()
                        const realFacs = r.activeFacilities.filter(f => !CORP_FACILITIES.has(f))
                        const facCount = realFacs.length
                        const facDisplay = facCount === 0 ? "" : facCount === 1 ? realFacs[0] : "Multiple"
                        return (
                          <tr
                            key={`${r.groupId}-${idx}`}
                            onClick={() => setSelectedResultIdx(idx)}
                            onDoubleClick={() => { setSelectedResultIdx(idx); handleOkForGroup(r.groupId) }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              const td = (e.target as HTMLElement).closest('td')
                              if (!td) return
                              const tds = Array.from(td.parentElement!.querySelectorAll('td'))
                              const tdIdx = tds.indexOf(td)
                              if (tdIdx < 1) return
                              const col = cols[tdIdx - 1]
                              if (!col) return
                              setCtxMenu({ x: e.clientX, y: e.clientY, text: getCellText(col.id, r) })
                            }}
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
                                case "domain":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden">
                                      <div className="flex flex-wrap gap-0.5">
                                        {(r as UnifiedResult)._allDomains.sort((a, b) => (DOMAIN_PRIORITY[a] ?? 99) - (DOMAIN_PRIORITY[b] ?? 99)).map(dk => {
                                          const [reg, env] = dk.split('_')
                                          const badge = getDomainBadge(reg, env)
                                          const isProd = env === 'prod'
                                          return (
                                            <span
                                              key={dk}
                                              title={dk}
                                              className={isProd
                                                ? 'bg-[#316AC5] text-white font-bold text-[9px] px-1 rounded-sm'
                                                : 'bg-[#D4D0C8] text-[#444] text-[9px] px-1 border border-[#808080] rounded-sm'
                                              }
                                            >
                                              {badge}
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </td>
                                  )
                                case "order": {
                                  const mic = [r.searchMedication ? 'M' : '', r.searchIntermittent ? 'I' : '', r.searchContinuous ? 'C' : ''].join('')
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden">
                                      {mic
                                        ? <span className={`text-[10px] px-1 font-mono rounded ${isSelected ? "bg-white/20" : "bg-[#E8E8E0] text-[#444]"}`}>{mic}</span>
                                        : detailsLoading
                                        ? <span className={`text-[10px] font-mono animate-pulse ${isSelected ? "text-white/40" : "text-[#B0B0B0]"}`}>···</span>
                                        : null}
                                    </td>
                                  )
                                }
                                case "facility":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 relative group">
                                      {facilitiesLoading && facCount === 0 && r.activeFacilities.length === 0 ? (
                                        <span className="text-[#A0A0A0] italic">loading…</span>
                                      ) : detailsLoading && facCount === 0 && r.activeFacilities.length === 0 ? (
                                        <span className={`text-[10px] animate-pulse ${isSelected ? "text-white/40" : "text-[#B0B0B0]"}`}>···</span>
                                      ) : facCount === 0 && r.activeFacilities.length === 0 ? null : facCount === 0 ? (
                                        <span className={`text-[10px] italic ${isSelected ? "text-white/50" : "text-[#B0B0B0]"}`}>corp only</span>
                                      ) : facCount === 1 ? (
                                        <span className="truncate block">{realFacs[0]}</span>
                                      ) : (
                                        <>
                                          <div className="flex gap-px items-center w-full overflow-hidden">
                                            {realFacs.map(f => (
                                              <div
                                                key={f}
                                                className={`flex-1 h-2 min-w-[2px] max-w-[8px] rounded-[1px] ${isSelected ? "bg-white/80" : "bg-[#316AC5]"}`}
                                              />
                                            ))}
                                          </div>
                                          <div className="hidden group-hover:block absolute left-full top-2 ml-1 bg-[#FFFFE1] border border-black p-1 shadow z-[9999] min-w-[140px] text-black text-xs whitespace-nowrap">
                                            <div className="font-bold mb-0.5 border-b border-[#C0C0C0] pb-0.5">{facCount} facilities</div>
                                            {realFacs.map(f => <div key={f}>{f}</div>)}
                                          </div>
                                        </>
                                      )}
                                    </td>
                                  )
                                case "charge":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden">
                                      {r.chargeNumber && (
                                        <span className="flex items-center gap-1.5">
                                          <div className={`w-2 h-2 border ${isSelected ? "bg-white border-white" : "bg-red-500 border-red-800"}`}></div>
                                          {r.chargeNumber}
                                        </span>
                                      )}
                                    </td>
                                  )
                                case "pyxis":       return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{r.pyxisId}</td>
                                case "mnemonic":    return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{r.mnemonic}</td>
                                case "generic":     return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{r.genericName}</td>
                                case "strength":    return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{strengthForm}</td>
                                case "description": return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{r.description}</td>
                                case "brand":       return <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden truncate">{r.brandName}</td>
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

              {/* Context menu */}
              {ctxMenu && (
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setCtxMenu(null)} />
                  <div
                    style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
                    className="bg-[#F0F0F0] border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.4)] text-xs font-sans py-0.5 min-w-[120px]"
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <button
                      className="w-full text-left px-4 py-0.5 hover:bg-[#316AC5] hover:text-white whitespace-nowrap disabled:text-[#A0A0A0]"
                      disabled={!ctxMenu.text}
                      onClick={() => { navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null) }}
                    >
                      Copy
                    </button>
                  </div>
                </>
              )}

              {/* Filter Panel overlay — fixed position, outside table overflow */}
              {filterPanel && fpFilter && (() => {
                const panelW = 210
                const panelH = 270
                const clampedX = Math.min(filterPanel.x, window.innerWidth - panelW - 4)
                const clampedY = Math.min(filterPanel.y, window.innerHeight - panelH - 4)
                return (
                  <div
                    ref={filterPanelRef}
                    style={{ position: 'fixed', left: clampedX, top: clampedY, zIndex: 60, width: panelW }}
                    className="bg-[#F0F0F0] border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.4)] text-xs font-sans"
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <div className="p-1.5 border-b border-[#C0C0C0]">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search values..."
                        value={filterPanelSearch}
                        onChange={e => setFilterPanelSearch(e.target.value)}
                        className="w-full h-5 px-1 border border-[#808080] bg-white text-xs font-sans shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] focus:outline-none"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto">
                      <div
                        className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[#E8F0FE] border-b border-[#E0E0E0]"
                        onClick={() => {
                          setColFilters(prev => {
                            const f = prev[filterPanel.colId] ?? { text: "", selected: new Set<string>() }
                            const next = new Set(f.selected)
                            if (fpAllVisibleSelected) {
                              fpVisibleValues.forEach(v => next.delete(v))
                            } else {
                              fpVisibleValues.forEach(v => next.add(v))
                            }
                            return { ...prev, [filterPanel.colId]: { ...f, selected: next } }
                          })
                        }}
                      >
                        <input type="checkbox" checked={fpAllVisibleSelected} readOnly className="w-3 h-3 cursor-pointer" />
                        <span className="italic text-[#444]">(Select All)</span>
                      </div>
                      {fpVisibleValues.map(val => (
                        <div
                          key={val}
                          className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[#E8F0FE]"
                          onClick={() => {
                            setColFilters(prev => {
                              const f = prev[filterPanel.colId] ?? { text: "", selected: new Set<string>() }
                              const next = new Set(f.selected)
                              if (next.has(val)) next.delete(val)
                              else next.add(val)
                              return { ...prev, [filterPanel.colId]: { ...f, selected: next } }
                            })
                          }}
                        >
                          <input type="checkbox" checked={fpFilter.selected.has(val)} readOnly className="w-3 h-3 cursor-pointer" />
                          <span className="truncate">{val || <em className="text-[#808080]">(blank)</em>}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-1 p-1.5 border-t border-[#C0C0C0]">
                      <button
                        onClick={() => {
                          setColFilters(prev => {
                            const next = { ...prev }
                            delete next[filterPanel.colId]
                            return next
                          })
                          setFilterPanelSearch("")
                        }}
                        className="h-5 px-2 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                      >
                        Clear
                      </button>
                      <button
                        onClick={() => { setFilterPanel(null); setFilterPanelSearch("") }}
                        className="h-5 px-2 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )
              })()}
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
                      {facilitiesLoading ? (
                        <div className="px-1.5 py-1 text-[#808080] text-xs italic">Loading…</div>
                      ) : availableFacs.map(fac => (
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
                      {facilitiesLoading ? (
                        <div className="px-1.5 py-1 text-[#808080] text-xs italic">Loading…</div>
                      ) : selectedFacs.map(fac => (
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

              {/* Cache */}
              <fieldset className="border border-[#808080] px-3 pb-2 pt-1 relative shrink-0 bg-white shadow-[inset_1px_1px_0_#FFFFFF]">
                <legend className="px-1 text-xs bg-white">Cache</legend>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span>Results are cached until a new extract is uploaded.</span>
                  <button
                    onClick={() => {
                      searchCache.current.clear()
                      Object.keys(localStorage)
                        .filter(k => k.startsWith('pharmnet-search-cache:'))
                        .forEach(k => localStorage.removeItem(k))
                      setFromCachedAt(null)
                    }}
                    className="h-5 px-2 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                  >
                    Clear Cache
                  </button>
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
              disabled={isSelecting}
              className="h-6 w-20 border border-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] disabled:opacity-50 disabled:cursor-not-allowed"
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
