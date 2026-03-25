'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DesignPattern, PatternFieldRule, PatternOperator } from '@/lib/types'

const COLOR_PALETTE = [
  '#F97316', '#EF4444', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#8B5CF6', '#EC4899',
  '#6B7280', '#C85A00',
]

const LINTABLE_FIELDS: { value: string; label: string; group: string }[] = [
  // Header
  { value: 'description',   label: 'Description',    group: 'Header' },
  { value: 'genericName',   label: 'Generic Name',   group: 'Header' },
  { value: 'mnemonic',      label: 'Mnemonic',       group: 'Header' },
  { value: 'strength',      label: 'Strength',       group: 'Header' },
  { value: 'strengthUnit',  label: 'Strength Unit',  group: 'Header' },
  { value: 'dosageForm',    label: 'Dosage Form',    group: 'Header' },
  { value: 'status',        label: 'Status',         group: 'Header' },
  { value: 'legalStatus',   label: 'Legal Status',   group: 'Header' },
  // OE Defaults
  { value: 'stopType',      label: 'Stop Type',      group: 'OE Defaults' },
  { value: 'dose',          label: 'Dose',           group: 'OE Defaults' },
  { value: 'route',         label: 'Route',          group: 'OE Defaults' },
  { value: 'frequency',     label: 'Frequency',      group: 'OE Defaults' },
  { value: 'notes1',        label: 'Notes 1',        group: 'OE Defaults' },
  { value: 'notes2',        label: 'Notes 2',        group: 'OE Defaults' },
  { value: 'prnReason',     label: 'PRN Reason',     group: 'OE Defaults' },
  // Dispense
  { value: 'dispenseCategory', label: 'Dispense Category', group: 'Dispense' },
  { value: 'formularyStatus',  label: 'Formulary Status',  group: 'Dispense' },
  { value: 'packageUnit',      label: 'Package Unit',      group: 'Dispense' },
  { value: 'awpFactor',        label: 'AWP Factor',        group: 'Dispense' },
  { value: 'priceSchedule',    label: 'Price Schedule',    group: 'Dispense' },
  // Clinical
  { value: 'therapeuticClass',    label: 'Therapeutic Class',     group: 'Clinical' },
  { value: 'orderAlert1',         label: 'Order Alert 1',         group: 'Clinical' },
  { value: 'suppressMultumAlerts',label: 'Suppress Multum Alerts',group: 'Clinical' },
  // Identifiers
  { value: 'brandName',        label: 'Brand Name',       group: 'Identifiers' },
  { value: 'chargeNumber',     label: 'Charge Number',    group: 'Identifiers' },
  { value: 'labelDescription', label: 'Label Description',group: 'Identifiers' },
  { value: 'pyxisId',          label: 'Pyxis ID',         group: 'Identifiers' },
  { value: 'hcpcsCode',        label: 'HCPCS Code',       group: 'Identifiers' },
]

const SCOPE_RULE_FIELDS = LINTABLE_FIELDS.filter(f =>
  ['description','genericName','mnemonic','strength','strengthUnit','dosageForm','status',
   'dispenseCategory','therapeuticClass','formularyStatus'].includes(f.value)
)

const OPERATORS: { value: PatternOperator; label: string }[] = [
  { value: 'equals',       label: 'equals' },
  { value: 'not_equals',   label: 'not equals' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'not contains' },
  { value: 'starts_with',  label: 'starts with' },
  { value: 'ends_with',    label: 'ends with' },
  { value: 'matches_regex',label: 'matches regex' },
  { value: 'not_empty',    label: 'not empty' },
]

interface Props {
  open: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  focused?: boolean
  minimized?: boolean
  onPatternsChanged?: () => void
  onFindViolations?: (patternId: string, query: string) => void
}

function deriveSearchQuery(pattern: DesignPattern): string {
  if (pattern.scopeType !== 'rule') return ''
  try {
    const scope = JSON.parse(pattern.scopeValue) as { field: string; operator: string; value: string }
    const { operator, value } = scope
    if (['equals', 'contains', 'starts_with', 'ends_with', 'not_equals', 'not_contains'].includes(operator)) {
      return value
    }
    if (operator === 'matches_regex') {
      // Strip regex metacharacters, take first token as plain-text hint
      return value.replace(/[\\^$.*+?()[\]{}|]/g, ' ').trim().split(/\s+/)[0] ?? ''
    }
  } catch {}
  return ''
}

