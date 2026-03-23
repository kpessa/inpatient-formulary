"use client"

import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react"
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
import { Badge } from "@/components/ui/badge"
import type { FormularyItem, DrugCategory, SearchFilterGroup } from "@/lib/types"
import type { SearchResult } from "@/app/api/formulary/search/route"
import type { DomainValue } from "@/lib/formulary-diff"
import { RecentSearchDropdown } from "./RecentSearchDropdown"
import { TherapeuticClassPicker } from "./TherapeuticClassPicker"
import { tcDescendants, tcLabel } from "@/lib/therapeutic-class-map"
import { FieldFilterSelect, FilterChips, type AdvFilterItem } from "./FieldFilterSelect"
import { FieldDiffTooltip } from "./FieldDiffTooltip"

type UnifiedResult = SearchResult & { _allDomains: string[] }

type CategoryInfo = { id: string; name: string; color: string }

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
  onMinimize?: () => void
  onFocus?: () => void
  focused?: boolean
  hidden?: boolean
  searchTrigger?: { value: string; seq: number } | null
  scope: Scope
  availableDomains: { region: string; env: string; domain: string }[]
  onSelect: (item: FormularyItem) => void
  onCreateTask?: (drugKey: string, drugDescription: string, fieldName?: string, fieldLabel?: string, domainValues?: DomainValue[]) => void
}

const CORP_FACILITIES = new Set(["UHS Corp", "UHST", "UHSB"])

const DOMAIN_PRIORITY: Record<string, number> = {
  east_prod: 1, west_prod: 2, central_prod: 3,
  east_cert: 4, west_cert: 5, central_cert: 6,
  east_mock: 7, west_mock: 8, central_mock: 9,
  east_build: 10, west_build: 11, central_build: 12,
}
function getDomainKey(r: SearchResult): string { return `${r.region}_${r.environment}` }
function getDomainPriority(r: SearchResult): number { return DOMAIN_PRIORITY[getDomainKey(r)] ?? 99 }
function isProd(r: SearchResult): boolean { return r.environment === 'prod' }
function getSemanticKey(r: SearchResult): string {
  if (r.pyxisId?.trim())      return `pyxis:${r.pyxisId.trim()}`
  if (r.chargeNumber?.trim()) return `charge:${r.chargeNumber.trim()}`
  return `group:${r.groupId}`
}
function getDomainBadge(region: string, env: string): string {
  const letter = region === 'east' ? 'E' : region === 'west' ? 'W' : 'C'
  return env === 'prod' ? letter : letter.toLowerCase()
}

function getDomainColor(region: string, env: string): { bg: string; text: string; border: string; tint: string } {
  const hue = region === 'east' ? 213 : region === 'west' ? 142 : 32
  const sat  = env === 'prod' ? 75 : env === 'cert' ? 60 : env === 'mock' ? 45 : 30
  const light = env === 'prod' ? 35 : env === 'cert' ? 50 : env === 'mock' ? 63 : 78
  return {
    bg:     `hsl(${hue}, ${sat}%, ${light}%)`,
    text:   light < 58 ? '#ffffff' : '#1a1a1a',
    border: `hsl(${hue}, ${sat}%, ${Math.max(light - 12, 10)}%)`,
    tint:   `hsl(${hue}, ${env === 'prod' ? 55 : 40}%, ${env === 'prod' ? 90 : 94}%)`,
  }
}

function computeDiffCols(variants: UnifiedResult[]): Set<string> {
  if (variants.length <= 1) return new Set()
  const checks: [string, (r: UnifiedResult) => string][] = [
    ['description', r => r.description],
    ['generic',     r => r.genericName],
    ['strength',    r => `${r.strength}|${r.strengthUnit}|${r.dosageForm}`],
    ['mnemonic',    r => r.mnemonic],
    ['charge',      r => r.chargeNumber],
    ['brand',       r => r.brandName],
    ['pyxis',       r => r.pyxisId],
    ['order',       r => `${r.searchMedication}|${r.searchIntermittent}|${r.searchContinuous}`],
  ]
  const diffs = new Set<string>()
  for (const [colId, getter] of checks) {
    if (new Set(variants.map(getter)).size > 1) diffs.add(colId)
  }
  return diffs
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  generic:     'Generic Name',
  strength:    'Strength / Form',
  mnemonic:    'Mnemonic',
  charge:      'Charge Number',
  brand:       'Brand Name',
  pyxis:       'Pyxis ID',
}

