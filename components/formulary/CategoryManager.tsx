'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DrugCategory, CategoryRule, CategoryMember, SearchFilterGroup } from '@/lib/types'
import { TC_MAP, TC_PARENTS, tcLabel, tcHasChildren } from '@/lib/therapeutic-class-map'
import { TherapeuticClassPicker } from './TherapeuticClassPicker'

const COLOR_PALETTE = [
  '#6B7280', '#EF4444', '#F97316', '#EAB308',
  '#22C55E', '#14B8A6', '#3B82F6', '#8B5CF6',
  '#EC4899', '#C85A00',
]

const RULE_FIELDS: { value: CategoryRule['field']; label: string }[] = [
  { value: 'dispenseCategory', label: 'Dispense Category' },
  { value: 'therapeuticClass', label: 'Therapeutic Class' },
  { value: 'dosageForm',       label: 'Dosage Form' },
  { value: 'status',           label: 'Status' },
  { value: 'strength',         label: 'Strength' },
]

const RULE_OPERATORS: { value: CategoryRule['operator']; label: string }[] = [
  { value: 'equals',      label: 'equals' },
  { value: 'contains',    label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with',   label: 'ends with' },
]

interface Props {
  open: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  focused?: boolean
  minimized?: boolean
}

type RightTab = 'members' | 'rules' | 'pyxis'

type Rect = { x: number; y: number; w: number; h: number }

const MIN_W = 600
const MIN_H = 400

const inputCls = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'

export function CategoryManager({ open, onClose, onMinimize, onFocus, focused = true, minimized = false }: Props) {
  // Window geometry
  const [rect, setRect] = useState<Rect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)
  const isResizing = useRef<{ dir: string; startX: number; startY: number; startRect: Rect } | null>(null)

  useEffect(() => {
    if (rect) return
    setRect({
      x: Math.max(0, (window.innerWidth  - 900) / 2),
      y: Math.max(0, (window.innerHeight - 650) / 2),
      w: 900,
      h: 650,
    })
  }, [rect])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const { dir, startX, startY, startRect } = isResizing.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY

      if (dir === 'move') {
        setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy })
        return
      }

      let { x, y, w, h } = startRect
      if (dir.includes('e')) w = Math.max(MIN_W, startRect.w + dx)
      if (dir.includes('w')) { const nw = Math.max(MIN_W, startRect.w - dx); x = startRect.x + (startRect.w - nw); w = nw }
      if (dir.includes('s')) h = Math.max(MIN_H, startRect.h + dy)
      if (dir.includes('n')) { const nh = Math.max(MIN_H, startRect.h - dy); y = startRect.y + (startRect.h - nh); h = nh }
      setRect({ x, y, w, h })
    }
    const onUp = () => { isResizing.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])

  const handlePointerDown = (dir: string) => (e: React.PointerEvent) => {
    if (!rect || maximized) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  const toggleMaximize = () => {
    if (maximized) {
      if (preMaxRect.current) setRect(preMaxRect.current)
      setMaximized(false)
    } else {
      preMaxRect.current = rect
      setMaximized(true)
    }
  }

  // Main tab
  const [mainTab, setMainTab] = useState<'categories' | 'filter-groups'>('categories')

  // Category data
  const [categories, setCategories] = useState<DrugCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Right panel state
  const [rightTab, setRightTab] = useState<RightTab>('members')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editColor, setEditColor] = useState('#6B7280')
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [members, setMembers] = useState<CategoryMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [pyxisIds, setPyxisIds] = useState<string[]>([])
  const [pyxisInput, setPyxisInput] = useState('')
  const [pyxisSaving, setPyxisSaving] = useState(false)
  const [pyxisPopulating, setPyxisPopulating] = useState(false)
  const [pyxisPopulateMsg, setPyxisPopulateMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // New rule form
  const [newRuleField, setNewRuleField] = useState<CategoryRule['field']>('dispenseCategory')
  const [newRuleOperator, setNewRuleOperator] = useState<CategoryRule['operator']>('equals')
  const [newRuleValue, setNewRuleValue] = useState('')
  const [addingRule, setAddingRule] = useState(false)
  const [fieldValues, setFieldValues] = useState<string[]>([])
  const [fieldValuesLoading, setFieldValuesLoading] = useState(false)
  const [showValueDropdown, setShowValueDropdown] = useState(false)
  const valueInputRef = useRef<HTMLInputElement>(null)
  const dropdownHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // New category form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newColor, setNewColor] = useState('#6B7280')
  const [creating, setCreating] = useState(false)

  const fetchFieldValues = useCallback((field: string) => {
    const cacheKey = `pharmnet-field-values-${field}`

    // Serve cache immediately — no spinner if we have data
    let cached: string[] = []
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) cached = JSON.parse(raw) as string[]
    } catch {}

    if (cached.length > 0) {
      setFieldValues(cached)
    } else {
      setFieldValuesLoading(true)
    }

    // Background fetch — update only if values changed
    fetch(`/api/categories/field-values?field=${encodeURIComponent(field)}`)
      .then(r => r.json())
      .then((d: { values: string[] }) => {
        const fresh = d.values ?? []
        if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
          setFieldValues(fresh)
          try { localStorage.setItem(cacheKey, JSON.stringify(fresh)) } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setFieldValuesLoading(false))
  }, [])

  useEffect(() => { fetchFieldValues(newRuleField) }, [newRuleField, fetchFieldValues])

  const fetchCategories = useCallback(() => {
    setLoading(true)
    fetch('/api/categories')
      .then(r => r.json())
      .then((d: { categories: DrugCategory[] }) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (open) fetchCategories() }, [open, fetchCategories])

  const selectCategory = useCallback((cat: DrugCategory) => {
    setSelectedId(cat.id)
    setEditName(cat.name)
    setEditDesc(cat.description)
    setEditColor(cat.color)
    setRules([])
    setMembers([])
    setPyxisIds([])
    setPyxisInput('')
    setPyxisPopulateMsg(null)
    setConfirmDelete(false)
    setRightTab('members')

    fetch(`/api/categories/${cat.id}`)
      .then(r => r.json())
      .then((d: { category: DrugCategory; rules: CategoryRule[] }) => {
        setRules(d.rules ?? [])
      })
      .catch(() => {})
  }, [])

  const fetchMembers = useCallback((catId: string) => {
    setMembersLoading(true)
    fetch(`/api/categories/${catId}/members`)
      .then(r => r.json())
      .then((d: { members: CategoryMember[] }) => setMembers(d.members ?? []))
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false))
  }, [])

  useEffect(() => {
    if (selectedId && rightTab === 'members') fetchMembers(selectedId)
  }, [selectedId, rightTab, fetchMembers])

  useEffect(() => {
    if (!selectedId || rightTab !== 'pyxis') return
    fetch(`/api/categories/${selectedId}/pyxis-ids`)
      .then(r => r.json())
      .then((d: { pyxisIds: string[] }) => setPyxisIds(d.pyxisIds ?? []))
      .catch(() => {})
  }, [selectedId, rightTab])

  const addPyxisId = async () => {
    const id = pyxisInput.trim()
    if (!id || !selectedId || pyxisIds.includes(id)) return
    setPyxisSaving(true)
    try {
      await fetch(`/api/categories/${selectedId}/pyxis-ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pyxisId: id }),
      })
      setPyxisIds(prev => [...prev, id])
      setPyxisInput('')
    } finally {
      setPyxisSaving(false)
    }
  }

  const removePyxisId = async (pid: string) => {
    if (!selectedId) return
    await fetch(`/api/categories/${selectedId}/pyxis-ids`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pyxisId: pid }),
    })
    setPyxisIds(prev => prev.filter(p => p !== pid))
  }

  const populateFromRules = async () => {
    if (!selectedId) return
    setPyxisPopulating(true)
    setPyxisPopulateMsg(null)
    try {
      const res = await fetch(`/api/categories/${selectedId}/pyxis-ids`, { method: 'PATCH' })
      const { added, pyxisIds: updated } = await res.json() as { added: number; pyxisIds: string[] }
      setPyxisIds(updated)
      setPyxisPopulateMsg(`Added ${added} new ID${added !== 1 ? 's' : ''} (${updated.length} total)`)
    } finally {
      setPyxisPopulating(false)
    }
  }

  const saveEdits = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      await fetch(`/api/categories/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDesc, color: editColor }),
      })
      fetchCategories()
    } finally {
      setSaving(false)
    }
  }

  const deleteCategory = async () => {
    if (!selectedId) return
    await fetch(`/api/categories/${selectedId}`, { method: 'DELETE' })
    setSelectedId(null)
    setConfirmDelete(false)
    fetchCategories()
  }

  const createCategory = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), color: newColor }),
      })
      const { category } = await res.json() as { category: DrugCategory }
      setNewName('')
      setNewDesc('')
      setNewColor('#6B7280')
      setShowNewForm(false)
      fetchCategories()
      selectCategory(category)
    } finally {
      setCreating(false)
    }
  }

  const addRule = async () => {
    if (!selectedId || !newRuleValue.trim()) return
    setAddingRule(true)
    try {
      const res = await fetch(`/api/categories/${selectedId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: newRuleField, operator: newRuleOperator, value: newRuleValue.trim() }),
      })
      const { rule } = await res.json() as { rule: CategoryRule }
      setRules(prev => [...prev, rule])
      setNewRuleValue('')
      fetchCategories()
    } finally {
      setAddingRule(false)
    }
  }

  const removeRule = async (ruleId: string) => {
    if (!selectedId) return
    await fetch(`/api/categories/${selectedId}/rules`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleId }),
    })
    setRules(prev => prev.filter(r => r.id !== ruleId))
    fetchCategories()
    if (rightTab === 'members') fetchMembers(selectedId)
  }

  const removeMember = async (groupId: string) => {
    if (!selectedId) return
    await fetch(`/api/categories/${selectedId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    })
    setMembers(prev => prev.filter(m => m.groupId !== groupId))
    fetchCategories()
  }

  const removeExclusion = async (groupId: string) => {
    if (!selectedId) return
    await fetch(`/api/categories/${selectedId}/exclusions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    })
    setMembers(prev => prev.filter(m => !(m.groupId === groupId && m.source === 'excluded')))
    fetchCategories()
  }

  const selectedCat = categories.find(c => c.id === selectedId)

  // ── Filter Groups state ──────────────────────────────────────────────────
  const [filterGroups, setFilterGroups] = useState<SearchFilterGroup[]>([])
  const [filterGroupsLoading, setFilterGroupsLoading] = useState(false)
  const [selectedFGId, setSelectedFGId] = useState<string | null>(null)
  // Edit form
  const [fgName, setFgName] = useState('')
  const [fgIcon, setFgIcon] = useState('')
  const [fgField, setFgField] = useState<SearchFilterGroup['field']>('dosage_form')
  const [fgValues, setFgValues] = useState<Set<string>>(new Set())
  const [fgSaving, setFgSaving] = useState(false)
  const [fgConfirmDelete, setFgConfirmDelete] = useState(false)
  const [showFgNewForm, setShowFgNewForm] = useState(false)
  // Distinct values for multi-select
  const [distinctValues, setDistinctValues] = useState<string[]>([])
  const [distinctLoading, setDistinctLoading] = useState(false)
  const [valueSearch, setValueSearch] = useState('')
  // Load defaults
  const [loadingDefaults, setLoadingDefaults] = useState(false)

  const fetchFilterGroups = useCallback(() => {
    setFilterGroupsLoading(true)
    fetch('/api/filter-groups')
      .then(r => r.json())
      .then((d: { groups: SearchFilterGroup[] }) => setFilterGroups(d.groups ?? []))
      .catch(() => setFilterGroups([]))
      .finally(() => setFilterGroupsLoading(false))
  }, [])

  useEffect(() => {
    if (open && mainTab === 'filter-groups') fetchFilterGroups()
  }, [open, mainTab, fetchFilterGroups])

  const fetchDistinctValues = useCallback((field: SearchFilterGroup['field']) => {
    setDistinctLoading(true)
    setDistinctValues([])
    fetch(`/api/filter-groups/distinct?field=${field}`)
      .then(r => r.json())
      .then((d: { values: string[] }) => setDistinctValues(d.values ?? []))
      .catch(() => setDistinctValues([]))
      .finally(() => setDistinctLoading(false))
  }, [])

  useEffect(() => {
    if (mainTab === 'filter-groups' && (showFgNewForm || selectedFGId)) {
      fetchDistinctValues(fgField)
    }
  }, [fgField, mainTab, showFgNewForm, selectedFGId, fetchDistinctValues])

  const selectFilterGroup = (g: SearchFilterGroup) => {
    setSelectedFGId(g.id)
    setFgName(g.name)
    setFgIcon(g.icon)
    setFgField(g.field)
    setFgValues(new Set(g.values))
    setFgConfirmDelete(false)
    setShowFgNewForm(false)
    setValueSearch('')
  }

  const saveFg = async () => {
    if (!fgName.trim()) return
    setFgSaving(true)
    try {
      if (selectedFGId) {
        await fetch(`/api/filter-groups/${selectedFGId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fgName, icon: fgIcon, field: fgField, values: [...fgValues] }),
        })
      } else {
        await fetch('/api/filter-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fgName, icon: fgIcon, field: fgField, values: [...fgValues] }),
        })
        setShowFgNewForm(false)
      }
      fetchFilterGroups()
    } finally {
      setFgSaving(false)
    }
  }

  const deleteFg = async () => {
    if (!selectedFGId) return
    await fetch(`/api/filter-groups/${selectedFGId}`, { method: 'DELETE' })
    setSelectedFGId(null)
    setFgConfirmDelete(false)
    fetchFilterGroups()
  }

  const FIELD_LABELS: Record<SearchFilterGroup['field'], string> = {
    dosage_form: 'Dosage Form',
    route: 'Route',
    dispense_category: 'Dispense Category',
  }

  const DEFAULT_GROUPS: { name: string; icon: string; field: SearchFilterGroup['field']; keywords: string[] }[] = [
    { name: 'Oral Solid',       icon: '💊', field: 'dosage_form', keywords: ['TAB','CAP','CAPLET','CHEWABLE','FILM','WAFER','LOZENGE','TABLET','CAPSULE','TROCHE'] },
    { name: 'Oral Liquid',      icon: '🧃', field: 'dosage_form', keywords: ['ORAL SOL','SOLN ORAL','SUSP','SYRUP','ELIXIR','LIQUID','ORAL LIQ'] },
    { name: 'Extended Release', icon: '⏱',  field: 'dosage_form', keywords: ['ER','XR','XL','SR','LA','CR','DR','EXTEND','SUSTAIN','CONTROL','DELAY','MODIFIED REL'] },
    { name: 'Oral Syringe',     icon: '💉', field: 'dosage_form', keywords: ['SYR ORAL','ORAL SYRINGE','SYRINGE ORAL'] },
    { name: 'Parenteral',       icon: '🏥', field: 'dosage_form', keywords: ['INJ','VIAL','AMP','INFUSION','IV SOL','INTRAVENOUS','INTRAMUSCULAR','SUBCUTANEOUS'] },
    { name: 'IV Syringe',       icon: '🩺', field: 'dosage_form', keywords: ['SYRINGE'] },
    { name: 'Inhalation',       icon: '💨', field: 'dosage_form', keywords: ['MDI','INHALER','INHAL','AEROSOL','NEBUL','NEB'] },
    { name: 'Topical',          icon: '🩹', field: 'dosage_form', keywords: ['CREAM','OINT','LOTION','GEL','PATCH','FOAM','PASTE','TOPICAL'] },
    { name: 'Ophthalmic/Otic',  icon: '👁',  field: 'dosage_form', keywords: ['OPHTH','EYE','OTIC','EAR'] },
    { name: 'Suppository',      icon: '🔵', field: 'dosage_form', keywords: ['SUPP'] },
    { name: 'Oral (Route)',     icon: '🗣', field: 'route',        keywords: ['ORAL','PO'] },
    { name: 'IV (Route)',       icon: '💉', field: 'route',        keywords: ['INTRAVENOUS','IV','IVPB','IVP'] },
    { name: 'IM (Route)',       icon: '💪', field: 'route',        keywords: ['INTRAMUSCULAR','IM'] },
    { name: 'SubQ (Route)',     icon: '🩺', field: 'route',        keywords: ['SUBCUTANEOUS','SQ','SUBQ'] },
    { name: 'Inhalation (Rt)', icon: '💨', field: 'route',        keywords: ['INHALATION','INHALED','INH'] },
    { name: 'Topical (Route)', icon: '🩹', field: 'route',        keywords: ['TOPICAL','TOP'] },
    { name: 'Ophthalmic (Rt)', icon: '👁',  field: 'route',        keywords: ['OPHTHALMIC','OPHTH'] },
    { name: 'Rectal (Route)',  icon: '🔵', field: 'route',        keywords: ['RECTAL','PR'] },
  ]

  const loadDefaults = async () => {
    setLoadingDefaults(true)
    try {
      // Fetch distinct values for all fields in parallel
      const [dfResp, rtResp, dcResp] = await Promise.all([
        fetch('/api/filter-groups/distinct?field=dosage_form').then(r => r.json()) as Promise<{ values: string[] }>,
        fetch('/api/filter-groups/distinct?field=route').then(r => r.json()) as Promise<{ values: string[] }>,
        fetch('/api/filter-groups/distinct?field=dispense_category').then(r => r.json()) as Promise<{ values: string[] }>,
      ])
      const valuesByField: Record<string, string[]> = {
        dosage_form: dfResp.values ?? [],
        route: rtResp.values ?? [],
        dispense_category: dcResp.values ?? [],
      }

      for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
        const def = DEFAULT_GROUPS[i]
        const allVals = valuesByField[def.field] ?? []
        const matched = allVals.filter(v =>
          def.keywords.some(kw => v.toUpperCase().includes(kw))
        )
        if (matched.length === 0) continue
        await fetch('/api/filter-groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: def.name, icon: def.icon, field: def.field, values: matched, sortOrder: i }),
        })
      }
      fetchFilterGroups()
    } finally {
      setLoadingDefaults(false)
    }
  }

  if (!open || !rect) return null

  const zIndex = focused ? 51 : 50
  const style = maximized
    ? { position: 'fixed' as const, inset: 0, zIndex, display: minimized ? 'none' as const : undefined }
    : { position: 'fixed' as const, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex, display: minimized ? 'none' as const : undefined }

  return (
    <div
      className="flex flex-col bg-[#D4D0C8] font-mono text-xs border border-white border-r-[#808080] border-b-[#808080] shadow-2xl select-none"
      style={style}
      onPointerDownCapture={onFocus}
    >
      {/* Resize handles — hidden when maximized */}
      {!maximized && <>
        <div onPointerDown={handlePointerDown('n')}  className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-10" />
        <div onPointerDown={handlePointerDown('s')}  className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-10" />
        <div onPointerDown={handlePointerDown('e')}  className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-10" />
        <div onPointerDown={handlePointerDown('w')}  className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-10" />
        <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-10" />
        <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-10" />
        <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-10" />
        <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-10" />
      </>}

      {/* Title bar */}
      <div
        className={`flex items-center justify-between text-white px-2 h-7 shrink-0 cursor-default transition-colors duration-150 ${focused ? 'bg-[#316AC5]' : 'bg-[#808080]'}`}
        onPointerDown={handlePointerDown('move')}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">🏷</div>
          <span className="text-sm font-bold font-mono tracking-tight">Category Manager</span>
        </div>
        <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
          <button onPointerDown={e => { e.stopPropagation(); onMinimize?.() }} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button
            onClick={toggleMaximize}
            className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none"
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button
            onClick={onClose}
            className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main tab bar */}
      <div className="flex gap-0.5 px-2 pt-1 bg-[#D4D0C8] border-b border-[#808080] shrink-0">
        {(['categories', 'filter-groups'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`px-2 py-0.5 text-[10px] font-mono border-t border-l border-r border-[#808080] rounded-t-sm ${
              mainTab === tab
                ? 'bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px]'
                : 'bg-[#C8C4BC] hover:bg-[#D4D0C8] mt-0.5 border-b-[#808080]'
            }`}
          >
            {tab === 'categories' ? '🏷 Drug Categories' : '🔍 Filter Groups'}
          </button>
        ))}
      </div>

      {/* Body — two-panel layout */}
      <div className="flex flex-1 min-h-0">
      {mainTab === 'filter-groups' ? (
        /* ── Filter Groups panel ──────────────────────────────────────────── */
        <div className="flex flex-1 min-h-0">
          {/* Left: group list */}
          <div className="w-56 border-r border-[#808080] flex flex-col shrink-0">
            <div className="p-1.5 border-b border-[#808080] flex flex-col gap-1">
              <button
                onClick={() => { setShowFgNewForm(v => !v); setSelectedFGId(null); setFgName(''); setFgIcon(''); setFgField('dosage_form'); setFgValues(new Set()); setValueSearch('') }}
                className="w-full text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-left"
              >
                {showFgNewForm ? '− Cancel' : '+ New Filter Group'}
              </button>
              <button
                onClick={loadDefaults}
                disabled={loadingDefaults}
                className="w-full text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-left disabled:opacity-50"
                title="Pre-populate common dosage form and route groups"
              >
                {loadingDefaults ? 'Loading…' : '⚡ Load Defaults'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filterGroupsLoading ? (
                <div className="p-2 text-[10px] text-[#808080]">Loading…</div>
              ) : filterGroups.length === 0 ? (
                <div className="p-2 text-[10px] text-[#808080]">No filter groups yet.</div>
              ) : (
                <>
                  {(['dosage_form', 'route', 'dispense_category'] as const).map(field => {
                    const groups = filterGroups.filter(g => g.field === field)
                    if (groups.length === 0) return null
                    return (
                      <div key={field}>
                        <div className="px-2 py-0.5 text-[9px] font-mono font-bold text-[#808080] bg-[#E8E4E0] border-b border-[#D0CCC8] uppercase tracking-wide">
                          {FIELD_LABELS[field]}
                        </div>
                        {groups.map(g => (
                          <button
                            key={g.id}
                            onClick={() => selectFilterGroup(g)}
                            className={`w-full text-left px-2 py-1 border-b border-[#E0DDD8] flex items-center gap-1.5 ${
                              selectedFGId === g.id ? 'bg-[#316AC5] text-white' : 'hover:bg-[#C8C4BC]'
                            }`}
                          >
                            <span className="text-[11px] shrink-0">{g.icon || '▪'}</span>
                            <span className="text-[10px] font-mono flex-1 truncate">{g.name}</span>
                            <span className={`text-[9px] px-1 rounded-full shrink-0 ${
                              selectedFGId === g.id ? 'bg-white/20 text-white' : 'bg-[#808080]/20 text-[#404040]'
                            }`}>{g.values.length}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          {/* Right: edit form */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {!selectedFGId && !showFgNewForm ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <div className="text-[11px] text-[#808080] font-mono">
                  Select a filter group to edit, or click "+ New Filter Group"
                </div>
                {filterGroups.length === 0 && (
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-[10px] text-[#808080] font-mono">— or —</div>
                    <button
                      onClick={loadDefaults}
                      disabled={loadingDefaults}
                      className="text-[11px] font-mono px-4 py-1.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] disabled:opacity-50"
                    >
                      {loadingDefaults ? 'Loading…' : '⚡ Load Defaults'}
                    </button>
                    <div className="text-[9px] text-[#808080] font-mono max-w-[220px]">
                      Pre-populate common dosage form, route, and dispense category groups
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Form header */}
                <div className="p-2 border-b border-[#808080] space-y-1.5 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={fgIcon}
                      onChange={e => setFgIcon(e.target.value)}
                      placeholder="Icon"
                      className="w-10 text-center text-[14px] border border-[#808080] bg-white px-1 py-0.5 focus:outline-none"
                      maxLength={2}
                    />
                    <input
                      value={fgName}
                      onChange={e => setFgName(e.target.value)}
                      placeholder="Group name"
                      className={`${inputCls} flex-1 font-bold`}
                    />
                    <select
                      value={fgField}
                      onChange={e => { setFgField(e.target.value as SearchFilterGroup['field']); setFgValues(new Set()); setValueSearch('') }}
                      className="text-[10px] font-mono border border-[#808080] bg-white px-1 py-0.5 focus:outline-none shrink-0"
                    >
                      <option value="dosage_form">Dosage Form</option>
                      <option value="route">Route</option>
                      <option value="dispense_category">Dispense Category</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={saveFg}
                      disabled={!fgName.trim() || fgSaving}
                      className="text-[10px] font-mono px-3 py-0.5 bg-[#316AC5] text-white border border-[#1a4a9a] disabled:opacity-50 shrink-0"
                    >
                      {fgSaving ? 'Saving…' : selectedFGId ? 'Save' : 'Create'}
                    </button>
                    {selectedFGId && (
                      fgConfirmDelete ? (
                        <>
                          <button onClick={deleteFg} className="text-[10px] font-mono px-2 py-0.5 border border-[#CC0000] bg-[#CC0000] text-white hover:bg-[#AA0000] shrink-0">Confirm Delete</button>
                          <button onClick={() => setFgConfirmDelete(false)} className="text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] shrink-0">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setFgConfirmDelete(true)} className="text-[10px] font-mono px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFCCCC] hover:border-[#CC0000] shrink-0">Delete</button>
                      )
                    )}
                    <span className="text-[10px] text-[#808080] ml-auto">{fgValues.size} value{fgValues.size !== 1 ? 's' : ''} selected</span>
                  </div>
                </div>

                {/* Multi-select values */}
                <div className="flex flex-col flex-1 overflow-hidden p-2 gap-1 min-h-0">
                  <div className="text-[10px] font-mono font-bold text-[#404040]">
                    {FIELD_LABELS[fgField]} Values
                    {distinctLoading && <span className="ml-2 text-[#808080] font-normal">Loading…</span>}
                  </div>
                  <input
                    value={valueSearch}
                    onChange={e => setValueSearch(e.target.value)}
                    placeholder="Filter values…"
                    className="text-[10px] font-mono border border-[#808080] bg-white px-1.5 py-0.5 focus:outline-none shrink-0"
                  />
                  {/* Selected chips */}
                  {fgValues.size > 0 && (
                    <div className="flex flex-wrap gap-1 shrink-0">
                      {[...fgValues].map(v => (
                        <span key={v} className="flex items-center gap-0.5 bg-[#316AC5] text-white text-[9px] font-mono px-1.5 py-0.5 border border-[#1a4a9a]">
                          {v}
                          <button
                            onClick={() => setFgValues(prev => { const n = new Set(prev); n.delete(v); return n })}
                            className="ml-0.5 text-[8px] hover:text-[#FFCCCC]"
                          >✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Checkbox list */}
                  <div className="flex-1 overflow-y-auto bg-white border border-[#808080] min-h-0">
                    {distinctValues.length === 0 && !distinctLoading ? (
                      <div className="p-2 text-[10px] text-[#808080]">
                        No values found. Run the migration script first to populate route and dispense_category columns.
                      </div>
                    ) : (
                      distinctValues
                        .filter(v => !valueSearch || v.toUpperCase().includes(valueSearch.toUpperCase()))
                        .map(v => (
                          <label
                            key={v}
                            className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono cursor-pointer hover:bg-[#E8F0FF] ${fgValues.has(v) ? 'bg-[#EEF4FF]' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={fgValues.has(v)}
                              onChange={e => {
                                setFgValues(prev => {
                                  const n = new Set(prev)
                                  if (e.target.checked) n.add(v)
                                  else n.delete(v)
                                  return n
                                })
                              }}
                              className="accent-[#316AC5] shrink-0"
                            />
                            <span className="truncate">{v}</span>
                          </label>
                        ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Drug Categories panel (existing) ────────────────────────────── */
        <>
        {/* Left panel — category list */}
        <div className="w-56 border-r border-[#808080] flex flex-col shrink-0">
          <div className="p-1.5 border-b border-[#808080]">
            <button
              onClick={() => { setShowNewForm(v => !v); setConfirmDelete(false) }}
              className="w-full text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] text-left"
            >
              {showNewForm ? '− Cancel' : '+ New Category'}
            </button>

            {showNewForm && (
              <div className="mt-1.5 space-y-1">
                <input
                  autoFocus
                  placeholder="Name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createCategory()}
                  className={inputCls}
                />
                <input
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className={inputCls}
                />
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {COLOR_PALETTE.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      style={{ background: c, boxSizing: 'border-box' }}
                      className={`w-4 h-4 rounded-sm border ${newColor === c ? 'border-[#316AC5] border-2' : 'border-[#808080]'}`}
                      title={c}
                    />
                  ))}
                </div>
                <button
                  onClick={createCategory}
                  disabled={!newName.trim() || creating}
                  className="w-full text-[10px] font-mono px-1.5 py-0.5 bg-[#316AC5] text-white border border-[#1a4a9a] disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-2 text-[10px] text-[#808080]">Loading…</div>
            ) : categories.length === 0 ? (
              <div className="p-2 text-[10px] text-[#808080]">No categories yet.</div>
            ) : (
              categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat)}
                  className={`w-full text-left px-2 py-1 border-b border-[#E0DDD8] flex items-center gap-1.5 ${
                    selectedId === cat.id ? 'bg-[#316AC5] text-white' : 'hover:bg-[#C8C4BC]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: cat.color }} />
                  <span className="text-[10px] font-mono flex-1 truncate">{cat.name}</span>
                  <span className={`text-[9px] px-1 rounded-full shrink-0 ${
                    selectedId === cat.id ? 'bg-white/20 text-white' : 'bg-[#808080]/20 text-[#404040]'
                  }`}>
                    {cat.manualCount + cat.ruleCount}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-[#808080] font-mono">
              Select a category to view details
            </div>
          ) : (
            <>
              {/* Category header / editable fields */}
              <div className="p-2 border-b border-[#808080] space-y-1.5 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        style={{ background: c, boxSizing: 'border-box' }}
                        className={`w-3.5 h-3.5 rounded-sm border ${editColor === c ? 'border-[#316AC5] border-2' : 'border-[#808080]'}`}
                        title={c}
                      />
                    ))}
                  </div>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className={`${inputCls} flex-1 font-bold`}
                    placeholder="Category name"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    className={`${inputCls} flex-1`}
                    placeholder="Description (optional)"
                  />
                  <button
                    onClick={saveEdits}
                    disabled={saving}
                    className="text-[10px] font-mono px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] shrink-0 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  {confirmDelete ? (
                    <>
                      <button
                        onClick={deleteCategory}
                        className="text-[10px] font-mono px-2 py-0.5 border border-[#CC0000] bg-[#CC0000] text-white hover:bg-[#AA0000] shrink-0"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] shrink-0"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-[10px] font-mono px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#FFCCCC] hover:border-[#CC0000] shrink-0"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0.5 px-2 pt-1.5 border-b border-[#808080] shrink-0">
                {(['members', 'rules', 'pyxis'] as RightTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    className={`px-2 py-0.5 text-[10px] font-mono border-t border-l border-r border-[#808080] rounded-t-sm ${
                      rightTab === tab
                        ? 'bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px]'
                        : 'bg-[#C8C4BC] hover:bg-[#D4D0C8] mt-0.5 border-b-[#808080]'
                    }`}
                  >
                    {tab === 'members'
                      ? `Members (${selectedCat ? selectedCat.manualCount : 0} manual)`
                      : tab === 'rules'
                      ? `Rules (${rules.length})`
                      : `Pyxis IDs${pyxisIds.length > 0 ? ` (${pyxisIds.length})` : ''}`}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-2 min-h-0">
                {rightTab === 'members' && (
                  <>
                    {membersLoading ? (
                      <div className="text-[10px] text-[#808080]">Resolving members…</div>
                    ) : members.length === 0 ? (
                      <div className="text-[10px] text-[#808080]">
                        No members. Add drugs via right-click in Search, or add rules below.
                      </div>
                    ) : (
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr className="border-b border-[#808080] bg-[#C8C4BC]">
                            <th className="text-left px-1.5 py-0.5 font-mono font-bold">Description</th>
                            <th className="text-left px-1.5 py-0.5 font-mono font-bold">Group ID</th>
                            <th className="text-left px-1.5 py-0.5 font-mono font-bold">Source</th>
                            <th className="px-1.5 py-0.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m, i) => (
                            <tr
                              key={m.groupId}
                              className={`border-b border-[#E0DDD8] ${i % 2 === 0 ? 'bg-white' : 'bg-[#F8F8F8]'}`}
                            >
                              <td className="px-1.5 py-0.5 truncate max-w-xs">{m.drugDescription}</td>
                              <td className="px-1.5 py-0.5 text-[#406090] whitespace-nowrap">{m.groupId}</td>
                              <td className="px-1.5 py-0.5 whitespace-nowrap">
                                {m.source === 'manual' ? (
                                  <span className="bg-[#316AC5] text-white px-1 py-[1px] rounded-sm text-[9px]">manual</span>
                                ) : m.source === 'excluded' ? (
                                  <span className="bg-[#808080] text-white px-1 py-[1px] rounded-sm text-[9px]">excluded</span>
                                ) : (
                                  <span className="bg-[#22C55E] text-white px-1 py-[1px] rounded-sm text-[9px]">rule</span>
                                )}
                              </td>
                              <td className="px-1.5 py-0.5 text-right whitespace-nowrap">
                                {m.source === 'manual' && (
                                  <button
                                    onClick={() => removeMember(m.groupId)}
                                    className="text-[9px] text-[#CC0000] hover:underline"
                                  >
                                    ✕ Remove
                                  </button>
                                )}
                                {m.source === 'excluded' && (
                                  <button
                                    onClick={() => removeExclusion(m.groupId)}
                                    className="text-[9px] text-[#316AC5] hover:underline"
                                  >
                                    ↩ Un-exclude
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                )}

                {rightTab === 'pyxis' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1">
                      <input
                        value={pyxisInput}
                        onChange={e => setPyxisInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addPyxisId()}
                        placeholder="Pyxis ID…"
                        className={inputCls + ' flex-1'}
                      />
                      <button
                        onClick={addPyxisId}
                        disabled={pyxisSaving || !pyxisInput.trim()}
                        className="px-2 py-0.5 text-[10px] font-mono border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DCD4] disabled:opacity-40 shrink-0"
                      >
                        Add
                      </button>
                    </div>
                    {rules.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={populateFromRules}
                          disabled={pyxisPopulating}
                          className="px-2 py-0.5 text-[10px] font-mono border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DCD4] disabled:opacity-40 shrink-0"
                          title="Run all rules, look up Pyxis IDs for matched drugs, and add them to this list"
                        >
                          {pyxisPopulating ? 'Populating…' : `Populate from Rules (${rules.length})`}
                        </button>
                        {pyxisPopulateMsg && (
                          <span className="text-[9px] text-[#22C55E] font-mono">{pyxisPopulateMsg}</span>
                        )}
                      </div>
                    )}
                    {pyxisIds.length === 0 ? (
                      <div className="text-[10px] text-[#808080]">No Pyxis IDs. Type one above and press Enter or Add.</div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {pyxisIds.map(pid => (
                          <div key={pid} className="flex items-center justify-between px-1.5 py-0.5 bg-white border border-[#D0CCC8] text-[10px] font-mono">
                            <span>{pid}</span>
                            <button
                              onClick={() => removePyxisId(pid)}
                              className="text-[9px] text-[#CC0000] hover:underline ml-2 shrink-0"
                            >
                              ✕ Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {rightTab === 'rules' && (
                  <div className="space-y-2">
                    {rules.length === 0 ? (
                      <div className="text-[10px] text-[#808080]">No rules. Add one below.</div>
                    ) : (
                      <div className="space-y-1">
                        {rules.map(rule => (
                          <div
                            key={rule.id}
                            className="flex items-center gap-1.5 px-2 py-1 bg-white border border-[#D0CCC8]"
                          >
                            <span className="text-[10px] font-mono">
                              <span className="bg-[#E8EEFF] px-1 rounded text-[#316AC5]">
                                {RULE_FIELDS.find(f => f.value === rule.field)?.label ?? rule.field}
                              </span>
                              {' '}
                              <span className="text-[#808080]">
                                {RULE_OPERATORS.find(o => o.value === rule.operator)?.label ?? rule.operator}
                              </span>
                              {' '}
                              <span className="bg-[#FFF8E0] px-1 rounded text-[#806000]">
                                {rule.field === 'therapeuticClass' ? tcLabel(rule.value) : rule.value}
                                {rule.field === 'therapeuticClass' && tcHasChildren(rule.value) && (
                                  <span className="ml-1 text-[8px] text-[#316AC5] font-bold" title="Includes all subcategories">⊇</span>
                                )}
                              </span>
                            </span>
                            <button
                              onClick={() => removeRule(rule.id)}
                              className="ml-auto text-[9px] text-[#CC0000] hover:underline shrink-0"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add rule form */}
                    <div className="border border-[#808080] p-2 bg-[#F0EEE8] space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-[#404040]">Add Rule</div>
                      <div className="flex gap-1">
                        <select
                          value={newRuleField}
                          onChange={e => {
                            setNewRuleField(e.target.value as CategoryRule['field'])
                            setNewRuleValue('')
                          }}
                          className="text-[10px] font-mono border border-[#808080] bg-white px-1 py-0.5 focus:outline-none flex-1"
                        >
                          {RULE_FIELDS.map(f => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                        <select
                          value={newRuleOperator}
                          onChange={e => setNewRuleOperator(e.target.value as CategoryRule['operator'])}
                          className="text-[10px] font-mono border border-[#808080] bg-white px-1 py-0.5 focus:outline-none"
                        >
                          {RULE_OPERATORS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Value input with filterable dropdown */}
                      <div className="flex gap-1 items-start">
                        <div className="relative flex-1">
                          <div className="flex items-center border border-[#808080] bg-white">
                            <input
                              ref={valueInputRef}
                              value={newRuleField === 'therapeuticClass' ? (TC_MAP[newRuleValue] ?? newRuleValue) : newRuleValue}
                              onChange={e => { setNewRuleValue(e.target.value); setShowValueDropdown(true) }}
                              onFocus={() => { if (dropdownHideTimer.current) clearTimeout(dropdownHideTimer.current); setShowValueDropdown(true) }}
                              onBlur={() => { dropdownHideTimer.current = setTimeout(() => setShowValueDropdown(false), 150) }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { setShowValueDropdown(false); addRule() }
                                if (e.key === 'Escape') setShowValueDropdown(false)
                              }}
                              placeholder={fieldValuesLoading ? 'Loading values…' : 'Type or pick a value…'}
                              className="flex-1 text-[11px] font-mono px-1.5 py-0.5 bg-white focus:outline-none"
                            />
                            {fieldValuesLoading && (
                              <span className="text-[9px] text-[#808080] px-1 shrink-0">…</span>
                            )}
                            {!fieldValuesLoading && fieldValues.length > 0 && (
                              <span className="text-[9px] text-[#808080] px-1 shrink-0">
                                {fieldValues.length}
                              </span>
                            )}
                          </div>

                          {/* Dropdown list */}
                          {showValueDropdown && !fieldValuesLoading && (() => {
                            const q = newRuleValue.trim().toLowerCase()
                            const isTC = newRuleField === 'therapeuticClass'
                            const filtered = q
                              ? fieldValues.filter(v =>
                                  v.toLowerCase().includes(q) ||
                                  (isTC && (TC_MAP[v] ?? '').toLowerCase().includes(q))
                                )
                              : fieldValues
                            if (filtered.length === 0) return null

                            const renderOption = (v: string, depth: number) => (
                              <button
                                key={v}
                                onMouseDown={e => {
                                  e.preventDefault()
                                  setNewRuleValue(v)
                                  setShowValueDropdown(false)
                                  valueInputRef.current?.focus()
                                }}
                                style={{ paddingLeft: `${8 + depth * 12}px` }}
                                className={`w-full text-left pr-2 py-0.5 text-[10px] font-mono hover:bg-[#316AC5] hover:text-white ${
                                  v === newRuleValue ? 'bg-[#E8F0FF] text-[#316AC5]' : ''
                                }`}
                              >
                                {isTC ? (TC_MAP[v] ?? v) : v}
                                {isTC && tcHasChildren(v) && (
                                  <span className="ml-1 text-[8px] opacity-60">⊇</span>
                                )}
                              </button>
                            )

                            let items: React.ReactNode[]
                            if (isTC) {
                              const filteredSet = new Set(filtered)
                              const childrenOf: Record<string, string[]> = {}
                              const roots: string[] = []
                              for (const v of filtered) {
                                const p = TC_PARENTS[v]
                                if (p && filteredSet.has(p)) {
                                  if (!childrenOf[p]) childrenOf[p] = []
                                  childrenOf[p].push(v)
                                } else {
                                  roots.push(v)
                                }
                              }
                              items = roots.flatMap(parent => [
                                renderOption(parent, 0),
                                ...(childrenOf[parent] ?? []).flatMap(child => [
                                  renderOption(child, 1),
                                  ...(childrenOf[child] ?? []).map(grandchild => renderOption(grandchild, 2)),
                                ]),
                              ])
                            } else {
                              items = filtered.map(v => renderOption(v, 0))
                            }

                            return (
                              <div className="absolute left-0 right-0 top-full z-50 bg-white border border-[#808080] border-t-0 shadow-[2px_2px_4px_rgba(0,0,0,0.2)] max-h-48 overflow-y-auto">
                                {items}
                              </div>
                            )
                          })()}
                        </div>
                        {newRuleField === 'therapeuticClass' && (
                          <TherapeuticClassPicker
                            value={newRuleValue}
                            onChange={code => {
                              setNewRuleValue(code)
                              setShowValueDropdown(false)
                            }}
                          >
                            <button className="h-[26px] px-1.5 border border-[#808080] bg-[#D4D0C8] text-[10px] font-mono hover:bg-[#C0C0C0] shrink-0">
                              ...
                            </button>
                          </TherapeuticClassPicker>
                        )}
                        <button
                          onClick={addRule}
                          disabled={!newRuleValue.trim() || addingRule}
                          className="text-[10px] font-mono px-2 py-0.5 bg-[#316AC5] text-white border border-[#1a4a9a] disabled:opacity-50 shrink-0"
                        >
                          {addingRule ? 'Adding…' : 'Add'}
                        </button>
                      </div>

                      {/* Value count hint */}
                      {!fieldValuesLoading && fieldValues.length > 0 && (
                        <div className="text-[9px] text-[#808080] font-mono">
                          {fieldValues.length} distinct value{fieldValues.length !== 1 ? 's' : ''} in database
                          {newRuleValue && (() => {
                            const q = newRuleValue.trim().toLowerCase()
                            const isTC = newRuleField === 'therapeuticClass'
                            const n = fieldValues.filter(v =>
                              v.toLowerCase().includes(q) ||
                              (isTC && (TC_MAP[v] ?? '').toLowerCase().includes(q))
                            ).length
                            return n < fieldValues.length ? ` · ${n} match` : ''
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        </>
      )}
      </div>
    </div>
  )
}