type Rect = { x: number; y: number; w: number; h: number }
const MIN_W = 700
const MIN_H = 420

const inp = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'
const sel = 'text-[11px] font-mono rounded-none border border-[#808080] px-1 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'

export function PatternManager({ open, onClose, onMinimize, onFocus, focused = true, minimized = false, onPatternsChanged, onFindViolations }: Props) {
  const [rect, setRect] = useState<Rect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)
  const isResizing = useRef<{ dir: string; startX: number; startY: number; startRect: Rect } | null>(null)

  useEffect(() => {
    if (rect) return
    setRect({
      x: Math.max(0, (window.innerWidth  - 860) / 2),
      y: Math.max(0, (window.innerHeight - 580) / 2),
      w: 860,
      h: 580,
    })
  }, [rect])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const { dir, startX, startY, startRect } = isResizing.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dir === 'move') { setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy }); return }
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
    e.preventDefault(); e.stopPropagation()
    isResizing.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  const toggleMaximize = () => {
    if (maximized) { if (preMaxRect.current) setRect(preMaxRect.current); setMaximized(false) }
    else { preMaxRect.current = rect; setMaximized(true) }
  }

  // Pattern data
  const [patterns, setPatterns] = useState<DesignPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = patterns.find(p => p.id === selectedId) ?? null

  // Edit state
  const [rightTab, setRightTab] = useState<'scope' | 'rules'>('scope')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editColor, setEditColor] = useState('#F97316')
  const [editScopeType, setEditScopeType] = useState<DesignPattern['scopeType']>('all')
  const [editScopeValue, setEditScopeValue] = useState('')
  const [editScopeField, setEditScopeField] = useState('description')
  const [editScopeOperator, setEditScopeOperator] = useState<PatternOperator>('equals')
  const [editScopeRuleVal, setEditScopeRuleVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // New rule form
  const [newField, setNewField] = useState('description')
  const [newOperator, setNewOperator] = useState<PatternOperator>('equals')
  const [newValue, setNewValue] = useState('')
  const [newExpected, setNewExpected] = useState('')
  const [addingRule, setAddingRule] = useState(false)

  // Category list for scope dropdown
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  // New pattern form
  const [showNew, setShowNew] = useState(false)
  const [newPatternName, setNewPatternName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchPatterns = useCallback(() => {
    setLoading(true)
    fetch('/api/design-patterns')
      .then(r => r.json())
      .then((d: { patterns: DesignPattern[] }) => setPatterns(d.patterns ?? []))
      .catch(() => setPatterns([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (open) fetchPatterns() }, [open, fetchPatterns])

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then((d: { categories: { id: string; name: string }[] }) => setCategories(d.categories ?? []))
      .catch(() => {})
  }, [])

  const selectPattern = (p: DesignPattern) => {
    setSelectedId(p.id)
    setEditName(p.name)
    setEditDesc(p.description)
    setEditColor(p.color)
    setEditScopeType(p.scopeType)
    // Parse scope value
    if (p.scopeType === 'rule') {
      try {
        const s = JSON.parse(p.scopeValue) as { field: string; operator: PatternOperator; value: string }
        setEditScopeField(s.field)
        setEditScopeOperator(s.operator)
        setEditScopeRuleVal(s.value)
        setEditScopeValue(p.scopeValue)
      } catch {
        setEditScopeField('description'); setEditScopeOperator('equals'); setEditScopeRuleVal('')
      }
    } else {
      setEditScopeValue(p.scopeValue)
    }
    setConfirmDelete(false)
    setRightTab('scope')
  }

  const buildScopeValue = (): string => {
    if (editScopeType === 'all') return ''
    if (editScopeType === 'category') return editScopeValue
    return JSON.stringify({ field: editScopeField, operator: editScopeOperator, value: editScopeRuleVal })
  }

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      await fetch(`/api/design-patterns/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, description: editDesc, color: editColor, scopeType: editScopeType, scopeValue: buildScopeValue() }),
      })
      fetchPatterns()
      onPatternsChanged?.()
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!selectedId || !confirmDelete) { setConfirmDelete(true); return }
    await fetch(`/api/design-patterns/${selectedId}`, { method: 'DELETE' })
    setSelectedId(null)
    fetchPatterns()
    onPatternsChanged?.()
  }

  const handleAddRule = async () => {
    if (!selectedId || !newField) return
    setAddingRule(true)
    try {
      await fetch(`/api/design-patterns/${selectedId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: newField, operator: newOperator, value: newValue, expectedDisplay: newExpected }),
      })
      setNewValue(''); setNewExpected('')
      fetchPatterns()
      onPatternsChanged?.()
    } finally { setAddingRule(false) }
  }

  const handleDeleteRule = async (ruleId: string) => {
    if (!selectedId) return
    await fetch(`/api/design-patterns/${selectedId}/rules/${ruleId}`, { method: 'DELETE' })
    fetchPatterns()
    onPatternsChanged?.()
  }

  const handleCreate = async () => {
    if (!newPatternName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/design-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPatternName.trim() }),
      })
      const { id } = await res.json()
      setShowNew(false); setNewPatternName('')
      fetchPatterns()
      setTimeout(() => {
        const p = patterns.find(x => x.id === id)
        if (p) selectPattern(p)
        else setSelectedId(id)
      }, 200)
    } finally { setCreating(false) }
  }

  if (!open || !rect) return null

  const effectiveRect = maximized
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    : rect

  return (
    <div
      className="fixed flex flex-col bg-[#D4D0C8] font-mono text-xs select-none shadow-2xl border border-white border-r-[#808080] border-b-[#808080]"
      style={{ left: effectiveRect.x, top: effectiveRect.y, width: effectiveRect.w, height: effectiveRect.h, zIndex: focused ? 52 : 51, display: minimized ? 'none' : undefined }}
      onPointerDown={onFocus}
    >
      {/* Resize handles */}
      {!maximized && <>
        <div onPointerDown={handlePointerDown('n')}  className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-20" />
        <div onPointerDown={handlePointerDown('s')}  className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-20" />
        <div onPointerDown={handlePointerDown('e')}  className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-20" />
        <div onPointerDown={handlePointerDown('w')}  className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-20" />
        <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-20" />
        <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-20" />
        <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-20" />
        <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-20" />
      </>}

      {/* Title bar */}
      <div
        className={`flex items-center justify-between text-white px-2 h-7 shrink-0 cursor-default transition-colors ${focused ? 'bg-[#C85A00]' : 'bg-[#7A3A00]'}`}
        onPointerDown={handlePointerDown('move')}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center text-[8px]">◈</div>
          <span className="text-sm font-bold tracking-tight">Pattern Manager</span>
        </div>
        <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
          <button onClick={onMinimize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button onClick={toggleMaximize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">□</button>
          <button onClick={onClose} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">✕</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — pattern list */}
        <div className="flex flex-col w-52 shrink-0 border-r border-[#808080] bg-[#D4D0C8]">
          <div className="bg-[#808080] text-white text-[10px] font-bold px-2 py-0.5">Patterns</div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-2 text-[#808080] text-[10px]">Loading…</div>
            ) : patterns.length === 0 ? (
              <div className="p-2 text-[#808080] text-[10px]">No patterns yet.</div>
            ) : patterns.map(p => (
              <button
                key={p.id}
                onClick={() => selectPattern(p)}
                className={`w-full text-left px-2 py-1 text-[11px] flex items-center gap-1.5 border-b border-[#808080]/30 ${selectedId === p.id ? 'bg-[#316AC5] text-white' : 'hover:bg-[#C0BBAF]'}`}
              >
                <span className="shrink-0 w-3 h-3 rounded-full border border-black/20" style={{ background: p.color }} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-[#808080] p-1.5">
            {showNew ? (
              <div className="flex gap-1">
                <input
                  autoFocus
                  className={inp + ' flex-1'}
                  placeholder="Pattern name…"
                  value={newPatternName}
                  onChange={e => setNewPatternName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowNew(false); setNewPatternName('') } }}
                />
                <button
                  onClick={handleCreate}
                  disabled={creating || !newPatternName.trim()}
                  className="text-[10px] px-1.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] disabled:opacity-50"
                >
                  {creating ? '…' : '✓'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNew(true)}
                className="w-full text-[10px] py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0]"
              >
                + New Pattern
              </button>
            )}
          </div>
        </div>

        {/* RIGHT — detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-[#808080] text-[11px]">
              Select a pattern to edit.
            </div>
          ) : (
            <>
              {/* Right tabs */}
              <div className="flex gap-0.5 px-2 pt-1 bg-[#D4D0C8] shrink-0 border-b border-[#808080]">
                {(['scope', 'rules'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    className={`px-2 py-0.5 text-[11px] border-t border-l border-r border-[#808080] rounded-t-sm capitalize ${rightTab === tab ? 'bg-[#D4D0C8] border-b-[#D4D0C8] relative z-10 top-[1px] -mb-[1px]' : 'bg-[#C0BBAF] hover:bg-[#C8C4BC] border-b-[#808080]'}`}
                  >
                    {tab === 'scope' ? 'Scope & Identity' : `Field Rules (${selected.fieldRules.length})`}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {rightTab === 'scope' && (
                  <>
                    {/* Name / desc */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] w-20 text-right shrink-0">Name:</label>
                        <input className={inp + ' flex-1'} value={editName} onChange={e => setEditName(e.target.value)} />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] w-20 text-right shrink-0">Description:</label>
                        <input className={inp + ' flex-1'} value={editDesc} onChange={e => setEditDesc(e.target.value)} />
                      </div>
                    </div>

                    {/* Color picker */}
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] w-20 text-right shrink-0">Color:</label>
                      <div className="flex gap-1">
                        {COLOR_PALETTE.map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-5 h-5 border ${editColor === c ? 'border-black border-2' : 'border-[#808080]'}`}
                            style={{ background: c }}
                          />
                        ))}
                        <input
                          type="color"
                          value={editColor}
                          onChange={e => setEditColor(e.target.value)}
                          className="w-5 h-5 border border-[#808080] p-0 cursor-pointer"
                          title="Custom color"
                        />
                      </div>
                    </div>

                    {/* Scope type */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-[#404040]">Pattern applies to:</div>
                      {(['all', 'category', 'rule'] as const).map(st => (
                        <label key={st} className="flex items-center gap-2 cursor-pointer ml-4">
                          <input type="radio" name="scopeType" checked={editScopeType === st} onChange={() => setEditScopeType(st)} />
                          <span className="text-[11px]">
                            {st === 'all' && 'All drugs'}
                            {st === 'category' && 'Drugs in a category'}
                            {st === 'rule' && 'Drugs matching a field rule'}
                          </span>
                        </label>
                      ))}
                    </div>

                    {/* Scope value — category */}
                    {editScopeType === 'category' && (
                      <div className="flex items-center gap-2 ml-4">
                        <label className="text-[10px] w-20 shrink-0">Category:</label>
                        <select
                          className={sel + ' flex-1'}
                          value={editScopeValue}
                          onChange={e => setEditScopeValue(e.target.value)}
                        >
                          <option value="">— select category —</option>
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Scope value — rule */}
                    {editScopeType === 'rule' && (
                      <div className="flex items-center gap-2 ml-4 flex-wrap">
                        <select className={sel} value={editScopeField} onChange={e => setEditScopeField(e.target.value)}>
                          {SCOPE_RULE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <select className={sel} value={editScopeOperator} onChange={e => setEditScopeOperator(e.target.value as PatternOperator)}>
                          {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        {editScopeOperator !== 'not_empty' && (
                          <input
                            className={inp + ' w-40'}
                            placeholder="value…"
                            value={editScopeRuleVal}
                            onChange={e => setEditScopeRuleVal(e.target.value)}
                          />
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1 border-t border-[#808080]">
                      <button
                        onClick={handleSave}
                        disabled={saving || !editName.trim()}
                        className="text-[11px] px-3 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={handleDelete}
                        className={`text-[11px] px-3 py-0.5 border border-[#808080] ${confirmDelete ? 'bg-[#CC0000] text-white hover:bg-[#AA0000]' : 'bg-[#D4D0C8] hover:bg-[#E8E8E0]'}`}
                      >
                        {confirmDelete ? 'Confirm Delete' : 'Delete Pattern'}
                      </button>
                      {confirmDelete && (
                        <button onClick={() => setConfirmDelete(false)} className="text-[11px] px-2 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0]">
                          Cancel
                        </button>
                      )}
                      {onFindViolations && selected && (
                        <button
                          onClick={() => onFindViolations(selected.id, deriveSearchQuery(selected))}
                          className="text-[11px] px-3 py-0.5 border border-[#F97316] bg-[#FFF0E0] text-[#C04000] hover:bg-[#FFE0C0] ml-auto"
                          title="Open search filtered to violations of this pattern"
                        >
                          ◈ Find Violations
                        </button>
                      )}
                    </div>
                  </>
                )}

                {rightTab === 'rules' && (
                  <>
                    {/* Existing rules */}
                    {selected.fieldRules.length === 0 ? (
                      <div className="text-[#808080] text-[11px]">No field rules yet. Add one below.</div>
                    ) : (
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-[#808080] text-white">
                            <th className="px-1.5 py-0.5 text-left font-bold">Field</th>
                            <th className="px-1.5 py-0.5 text-left font-bold">Operator</th>
                            <th className="px-1.5 py-0.5 text-left font-bold">Value</th>
                            <th className="px-1.5 py-0.5 text-left font-bold">Expected display</th>
                            <th className="px-1 py-0.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {selected.fieldRules.map((r, i) => (
                            <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F0EDE8]'}>
                              <td className="px-1.5 py-0.5 border border-[#808080]/30">
                                {LINTABLE_FIELDS.find(f => f.value === r.field)?.label ?? r.field}
                              </td>
                              <td className="px-1.5 py-0.5 border border-[#808080]/30">
                                {OPERATORS.find(o => o.value === r.operator)?.label ?? r.operator}
                              </td>
                              <td className="px-1.5 py-0.5 border border-[#808080]/30 font-mono text-[10px]">
                                {r.operator === 'not_empty' ? <span className="text-[#808080] italic">—</span> : r.value}
                              </td>
                              <td className="px-1.5 py-0.5 border border-[#808080]/30 text-[#404040]">
                                {r.expectedDisplay}
                              </td>
                              <td className="px-1 py-0.5 border border-[#808080]/30">
                                <button
                                  onClick={() => handleDeleteRule(r.id)}
                                  className="text-[10px] text-[#CC0000] hover:text-[#990000] font-bold"
                                  title="Delete rule"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Add rule form */}
                    <div className="border-t border-[#808080] pt-2 space-y-1.5">
                      <div className="text-[10px] font-bold text-[#404040]">Add field rule:</div>
                      {/* Field + Operator row */}
                      <div className="flex gap-2 flex-wrap">
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-[#808080]">Field</label>
                          <select className={sel + ' w-44'} value={newField} onChange={e => setNewField(e.target.value)}>
                            {(() => {
                              const groups = [...new Set(LINTABLE_FIELDS.map(f => f.group))]
                              return groups.flatMap(g => [
                                <option key={`g-${g}`} disabled value="">── {g} ──</option>,
                                ...LINTABLE_FIELDS.filter(f => f.group === g).map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                )),
                              ])
                            })()}
                          </select>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-[#808080]">Operator</label>
                          <select className={sel + ' w-36'} value={newOperator} onChange={e => setNewOperator(e.target.value as PatternOperator)}>
                            {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        {newOperator !== 'not_empty' && (
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-[#808080]">Value</label>
                            <input
                              className={inp + ' w-40'}
                              placeholder="value…"
                              value={newValue}
                              onChange={e => setNewValue(e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                      {/* Expected display */}
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[9px] text-[#808080]">Expected display (shown in violation tooltip)</label>
                        <input
                          className={inp}
                          placeholder='e.g. "should end with ½ TAB"'
                          value={newExpected}
                          onChange={e => setNewExpected(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddRule() }}
                        />
                      </div>
                      <button
                        onClick={handleAddRule}
                        disabled={addingRule || !newField}
                        className="text-[11px] px-3 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] disabled:opacity-50"
                      >
                        {addingRule ? 'Adding…' : '+ Add Rule'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