function getFieldValue(r: UnifiedResult, colId: string): string {
  switch (colId) {
    case 'description': return r.description ?? ''
    case 'generic':     return r.genericName ?? ''
    case 'strength':    return [r.strength, r.strengthUnit, r.dosageForm].filter(Boolean).join(' ')
    case 'mnemonic':    return r.mnemonic ?? ''
    case 'charge':      return r.chargeNumber ?? ''
    case 'brand':       return r.brandName ?? ''
    case 'pyxis':       return r.pyxisId ?? ''
    default:            return ''
  }
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

export function SearchModal({ onClose, onMinimize, onFocus, focused = true, hidden, searchTrigger, scope: initialScope, availableDomains, onSelect, onCreateTask }: SearchModalProps) {
  const [activeTab, setActiveTab] = useState("main")
  const [searchValue, setSearchValue] = useState("")
  const [scope, setScope] = useState<Scope>(initialScope)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pharmnet-recent-searches') ?? '[]') } catch { return [] }
  })
  const [activeFields, setActiveFields] = useState<Set<string>>(
    () => new Set(['description', 'generic_name', 'brand_name', 'mnemonic', 'charge_number', 'pyxis_id', 'ndc'])
  )

  const [isUnified, setIsUnified] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(groupId) ? next.delete(groupId) : next.add(groupId)
      return next
    })
  }, [])

  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())

  const toggleRegion = useCallback((semKey: string, region: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const key = `${semKey}:${region}`
    setExpandedRegions(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const [detailsLoading, setDetailsLoading] = useState(false)

  const [groupCategories, setGroupCategories] = useState<Record<string, CategoryInfo[]>>({})
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [allCategories, setAllCategories] = useState<CategoryInfo[]>([])
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [categorySearchActive, setCategorySearchActive] = useState(false)

  // Phase 2: fetch activeFacilities + searchMedication/Continuous/Intermittent.
  // Called via setTimeout after the fast results render so the UI updates in two
  // distinct phases. The gen parameter guards against stale calls from prior searches.
  const loadDetails = async (items: SearchResult[], gen: number) => {
    if (items.length === 0) return
    if (searchGenRef.current !== gen) return   // new search started — bail
    setDetailsLoading(true)
    try {
      // Group by (region, environment) — one inventory request per domain
      const domainGroups = new Map<string, { groupIds: string[]; region: string; environment: string }>()
      for (const r of items) {
        const key = `${r.region}|${r.environment}`
        if (!domainGroups.has(key)) domainGroups.set(key, { groupIds: [], region: r.region, environment: r.environment })
        domainGroups.get(key)!.groupIds.push(r.groupId)
      }
      const CHUNK = 50
      const fetches = [...domainGroups.values()].flatMap(({ groupIds, region, environment }) => {
        const chunks: string[][] = []
        for (let i = 0; i < groupIds.length; i += CHUNK) chunks.push(groupIds.slice(i, i + CHUNK))
        return chunks.map(async chunk => {
          const params = new URLSearchParams({ groupIds: chunk.join(','), region, environment })
          const res = await fetch(`/api/formulary/inventory?${params}`)
          if (!res.ok) throw new Error(`inventory ${res.status}`)
          const data = await res.json() as Record<string, { activeFacilities: string[]; searchMedication: boolean; searchContinuous: boolean; searchIntermittent: boolean }>
          return { data, region, environment }
        })
      })
      const detailResults = await Promise.all(fetches)
      if (searchGenRef.current !== gen) return  // new search started while fetching — bail
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
      if (searchGenRef.current === gen) setDetailsLoading(false)
    }
  }

  const loadCategories = async (items: SearchResult[], gen: number) => {
    if (items.length === 0) { setGroupCategories({}); return }
    if (searchGenRef.current !== gen) return
    setCategoriesLoading(true)
    try {
      const uniqueIds = [...new Set(items.map(r => r.groupId))].slice(0, 200)
      const res = await fetch(`/api/categories/membership?groupIds=${uniqueIds.join(',')}`)
      if (!res.ok) throw new Error(`membership ${res.status}`)
      const data = await res.json() as Record<string, CategoryInfo[]>
      if (searchGenRef.current !== gen) return
      setGroupCategories(data)
    } catch (err) {
      console.error('loadCategories failed:', err)
    } finally {
      if (searchGenRef.current === gen) setCategoriesLoading(false)
    }
  }

  const handleCategorySelect = async (catId: string) => {
    setCategoryFilter(catId)
    if (!catId) {
      setCategorySearchActive(false)
      setResults([])
      setTotal(0)
      setGroupCategories({})
      return
    }
    const { pyxisIds } = await fetch(`/api/categories/${catId}/pyxis-ids`).then(r => r.json()) as { pyxisIds: string[] }
    setCategorySearchActive(true)
    const gen = ++searchGenRef.current
    setResults([])
    setGroupCategories({})
    setTotal(0)
    setQueryMs(null)
    if (pyxisIds.length === 0) return
    setIsLoading(true)
    const params = new URLSearchParams({ pyxisIds: pyxisIds.join(',') })
    if (scope.type === 'domain') { params.set('region', scope.region); params.set('environment', scope.env) }
    else if (scope.type === 'region') params.set('region', scope.region)
    else if (scope.type === 'env') params.set('environment', scope.env)
    const t0 = performance.now()
    try {
      const res = await fetch(`/api/formulary/search?${params}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finalResults: SearchResult[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (value) buf += decoder.decode(value, { stream: !done })
        const lines = buf.split('\n')
        buf = lines.pop()!
        for (const line of lines) {
          if (!line.trim()) continue
          const chunk = JSON.parse(line)
          if ('results' in chunk) { finalResults = chunk.results; setTotal(chunk.total) }
        }
        if (done) break
      }
      if (searchGenRef.current !== gen) return
      setResults(finalResults)
      setQueryMs(Math.round(performance.now() - t0))
      setTimeout(() => loadDetails(finalResults, gen), 0)
      setTimeout(() => loadCategories(finalResults, gen), 0)
    } catch (err) {
      console.error('handleCategorySelect failed:', err)
    } finally {
      if (searchGenRef.current === gen) setIsLoading(false)
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
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string; groupId?: string; description?: string } | null>(null)
  const [catPicker, setCatPicker] = useState<{ x: number; y: number; groupId: string; description: string; categories: DrugCategory[]; selected: Set<string>; saving: boolean } | null>(null)
  const [total, setTotal] = useState(0)
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)
  const [selectedResultIdx, setSelectedResultIdx] = useState<number | null>(null)
  const [queryMs, setQueryMs] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState<number | null>(null)
  const searchStartRef = useRef<number | null>(null)
  // Incremented on each new search — loadDetails checks this so a stale slow-fetch
  // from a previous search can't overwrite results from the current one.
  const searchGenRef = useRef(0)


  // Columns: unified label + width, order is mutable
  const [cols, setCols] = useState([
    { id: "domain",      label: "Domain",             width: 90,  align: 'center' as const },
    { id: "order",       label: "Type",               width: 90,  align: 'center' as const },
    { id: "facility",    label: "Facility",           width: 100, align: 'left'   as const },
    { id: "charge",      label: "CDM",                width: 100, align: 'center' as const },
    { id: "pyxis",       label: "Med ID",             width: 120, align: 'center' as const },
    { id: "mnemonic",    label: "Mnemonic",           width: 90,  align: 'center' as const },
    { id: "generic",     label: "Generic Name",       width: 140, align: 'left'   as const },
    { id: "strength",    label: "Strength / Form",    width: 110, align: 'left'   as const },
    { id: "description", label: "Description",        width: 160, align: 'left'   as const },
    { id: "brand",       label: "Brand Name",         width: 100, align: 'left'   as const },
  ])
  const resizingCol = useRef<{ idx: number; startX: number; startWidth: number } | null>(null)
  // Drag-to-reorder
  const [colDrag, setColDrag] = useState<{ from: number; to: number } | null>(null)
  const colDragRef = useRef<{ from: number; to: number; startX: number; colId: string } | null>(null)
  const [sortStack, setSortStack] = useState<{ colId: string; dir: 'asc' | 'desc' }[]>([])
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const tableRef = useRef<HTMLTableElement | null>(null)

  // Column filter state
  const [colFilters, setColFilters] = useState<Record<string, { text: string; selected: Set<string> }>>({})
  const [filterPanel, setFilterPanel] = useState<{ colId: string; x: number; y: number } | null>(null)
  const [filterPanelSearch, setFilterPanelSearch] = useState("")
  const filterPanelRef = useRef<HTMLDivElement | null>(null)

  // Advanced search panel
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterGroups, setFilterGroups] = useState<SearchFilterGroup[]>([])
  const [advFilter, setAdvFilter] = useState({
    tcItems: [] as AdvFilterItem[],
    dfItems: [] as AdvFilterItem[],
    rtItems: [] as AdvFilterItem[],
    dcItems: [] as AdvFilterItem[],
  })

  const fetchFilterGroups = useCallback(() => {
    fetch('/api/filter-groups')
      .then(r => r.json())
      .then((d: { groups: SearchFilterGroup[] }) => setFilterGroups(d.groups ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { fetchFilterGroups() }, [fetchFilterGroups])

  const advActiveCount =
    advFilter.tcItems.length + advFilter.dfItems.length +
    advFilter.rtItems.length + advFilter.dcItems.length +
    (categoryFilter ? 1 : 0)

  const clearAdvFilters = () => {
    setAdvFilter({ tcItems: [], dfItems: [], rtItems: [], dcItems: [] })
    handleCategorySelect('')
  }

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
      const w = Math.min(window.innerWidth, 1400)
      setRect({ x: (window.innerWidth - w) / 2, y: 0, w, h: window.innerHeight })
    }
  }

  // Auto-fit columns when maximizing so they use the extra space
  useEffect(() => {
    if (!isMaximized) return
    const id = requestAnimationFrame(() => {
      cols.forEach((col, i) => { if (!['facility', 'charge', 'pyxis'].includes(col.id)) autoFitColumn(i) })
    })
    return () => cancelAnimationFrame(id)
  }, [isMaximized])

  // Load categories list on mount
  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then((d: { categories: DrugCategory[] }) =>
        setAllCategories(d.categories.map(c => ({ id: c.id, name: c.name, color: c.color })))
      )
      .catch(() => {})
  }, [])

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
          // Click: push to top of sort stack as primary (or toggle if already primary)
          setSortStack(prev => {
            if (prev.length > 0 && prev[0].colId === colId) {
              return prev.map(s => s.colId === colId ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)
            }
            const rest = prev.filter(s => s.colId !== colId)
            return [{ colId, dir: 'asc' }, ...rest].slice(0, 3)
          })
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
      // 8px left px-2 + 24px pr-6 (clears filter button) + 12px buffer
      maxWidth = Math.max(maxWidth, probe.offsetWidth + 44)
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

  const handleSearch = async (queryOverride?: string) => {
    const query = queryOverride ?? searchValue
    const trimmed = query.trim()
    if (trimmed) {
      setRecentSearches(prev => {
        const next = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, 10)
        try { localStorage.setItem('pharmnet-recent-searches', JSON.stringify(next)) } catch {}
        return next
      })
    }
    const gen = ++searchGenRef.current  // invalidate any in-flight loadDetails from prior search
    setDetailsLoading(false)
    setIsLoading(true)
    setSelectedResultIdx(null)
    setQueryMs(null)
    setColFilters({})
    setElapsedSec(null)
    setFieldStatus({})
    const t0 = performance.now()
    searchStartRef.current = t0
    let elapsedTimer: ReturnType<typeof setInterval> | null = null
    const showAfter = setTimeout(() => {
      setElapsedSec(1)
      elapsedTimer = setInterval(() => {
        setElapsedSec(Math.floor((performance.now() - t0) / 1000))
      }, 1000)
    }, 1000)
    try {
      const hasFacilityFilter = selectedFacs.length < allFacilities.length
      const isWildcard = query.includes('*')
      const useParallel = !hasFacilityFilter && !isWildcard && activeFields.size > 0 && trimmed.length > 0 && advActiveCount === 0

      // Base params shared by both paths
      const baseParams = new URLSearchParams({ q: query, limit: String(maxResults) })
      if (hasFacilityFilter) baseParams.set("facilities", selectedFacs.join(","))
      if (!showInactive) baseParams.set("showInactive", "false")
      if (scope.type === 'domain') { baseParams.set('region', scope.region); baseParams.set('environment', scope.env) }
      else if (scope.type === 'region') baseParams.set('region', scope.region)
      else if (scope.type === 'env') baseParams.set('environment', scope.env)

      // Advanced filters
      const tcInc = advFilter.tcItems.filter(i => i.op === 'include').flatMap(i => [i.id, ...tcDescendants(i.id)])
      const tcExc = advFilter.tcItems.filter(i => i.op === 'exclude').flatMap(i => [i.id, ...tcDescendants(i.id)])
      if (tcInc.length) baseParams.set('advTC', [...new Set(tcInc)].join(','))
      if (tcExc.length) baseParams.set('advTCExclude', [...new Set(tcExc)].join(','))
      const dfInc = advFilter.dfItems.filter(i => i.op === 'include').flatMap(i => i.values)
      const dfExc = advFilter.dfItems.filter(i => i.op === 'exclude').flatMap(i => i.values)
      if (dfInc.length) baseParams.set('advDFInclude', dfInc.join(','))
      if (dfExc.length) baseParams.set('advDFExclude', dfExc.join(','))
      const rtInc = advFilter.rtItems.filter(i => i.op === 'include').flatMap(i => i.values)
      const rtExc = advFilter.rtItems.filter(i => i.op === 'exclude').flatMap(i => i.values)
      if (rtInc.length) baseParams.set('advRtInclude', rtInc.join(','))
      if (rtExc.length) baseParams.set('advRtExclude', rtExc.join(','))
      const dcInc = advFilter.dcItems.filter(i => i.op === 'include').flatMap(i => i.values)
      const dcExc = advFilter.dcItems.filter(i => i.op === 'exclude').flatMap(i => i.values)
      if (dcInc.length) baseParams.set('advDCInclude', dcInc.join(','))
      if (dcExc.length) baseParams.set('advDCExclude', dcExc.join(','))

      // For parallel path, classify which fields to actually query based on input format
      const fieldsToQuery = useParallel ? classifyActiveFields(query, activeFields) : new Set<string>()

      if (useParallel) {
        // ── Parallel path: one fetch per field, results trickle in as each resolves ──
        if (fieldsToQuery.size === 0) {
          setResults([])
          setGroupCategories({})
          setTotal(0)
          setQueryMs(Math.round(performance.now() - t0))
        } else {
        setResults([])
        setGroupCategories({})
        setFieldStatus(Object.fromEntries([...fieldsToQuery].map(f =>
          [f, { state: 'loading' as const, count: 0, ms: 0, limit: maxResults }]
        )))

        // One request with all fields — server parallelizes internally and streams
        // NDJSON back (one line per field), avoiding per-field cold starts.
        const fieldResults: Record<string, SearchResult[]> = {}
        const fp = new URLSearchParams([...baseParams.entries(), ['fields', [...fieldsToQuery].join(',')]])
        const fieldRes = await fetch(`/api/formulary/search?${fp}`)
        const fieldReader = fieldRes.body!.getReader()
        const fieldDecoder = new TextDecoder()
        let fieldBuf = ''
        while (true) {
          const { done, value } = await fieldReader.read()
          if (value) fieldBuf += fieldDecoder.decode(value, { stream: !done })
          const lines = fieldBuf.split('\n')
          fieldBuf = lines.pop()!
          for (const line of lines) {
            if (!line.trim()) continue
            const chunk = JSON.parse(line) as { field: string; results: SearchResult[]; ms: number; rawCount: number }
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
          }
          if (done) break
        }

        // Deduplicate merged results
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

        setTimeout(() => loadDetails(finalResults, gen), 0)
        setTimeout(() => loadCategories(finalResults, gen), 0)
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
        setResults(finalResults)
        setTotal(finalTotal)
        setQueryMs(elapsed)
        setTimeout(() => loadDetails(finalResults, gen), 0)
        setTimeout(() => loadCategories(finalResults, gen), 0)
      }
    } finally {
      clearTimeout(showAfter)
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
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

  // Respond to search queries pushed from the toolbar
  useEffect(() => {
    if (!searchTrigger) return
    setSearchValue(searchTrigger.value)
    handleSearch(searchTrigger.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger?.seq])

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
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let expandedResults: SearchResult[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (value) buf += decoder.decode(value, { stream: !done })
        const lines = buf.split('\n')
        buf = lines.pop()!
        for (const line of lines) {
          if (!line.trim()) continue
          const chunk = JSON.parse(line)
          if ('results' in chunk) expandedResults = chunk.results
        }
        if (done) break
      }
      const existingIds = new Set(results.map(r => `${r.groupId}|${r.region}|${r.environment}`))
      const newOnes = expandedResults.filter(r => !existingIds.has(`${r.groupId}|${r.region}|${r.environment}`))
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
    // Status filter: field-search queries no longer include status = 'Active' in SQL
    // (it blocked the field indexes), so we filter here instead.
    const statusFiltered = showInactive ? results : results.filter(r => r.status === 'Active')
    const activeFilters = Object.entries(colFilters).filter(
      ([, f]) => f.text || (f.selected?.size ?? 0) > 0
    )
    if (activeFilters.length === 0) return statusFiltered
    return statusFiltered.filter(r =>
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
  }, [results, colFilters, showInactive])

  const baseResults = useMemo((): UnifiedResult[] => {
    if (!isUnified) {
      return filteredResults.map(r => ({ ...r, _allDomains: [getDomainKey(r)] }))
    }
    const bySemanticKey = new Map<string, UnifiedResult>()
    for (const r of filteredResults) {
      const key = getSemanticKey(r)
      const existing = bySemanticKey.get(key)
      if (!existing || getDomainPriority(r) < getDomainPriority(existing)) {
        bySemanticKey.set(key, {
          ...r,
          _allDomains: existing ? [...existing._allDomains, getDomainKey(r)] : [getDomainKey(r)],
        })
      } else {
        existing._allDomains.push(getDomainKey(r))
      }
    }
    return Array.from(bySemanticKey.values())
  }, [filteredResults, isUnified])

  const variantsByGroup = useMemo(() => {
    const map = new Map<string, UnifiedResult[]>()
    for (const r of filteredResults) {
      const key = getSemanticKey(r)
      const entry = map.get(key) ?? []
      entry.push({ ...r, _allDomains: [getDomainKey(r)] })
      map.set(key, entry)
    }
    for (const [gid, list] of map) {
      map.set(gid, list.sort((a, b) => getDomainPriority(a) - getDomainPriority(b)))
    }
    return map
  }, [filteredResults])

  const sortedResults = sortStack.length > 0
    ? [...baseResults].sort((a, b) => {
        for (const { colId, dir } of sortStack) {
          const av = getSortValue(a, colId).toLowerCase()
          const bv = getSortValue(b, colId).toLowerCase()
          const cmp = av < bv ? -1 : av > bv ? 1 : 0
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
        }
        return 0
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
    <>
    <div
      className={`flex flex-col bg-[#D4D0C8] font-sans text-xs select-none border border-[#808080] fixed shadow-[2px_2px_0px_#000000,-1px_-1px_0px_#FFFFFF]`}
      style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: focused ? 51 : 50, display: hidden ? 'none' : undefined } : { display: 'none' }}
      onPointerDownCapture={onFocus}
    >
        {/* Resize Handles */}
        <>
          <div onPointerDown={handlePointerDown('n')} className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-20" />
          <div onPointerDown={handlePointerDown('s')} className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-20" />
          <div onPointerDown={handlePointerDown('e')} className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-20" />
          <div onPointerDown={handlePointerDown('w')} className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-20" />
          <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-20" />
          <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-20" />
          <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-20" />
          <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-20" />
        </>

        {/* Title bar */}
        <div
          className={`flex items-center justify-between text-white px-2 h-7 shrink-0 transition-colors duration-150 ${focused ? 'bg-[#E69138]' : 'bg-[#9B6030]'}`}
          onPointerDown={isMaximized ? undefined : handlePointerDown('move')}
          onDoubleClick={toggleMaximize}
        >
          <div className="flex items-center gap-1.5 pointer-events-none">
            <div className="w-4 h-4 bg-white border border-white/40 flex items-center justify-center text-[8px] rounded-full text-blue-500 shadow-sm leading-none pt-0.5">💊</div>
            <span className="text-sm font-bold tracking-wide">Product Search</span>
          </div>
          <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
            <button onPointerDown={e => { e.stopPropagation(); onMinimize?.() }} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
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
                <div className="flex items-center">
                  <Input
                    value={searchValue}
                    onChange={e => setSearchValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Escape") { setSearchValue(""); return }
                      if (e.key === "Enter") {
                        handleSearch()
                      }
                    }}
                    className="h-5 text-xs font-sans rounded-none border-t-[#808080] border-l-[#808080] border-b-white border-r-white border px-1 py-0 w-64 bg-white shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)] focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <button
                    onClick={() => setSearchValue("")}
                    className={`h-5 w-4 flex items-center justify-center text-[10px] text-[#808080] bg-[#D4D0C8] border border-t-white border-l-white border-b-[#808080] border-r-[#808080] hover:text-black active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white shrink-0 cursor-default ${searchValue ? '' : 'invisible pointer-events-none'}`}
                    title="Clear search (Esc)"
                    tabIndex={-1}
                  >
                    ✕
                  </button>
                  <RecentSearchDropdown
                    recentSearches={recentSearches}
                    onSelect={s => { setSearchValue(s); handleSearch(s) }}
                    onClear={() => {
                      setRecentSearches([])
                      try { localStorage.removeItem('pharmnet-recent-searches') } catch {}
                    }}
                  />
                </div>
                <button
                  onClick={() => handleSearch()}
                  className="h-6 px-4 border border-[#808080] text-black bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] active:border-t-black active:border-l-black flex items-center justify-center text-xs ml-auto shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                >
                  Search
                </button>
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className={`h-6 px-2 border text-xs flex items-center gap-1 shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset] ${
                    showAdvanced || advActiveCount > 0
                      ? 'bg-[#E8F0FF] border-[#316AC5] text-[#316AC5]'
                      : 'border-[#808080] text-black bg-[#D4D0C8] hover:bg-[#E8E8E0]'
                  }`}
                  title="Advanced filters"
                >
                  Advanced {showAdvanced ? '▲' : '▼'}
                  {advActiveCount > 0 && (
                    <span className="bg-[#316AC5] text-white text-[9px] px-1 py-px rounded-full">{advActiveCount}</span>
                  )}
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
                {(() => {
                  const selectedRow = selectedResultIdx !== null ? sortedResults[selectedResultIdx] : null
                  const domainCount = selectedRow ? (variantsByGroup.get(getSemanticKey(selectedRow))?.length ?? 0) : 0
                  return (
                    <>
                      <button
                        onClick={() => cols.forEach((col, i) => { if (!['facility', 'charge', 'pyxis'].includes(col.id)) autoFitColumn(i) })}
                        className="h-5 px-2 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] active:bg-[#B0A898] text-xs shadow-[1px_1px_0px_#FFFFFF_inset,-1px_-1px_0px_#808080_inset]"
                        title="Fit all columns to content"
                      >
                        Autofit
                      </button>
                    </>
                  )
                })()}
              </div>

              {/* Advanced Filter Panel */}
              {showAdvanced && (
                <div className="shrink-0 border-t border-b border-[#808080] bg-[#F0EEE8] px-2 py-1.5 space-y-1">

                  {/* ── Compact trigger row ── */}
                  <div className="flex flex-wrap items-center gap-1">
                    {/* Category compact select */}
                    {allCategories.length > 0 && (
                      <select
                        value={categoryFilter}
                        onChange={e => handleCategorySelect(e.target.value)}
                        className={`h-5 text-[9px] font-mono border border-[#808080] px-1 max-w-[120px] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] ${
                          categoryFilter ? 'bg-[#E8F0FF] border-[#316AC5] text-[#316AC5]' : 'bg-[#D4D0C8] text-black'
                        }`}
                      >
                        <option value="">Cat: All</option>
                        {allCategories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    )}
                    {categoriesLoading && (
                      <span className="text-[10px] text-[#808080] animate-pulse">…</span>
                    )}

                    {/* TC compact trigger */}
                    <TherapeuticClassPicker
                      value=""
                      onChange={code => {
                        if (advFilter.tcItems.find(i => i.id === code)) return
                        setAdvFilter(prev => ({
                          ...prev,
                          tcItems: [...prev.tcItems, {
                            id: code, type: 'tc', op: 'include',
                            label: tcLabel(code), icon: '', values: [code],
                          }],
                        }))
                      }}
                    >
                      <button className={`h-5 px-1.5 text-[9px] font-mono border border-[#808080] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] whitespace-nowrap ${
                        advFilter.tcItems.length > 0 ? 'bg-[#E8F0FF] border-[#316AC5] text-[#316AC5]' : 'bg-[#D4D0C8] hover:bg-[#E8E8E0] text-black'
                      }`}>
                        ▼ Therap. Class
                        {advFilter.tcItems.length > 0 && (
                          <span className="ml-1 bg-[#316AC5] text-white text-[8px] px-1 rounded-full">{advFilter.tcItems.length}</span>
                        )}
                      </button>
                    </TherapeuticClassPicker>

                    {/* DF / Route / DC compact triggers */}
                    <FieldFilterSelect compact field="dosage_form"       filterGroups={filterGroups} items={advFilter.dfItems} onChange={items => setAdvFilter(prev => ({ ...prev, dfItems: items }))} />
                    <FieldFilterSelect compact field="route"             filterGroups={filterGroups} items={advFilter.rtItems} onChange={items => setAdvFilter(prev => ({ ...prev, rtItems: items }))} />
                    <FieldFilterSelect compact field="dispense_category" filterGroups={filterGroups} items={advFilter.dcItems} onChange={items => setAdvFilter(prev => ({ ...prev, dcItems: items }))} />

                    {/* Clear All — right side */}
                    {advActiveCount > 0 && (
                      <button
                        onClick={clearAdvFilters}
                        className="ml-auto h-5 px-2 text-[9px] font-mono border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFCCCC] hover:border-[#CC0000]"
                      >
                        Clear All ({advActiveCount})
                      </button>
                    )}
                  </div>

                  {/* ── Expanded chip rows (only when filter has items) ── */}
                  {advFilter.tcItems.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono text-[#404040] whitespace-nowrap w-24 shrink-0">Therap. Class</span>
                      <FilterChips items={advFilter.tcItems} onChange={items => setAdvFilter(prev => ({ ...prev, tcItems: items }))} />
                    </div>
                  )}
                  {advFilter.dfItems.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono text-[#404040] whitespace-nowrap w-24 shrink-0">Dosage Form</span>
                      <FilterChips items={advFilter.dfItems} onChange={items => setAdvFilter(prev => ({ ...prev, dfItems: items }))} />
                    </div>
                  )}
                  {advFilter.rtItems.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono text-[#404040] whitespace-nowrap w-24 shrink-0">Route</span>
                      <FilterChips items={advFilter.rtItems} onChange={items => setAdvFilter(prev => ({ ...prev, rtItems: items }))} />
                    </div>
                  )}
                  {advFilter.dcItems.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono text-[#404040] whitespace-nowrap w-24 shrink-0">Dispense Cat.</span>
                      <FilterChips items={advFilter.dcItems} onChange={items => setAdvFilter(prev => ({ ...prev, dcItems: items }))} />
                    </div>
                  )}

                </div>
              )}

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
                      {categorySearchActive && categoryFilter
                        ? (() => {
                            const catName = allCategories.find(c => c.id === categoryFilter)?.name ?? 'Category'
                            return results.length > 0
                              ? `Category: ${catName} — ${sortedResults.length} drug${sortedResults.length !== 1 ? 's' : ''}.`
                              : queryMs !== null ? `Category: ${catName} — no Pyxis IDs or no matches.` : ''
                          })()
                        : total > results.length
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
                    {isExpanding ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-16 h-2 border border-[#808080] bg-[#D4D0C8] overflow-hidden relative">
                          <div className="absolute top-0 bottom-0 w-5 bg-[#316AC5] animate-[marquee_1.4s_linear_infinite]" />
                        </div>
                        <span>Finding more…</span>
                      </div>
                    ) : queryMs !== null ? (
                      <>
                        <span className="font-mono text-[10px] border border-[#C0C0C0] px-1 bg-[#FFFFF0]">
                          {queryMs >= 1000 ? `${(queryMs / 1000).toFixed(1)}s` : `${queryMs}ms`}
                        </span>
                        {detailsLoading && <span className="text-[10px] text-[#808080] animate-pulse font-mono">loading details…</span>}
                      </>
                    ) : detailsLoading ? (
                      <span className="text-[10px] text-[#808080] animate-pulse font-mono">loading details…</span>
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
                              style={{ textAlign: col.align }}
                              onPointerDown={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                colDragRef.current = { from: i, to: i, startX: e.clientX, colId: col.id }
                                setColDrag({ from: i, to: i })
                              }}
                            >
                              {col.label}
                              {(() => {
                                const idx = sortStack.findIndex(s => s.colId === col.id)
                                if (idx === -1) return null
                                const { dir } = sortStack[idx]
                                return (
                                  <span className="ml-1 text-[9px] font-bold opacity-80">
                                    {sortStack.length > 1 && <sup>{idx + 1}</sup>}
                                    {dir === 'asc' ? '▲' : '▼'}
                                  </span>
                                )
                              })()}
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
                      <tr key="empty">
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
                        const parentDiffCols = isUnified
                          ? computeDiffCols((variantsByGroup.get(getSemanticKey(r)) ?? []).filter(isProd))
                          : new Set<string>()

                        // Build DomainValue[] for a specific field from prod variants
                        const buildFieldDomainValues = (colId: string): DomainValue[] => {
                          const prodVariants = (variantsByGroup.get(getSemanticKey(r)) ?? []).filter(isProd)
                          return prodVariants.map(v => {
                            const { bg, text } = getDomainColor(v.region, v.environment)
                            return {
                              domain: getDomainKey(v),
                              badge: getDomainBadge(v.region, v.environment),
                              bg, text,
                              value: getFieldValue(v, colId),
                            }
                          })
                        }

                        // Wrap cell content with a hoverable diff tooltip + optional ⚑ task button
                        const cellWithTask = (colId: string, content: React.ReactNode) => {
                          const isDiff = parentDiffCols.has(colId)
                          const inner = isDiff && onCreateTask ? (
                            <div className="flex items-center gap-0.5 group/cell min-w-0">
                              <span className="truncate min-w-0 flex-1">{content}</span>
                              <button
                                onClick={e => {
                                  e.stopPropagation()
                                  onCreateTask(
                                    r.pyxisId?.trim() || r.chargeNumber?.trim() || r.groupId,
                                    r.description,
                                    colId,
                                    FIELD_LABELS[colId] ?? colId,
                                    buildFieldDomainValues(colId),
                                  )
                                }}
                                className={`opacity-0 group-hover/cell:opacity-100 shrink-0 text-[7px] h-3.5 px-0.5 leading-none transition-opacity
                                  ${isSelected ? 'bg-white/20 text-white border border-white/30' : 'bg-[#1a4a9a] text-white'}`}
                                title={`Flag ${FIELD_LABELS[colId] ?? colId} for standardization`}
                              >
                                ⚑
                              </button>
                            </div>
                          ) : (
                            <span className="truncate block">{content}</span>
                          )
                          if (!isDiff) return inner
                          return (
                            <FieldDiffTooltip values={buildFieldDomainValues(colId)}>
                              {inner}
                            </FieldDiffTooltip>
                          )
                        }

                        const rowCats = groupCategories[r.groupId] ?? []

                        const parentRow = (
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
                              setCtxMenu({ x: e.clientX, y: e.clientY, text: getCellText(col.id, r), groupId: r.groupId, description: r.description })
                            }}
                            className={`border-b border-[#E0E0E0] cursor-pointer ${
                              isSelected
                                ? "bg-[#316AC5] text-white"
                                : idx % 2 === 0
                                ? "bg-white hover:bg-[#F0F8FF]"
                                : "bg-[#F8F8F8] hover:bg-[#F0F8FF]"
                            }`}
                          >
                            <td className="px-0.5 py-0 text-center shrink-0">
                              <div className="flex items-center justify-center gap-0.5">
                                {isUnified && (variantsByGroup.get(getSemanticKey(r))?.length ?? 0) > 1 ? (
                                  <button
                                    onClick={e => toggleExpand(getSemanticKey(r), e)}
                                    className={`text-[10px] font-bold leading-none w-4 h-4 flex items-center justify-center rounded
                                      ${isSelected ? 'text-white/80 hover:bg-white/20' : 'text-[#316AC5] hover:bg-[#E0EAFF]'}`}
                                    title={expandedGroups.has(getSemanticKey(r)) ? 'Collapse domains' : 'Expand domains'}
                                  >
                                    {expandedGroups.has(getSemanticKey(r)) ? '−' : '+'}
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-gray-400">▦</span>
                                )}
                                {onCreateTask && parentDiffCols.size > 0 && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      onCreateTask(
                                        r.pyxisId?.trim() || r.chargeNumber?.trim() || r.groupId,
                                        r.description,
                                      )
                                    }}
                                    className={`text-[8px] font-mono h-4 px-0.5 leading-none border rounded-none whitespace-nowrap
                                      ${isSelected ? 'bg-white/20 text-white border-white/30 hover:bg-white/30' : 'bg-[#1a4a9a] text-white hover:bg-[#0e3070] border-[#0e3070]'}`}
                                    title="Create task for this drug"
                                  >
                                    ⚑
                                  </button>
                                )}
                                {rowCats.length > 0 && (
                                  <div className="flex items-center gap-[2px] ml-0.5">
                                    {rowCats.slice(0, 4).map(cat => (
                                      <div
                                        key={cat.id}
                                        title={cat.name}
                                        onClick={e => { e.stopPropagation(); handleCategorySelect(cat.id) }}
                                        style={{
                                          background: isSelected ? 'rgba(255,255,255,0.7)' : cat.color,
                                          border: `1px solid ${isSelected ? 'rgba(255,255,255,0.4)' : cat.color}`,
                                        }}
                                        className="w-[8px] h-[8px] rounded-[1px] shrink-0 cursor-pointer hover:opacity-80"
                                      />
                                    ))}
                                    {rowCats.length > 4 && (
                                      <span
                                        className={`text-[8px] font-mono leading-none ${isSelected ? 'text-white/70' : 'text-[#808080]'}`}
                                        title={rowCats.slice(4).map(c => c.name).join(', ')}
                                      >+{rowCats.length - 4}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            {cols.map(col => {
                              const pDiff = !isSelected && parentDiffCols.has(col.id)
                              const pDiffStyle = pDiff ? { background: '#FFF3CD', borderBottom: '1px solid #F59E0B' } : {}
                              switch (col.id) {
                                case "domain": {
                                  const variants = variantsByGroup.get(getSemanticKey(r)) ?? []
                                  const prodRegions = new Set(variants.filter(isProd).map(v => v.region))
                                  return (
                                    <td key={col.id} className="px-2 py-0.5" style={{ textAlign: col.align }}>
                                      <div className="inline-flex rounded-sm overflow-hidden border border-[#B0B0A8]">
                                        {(['west','central','east'] as const).map((reg, i) => {
                                          const inProd = prodRegions.has(reg)
                                          const { bg, text } = getDomainColor(reg, 'prod')
                                          const letter = reg === 'east' ? 'E' : reg === 'west' ? 'W' : 'C'
                                          return (
                                            <span
                                              key={reg}
                                              style={inProd ? { background: bg, color: text } : { background: '#E8E8E4', color: '#C0C0C0' }}
                                              className={`text-[9px] px-1.5 h-[16px] font-bold leading-none select-none flex items-center ${i > 0 ? 'border-l border-l-black/20' : ''}`}
                                            >
                                              {letter}
                                            </span>
                                          )
                                        })}
                                      </div>
                                    </td>
                                  )
                                }
                                case "order": {
                                  const mic = [r.searchMedication ? 'M' : '', r.searchIntermittent ? 'I' : '', r.searchContinuous ? 'C' : ''].join('')
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden" style={{ ...pDiffStyle, textAlign: col.align }}>
                                      {mic
                                        ? <span className={`text-[10px] px-1 font-mono rounded ${isSelected ? "bg-white/20" : "bg-[#E8E8E0] text-[#444]"}`}>{mic}</span>
                                        : detailsLoading
                                        ? <span className={`text-[10px] font-mono animate-pulse ${isSelected ? "text-white/40" : "text-[#B0B0B0]"}`}>···</span>
                                        : null}
                                    </td>
                                  )
                                }
                                case "facility": {
                                  // In unified mode, aggregate facilities across all variants;
                                  // each facility gets the color of its highest-priority (prod-first) domain.
                                  const facBars: { fac: string; region: string; env: string }[] = (() => {
                                    if (!isUnified) return realFacs.map(f => ({ fac: f, region: r.region, env: r.environment }))
                                    const variants = variantsByGroup.get(getSemanticKey(r)) ?? []
                                    const facBest = new Map<string, { region: string; env: string; priority: number }>()
                                    for (const v of variants) {
                                      const priority = getDomainPriority(v)
                                      for (const fac of v.activeFacilities.filter(f => !CORP_FACILITIES.has(f))) {
                                        const cur = facBest.get(fac)
                                        if (!cur || priority < cur.priority) facBest.set(fac, { region: v.region, env: v.environment, priority })
                                      }
                                    }
                                    return [...facBest.entries()]
                                      .sort((a, b) => a[1].priority - b[1].priority)
                                      .map(([fac, { region, env }]) => ({ fac, region, env }))
                                  })()
                                  const uniFacCount = facBars.length
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0 relative group" style={{ ...pDiffStyle, textAlign: col.align }}>
                                      {facilitiesLoading && facCount === 0 && r.activeFacilities.length === 0 ? (
                                        <span className="text-[#A0A0A0] italic">loading…</span>
                                      ) : detailsLoading && facCount === 0 && r.activeFacilities.length === 0 ? (
                                        <span className={`text-[10px] animate-pulse ${isSelected ? "text-white/40" : "text-[#B0B0B0]"}`}>···</span>
                                      ) : uniFacCount === 0 && r.activeFacilities.length === 0 ? null : uniFacCount === 0 ? (
                                        <span className={`text-[10px] italic ${isSelected ? "text-white/50" : "text-[#B0B0B0]"}`}>corp only</span>
                                      ) : uniFacCount === 1 ? (
                                        <span className="truncate block">{facBars[0].fac}</span>
                                      ) : (
                                        <>
                                          <div className="flex flex-wrap gap-[2px]">
                                            {facBars.map(({ fac, region, env }) => (
                                              <div
                                                key={fac}
                                                title={fac}
                                                style={isSelected ? {} : { background: getDomainColor(region, env).bg }}
                                                className={`w-[5px] h-[5px] rounded-[1px] shrink-0 ${isSelected ? "bg-white/80" : ""}`}
                                              />
                                            ))}
                                          </div>
                                          <div className="hidden group-hover:block absolute left-full top-2 ml-1 bg-[#FFFFE1] border border-black p-1 shadow z-[9999] min-w-[140px] text-black text-xs whitespace-nowrap">
                                            <div className="font-bold mb-0.5 border-b border-[#C0C0C0] pb-0.5">{uniFacCount} facilities</div>
                                            {facBars.map(({ fac, region, env }) => (
                                              <div key={fac} className="flex items-center gap-1">
                                                <span style={{ background: getDomainColor(region, env).bg }} className="w-2 h-2 rounded-[1px] inline-block shrink-0" />
                                                {fac}
                                              </div>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </td>
                                  )
                                }
                                case "charge":
                                  return (
                                    <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>
                                      {r.chargeNumber && (
                                        <FieldDiffTooltip values={pDiff ? buildFieldDomainValues('charge') : undefined}>
                                          {pDiff && onCreateTask
                                            ? <div className="flex items-center gap-0.5 group/cell min-w-0">
                                                <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                                                  <div className={`w-2 h-2 shrink-0 border ${isSelected ? "bg-white border-white" : "bg-red-500 border-red-800"}`} />
                                                  <span className="truncate">{r.chargeNumber}</span>
                                                </span>
                                                <button
                                                  onClick={e => { e.stopPropagation(); onCreateTask(r.pyxisId?.trim() || r.chargeNumber?.trim() || r.groupId, r.description, 'charge', 'Charge Number', buildFieldDomainValues('charge')) }}
                                                  className={`opacity-0 group-hover/cell:opacity-100 shrink-0 text-[7px] h-3.5 px-0.5 leading-none transition-opacity ${isSelected ? 'bg-white/20 text-white border border-white/30' : 'bg-[#1a4a9a] text-white'}`}
                                                  title="Flag Charge Number for standardization"
                                                >⚑</button>
                                              </div>
                                            : <span className="flex items-center gap-1.5">
                                                <div className={`w-2 h-2 border ${isSelected ? "bg-white border-white" : "bg-red-500 border-red-800"}`} />
                                                {r.chargeNumber}
                                              </span>
                                          }
                                        </FieldDiffTooltip>
                                      )}
                                    </td>
                                  )
                                case "pyxis":       return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('pyxis', r.pyxisId)}</td>
                                case "mnemonic":    return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('mnemonic', r.mnemonic)}</td>
                                case "generic":     return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('generic', r.genericName)}</td>
                                case "strength":    return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('strength', strengthForm)}</td>
                                case "description": return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('description', r.description)}</td>
                                case "brand":       return <td key={col.id} className="px-2 py-0.5 max-w-0" style={{ ...pDiffStyle, textAlign: col.align }}>{cellWithTask('brand', r.brandName)}</td>
                                default:            return <td key={col.id} />
                              }
                            })}
                          </tr>
                        )
                        const childRows = isUnified && expandedGroups.has(getSemanticKey(r))
                          ? (() => {
                              const variants = variantsByGroup.get(getSemanticKey(r)) ?? []
                              const regionOrder = ['west', 'central', 'east']
                              const prodVariants = variants.filter(isProd)
                                .sort((a, b) => regionOrder.indexOf(a.region) - regionOrder.indexOf(b.region))
                              const diffCols = computeDiffCols(prodVariants)

                              return prodVariants.flatMap(v => {
                                const dk = getDomainKey(v)
                                const [vreg] = dk.split('_')
                                const { bg: vbg, text: vtext, border: vborder } = getDomainColor(vreg, 'prod')
                                const nonProdForRegion = variants.filter(nv => nv.region === vreg && !isProd(nv))
                                const regionKey = `${getSemanticKey(r)}:${vreg}`
                                const isRegionExpanded = expandedRegions.has(regionKey)
                                const vStrengthForm = [v.strength, v.strengthUnit, v.dosageForm].filter(Boolean).join(' ')

                                const prodRow = (
                                  <tr key={`${v.groupId}-${dk}-l1`}
                                    className="border-b border-[#E0E0E0] text-[11px]"
                                    style={{ borderLeft: `4px solid ${vborder}`, background: getDomainColor(vreg, 'prod').tint }}
                                  >
                                    <td className="pl-1 pr-0 py-0 text-center w-5 shrink-0">
                                      {nonProdForRegion.length > 0 && (
                                        <button
                                          onClick={e => toggleRegion(getSemanticKey(r), vreg, e)}
                                          className="text-[10px] font-bold leading-none w-4 h-4 flex items-center justify-center rounded text-[#316AC5] hover:bg-[#E0EAFF]"
                                          title={isRegionExpanded ? 'Collapse non-prod' : 'Expand non-prod'}
                                        >
                                          {isRegionExpanded ? '−' : '+'}
                                        </button>
                                      )}
                                    </td>
                                    {cols.map(col => {
                                      const isDiff = diffCols.has(col.id)
                                      const diffStyle = isDiff ? { background: '#FFF3CD', borderBottom: '1px solid #F59E0B' } : {}
                                      switch (col.id) {
                                        case 'domain': return (
                                          <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>
                                            <span style={{ background: vbg, color: vtext }}
                                              className="text-[9px] font-bold px-1 rounded-sm">{getDomainBadge(vreg, 'prod')}</span>
                                          </td>
                                        )
                                        case 'description': return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{v.description}</td>
                                        case 'generic':     return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{v.genericName}</td>
                                        case 'strength':    return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{vStrengthForm}</td>
                                        case 'mnemonic':    return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{v.mnemonic}</td>
                                        case 'charge':      return <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>{v.chargeNumber}</td>
                                        case 'brand':       return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{v.brandName}</td>
                                        case 'pyxis':       return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{v.pyxisId}</td>
                                        case 'order':       return <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>{[v.searchMedication && 'Med', v.searchIntermittent && 'Int', v.searchContinuous && 'Cont'].filter(Boolean).join('/')}</td>
                                        case 'facility': {
                                          const vFacs = v.activeFacilities.filter(f => !CORP_FACILITIES.has(f))
                                          if (vFacs.length === 0) return <td key={col.id} style={{ ...diffStyle, textAlign: col.align }} />
                                          if (vFacs.length === 1) return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{vFacs[0]}</td>
                                          return (
                                            <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>
                                              <div className="flex flex-wrap gap-[2px]">
                                                {vFacs.map(f => <div key={f} title={f} style={{ background: vbg }} className="w-[5px] h-[5px] rounded-[1px] shrink-0" />)}
                                              </div>
                                            </td>
                                          )
                                        }
                                        default:            return <td key={col.id} style={{ ...diffStyle, textAlign: col.align }} />
                                      }
                                    })}
                                  </tr>
                                )

                                if (!isRegionExpanded || nonProdForRegion.length === 0) return [prodRow]

                                const nonProdDiffCols = computeDiffCols([v, ...nonProdForRegion])
                                const subRows = nonProdForRegion.map(nv => {
                                  const ndk = getDomainKey(nv)
                                  const [, nenv] = ndk.split('_')
                                  const { bg: nbg, text: ntext, border: nborder } = getDomainColor(vreg, nenv)
                                  const nvStrengthForm = [nv.strength, nv.strengthUnit, nv.dosageForm].filter(Boolean).join(' ')
                                  return (
                                    <tr key={`${nv.groupId}-${ndk}-l2`}
                                      className="border-b border-[#E8E8E8] text-[11px]"
                                      style={{ borderLeft: `4px solid ${nborder}`, background: getDomainColor(vreg, nenv).tint }}
                                    >
                                      <td className="pl-5 pr-0 py-0 text-center w-5 shrink-0">
                                        <span style={{ background: nbg, color: ntext }}
                                          className="text-[9px] font-bold px-1 rounded-sm inline-block">
                                          {getDomainBadge(vreg, nenv)}
                                        </span>
                                      </td>
                                      {cols.map(col => {
                                        const isDiff = nonProdDiffCols.has(col.id)
                                        const diffStyle = isDiff ? { background: '#FFF3CD', borderBottom: '1px solid #F59E0B' } : {}
                                        switch (col.id) {
                                          case 'domain': return (
                                            <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>
                                              <span style={{ background: nbg, color: ntext }}
                                                className="text-[9px] font-bold px-1 rounded-sm">{getDomainBadge(vreg, nenv)}</span>
                                              <span className="text-[9px] text-[#888] ml-1">{nenv}</span>
                                            </td>
                                          )
                                          case 'description': return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nv.description}</td>
                                          case 'generic':     return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nv.genericName}</td>
                                          case 'strength':    return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nvStrengthForm}</td>
                                          case 'mnemonic':    return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nv.mnemonic}</td>
                                          case 'charge':      return <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>{nv.chargeNumber}</td>
                                          case 'brand':       return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nv.brandName}</td>
                                          case 'pyxis':       return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nv.pyxisId}</td>
                                          case 'order':       return <td key={col.id} className="px-2 py-0.5" style={{ ...diffStyle, textAlign: col.align }}>{[nv.searchMedication && 'Med', nv.searchIntermittent && 'Int', nv.searchContinuous && 'Cont'].filter(Boolean).join('/')}</td>
                                          case 'facility': {
                                            const nvFacs = nv.activeFacilities.filter(f => !CORP_FACILITIES.has(f))
                                            if (nvFacs.length === 0) return <td key={col.id} style={{ ...diffStyle, textAlign: col.align }} />
                                            if (nvFacs.length === 1) return <td key={col.id} className="px-2 py-0.5 truncate max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>{nvFacs[0]}</td>
                                            return (
                                              <td key={col.id} className="px-2 py-0.5 max-w-0 overflow-hidden" style={{ ...diffStyle, textAlign: col.align }}>
                                                <div className="flex flex-wrap gap-[2px]">
                                                  {nvFacs.map(f => <div key={f} title={f} style={{ background: nbg }} className="w-[5px] h-[5px] rounded-[1px] shrink-0" />)}
                                                </div>
                                              </td>
                                            )
                                          }
                                          default:            return <td key={col.id} style={{ ...diffStyle, textAlign: col.align }} />
                                        }
                                      })}
                                    </tr>
                                  )
                                })

                                return [prodRow, ...subRows]
                              })
                            })()
                          : null
                        return childRows ? <Fragment key={`${r.groupId}-${idx}-group`}>{parentRow}{childRows}</Fragment> : parentRow
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
                    className="bg-[#F0F0F0] border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.4)] text-xs font-sans py-0.5 min-w-[140px]"
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <button
                      className="w-full text-left px-4 py-0.5 hover:bg-[#316AC5] hover:text-white whitespace-nowrap disabled:text-[#A0A0A0]"
                      disabled={!ctxMenu.text}
                      onClick={() => { navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null) }}
                    >
                      Copy
                    </button>
                    <div className="border-t border-[#C0C0C0] my-0.5" />
                    <button
                      className="w-full text-left px-4 py-0.5 hover:bg-[#316AC5] hover:text-white whitespace-nowrap"
                      onClick={() => {
                        const { x, y, groupId, description } = ctxMenu
                        setCtxMenu(null)
                        fetch('/api/categories')
                          .then(r => r.json())
                          .then((d: { categories: DrugCategory[] }) => {
                            setCatPicker({
                              x, y,
                              groupId: groupId ?? '',
                              description: description ?? '',
                              categories: d.categories ?? [],
                              selected: new Set(),
                              saving: false,
                            })
                          })
                          .catch(() => {})
                      }}
                    >
                      Add to Category…
                    </button>
                  </div>
                </>
              )}

              {/* Category picker */}
              {catPicker && (
                <>
                  <div className="fixed inset-0 z-[9998]" onClick={() => setCatPicker(null)} />
                  <div
                    style={{ position: 'fixed', left: catPicker.x, top: catPicker.y, zIndex: 9999 }}
                    className="bg-[#F0F0F0] border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.4)] text-xs font-sans py-0.5 min-w-[200px] max-h-64 flex flex-col"
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <div className="px-3 py-1 text-[10px] font-mono font-bold text-[#404040] border-b border-[#C0C0C0] shrink-0">
                      Add to Category
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {catPicker.categories.length === 0 ? (
                        <div className="px-4 py-2 text-[#808080]">No categories</div>
                      ) : (
                        catPicker.categories.map(cat => (
                          <label
                            key={cat.id}
                            className="flex items-center gap-2 px-3 py-0.5 cursor-pointer hover:bg-[#E0E8FF]"
                          >
                            <input
                              type="checkbox"
                              checked={catPicker.selected.has(cat.id)}
                              onChange={e => {
                                setCatPicker(prev => {
                                  if (!prev) return prev
                                  const next = new Set(prev.selected)
                                  if (e.target.checked) next.add(cat.id)
                                  else next.delete(cat.id)
                                  return { ...prev, selected: next }
                                })
                              }}
                              className="w-3 h-3"
                            />
                            <span
                              className="w-2 h-2 rounded-sm shrink-0"
                              style={{ background: cat.color }}
                            />
                            <span className="truncate">{cat.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <div className="border-t border-[#C0C0C0] px-2 py-1 flex gap-1 shrink-0">
                      <button
                        disabled={catPicker.selected.size === 0 || catPicker.saving}
                        onClick={async () => {
                          setCatPicker(prev => prev ? { ...prev, saving: true } : prev)
                          try {
                            await Promise.all(
                              [...catPicker.selected].map(catId =>
                                fetch(`/api/categories/${catId}/members`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ groupId: catPicker.groupId, drugDescription: catPicker.description }),
                                })
                              )
                            )
                          } finally {
                            setCatPicker(null)
                          }
                        }}
                        className="flex-1 text-[10px] font-mono py-0.5 bg-[#316AC5] text-white border border-[#1a4a9a] disabled:opacity-50"
                      >
                        {catPicker.saving ? 'Adding…' : `Add (${catPicker.selected.size})`}
                      </button>
                      <button
                        onClick={() => setCatPicker(null)}
                        className="text-[10px] font-mono px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]"
                      >
                        Cancel
                      </button>
                    </div>
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

    </>
  )
}
