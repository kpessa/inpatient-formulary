'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SearchFilterGroup } from '@/lib/types'

export type AdvFilterItem = {
  id: string        // group.id, raw value string, or TC code
  type: 'group' | 'value' | 'tc'
  op: 'include' | 'exclude'
  label: string
  icon: string
  values: string[]  // exact DB values; for TC: [tcCode] (backend expands descendants)
}

// Shared chip row — same rendering for all four filter fields
export function FilterChips({
  items,
  onChange,
}: {
  items: AdvFilterItem[]
  onChange: (items: AdvFilterItem[]) => void
}) {
  if (items.length === 0) return null

  return (
    <>
      {items.map((item, idx) => {
        const prev = items[idx - 1]
        let op: string | null = null
        if (idx > 0) {
          if (item.op === 'exclude') op = 'and not'
          else if (prev.op === 'include') op = 'or'
          else op = 'and'
        }
        return (
          <span key={item.id} className="flex items-center gap-1">
            {op && (
              <span className="text-[9px] font-mono text-[#606060] italic select-none">{op}</span>
            )}
            <span className="flex items-center gap-0">
              <button
                onClick={() => onChange(items.map(i =>
                  i.id === item.id ? { ...i, op: i.op === 'include' ? 'exclude' : 'include' } : i
                ))}
                className={`h-5 px-1.5 text-[9px] font-mono flex items-center gap-0.5 border-y border-l ${
                  item.op === 'include'
                    ? 'bg-[#316AC5] text-white border-[#1a4a9a]'
                    : 'bg-[#CC0000] text-white border-[#880000]'
                }`}
                title="Click to toggle include / exclude"
              >
                {item.icon && <span className="text-[10px]">{item.icon}</span>}
                {item.label}
              </button>
              <button
                onClick={() => onChange(items.filter(i => i.id !== item.id))}
                className={`h-5 px-1 text-[9px] font-mono border-y border-r leading-none ${
                  item.op === 'include'
                    ? 'bg-[#2a5ab5] text-white/70 border-[#1a4a9a] hover:bg-[#CC0000] hover:border-[#880000] hover:text-white'
                    : 'bg-[#aa0000] text-white/70 border-[#880000] hover:bg-[#880000] hover:text-white'
                }`}
                title="Remove"
              >
                ×
              </button>
            </span>
          </span>
        )
      })}
    </>
  )
}

const FIELD_LABELS: Record<string, string> = {
  dosage_form: 'Dosage Form',
  route: 'Route',
  dispense_category: 'Dispense Cat.',
}

interface Props {
  field: 'dosage_form' | 'route' | 'dispense_category'
  filterGroups: SearchFilterGroup[]
  items: AdvFilterItem[]
  onChange: (items: AdvFilterItem[]) => void
  compact?: boolean
}

export function FieldFilterSelect({ field, filterGroups, items, onChange, compact }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'groups' | 'values'>('groups')
  const [search, setSearch] = useState('')
  const [distinctValues, setDistinctValues] = useState<string[]>([])
  const [loadingValues, setLoadingValues] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fieldGroups = filterGroups.filter(g => g.field === field)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const loadValues = useCallback(() => {
    if (distinctValues.length > 0 || loadingValues) return
    setLoadingValues(true)
    fetch(`/api/filter-groups/distinct?field=${field}`)
      .then(r => r.json())
      .then((d: { values: string[] }) => setDistinctValues(d.values ?? []))
      .catch(() => {})
      .finally(() => setLoadingValues(false))
  }, [field, distinctValues.length, loadingValues])

  const isActive = (id: string) => items.some(i => i.id === id)

  const toggleGroup = (g: SearchFilterGroup) => {
    if (isActive(g.id)) onChange(items.filter(i => i.id !== g.id))
    else onChange([...items, { id: g.id, type: 'group', op: 'include', label: g.name, icon: g.icon, values: g.values }])
  }

  const toggleValue = (v: string) => {
    if (isActive(v)) onChange(items.filter(i => i.id !== v))
    else onChange([...items, { id: v, type: 'value', op: 'include', label: v, icon: '', values: [v] }])
  }

  if (compact) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => { setIsOpen(v => !v); setSearch('') }}
          className={`h-5 px-1.5 text-[9px] font-mono border border-[#808080] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] whitespace-nowrap ${
            items.length > 0
              ? 'bg-[#E8F0FF] border-[#316AC5] text-[#316AC5]'
              : 'bg-[#D4D0C8] hover:bg-[#E8E8E0] text-black'
          }`}
        >
          ▼ {FIELD_LABELS[field]}
          {items.length > 0 && (
            <span className="ml-1 bg-[#316AC5] text-white text-[8px] px-1 rounded-full">{items.length}</span>
          )}
        </button>
        {isOpen && (
          <div className="absolute top-6 left-0 z-50 w-64 bg-white border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.3)]">
            {/* Tabs */}
            <div className="flex border-b border-[#808080] bg-[#D4D0C8]">
              <button
                onClick={() => setActiveTab('groups')}
                className={`px-2 py-0.5 text-[9px] font-mono border-r border-[#808080] ${activeTab === 'groups' ? 'bg-white' : 'hover:bg-[#C8C4BC]'}`}
              >
                Filter Groups
              </button>
              <button
                onClick={() => { setActiveTab('values'); loadValues() }}
                className={`px-2 py-0.5 text-[9px] font-mono ${activeTab === 'values' ? 'bg-white' : 'hover:bg-[#C8C4BC]'}`}
              >
                Values
              </button>
            </div>
            {/* Search */}
            <div className="p-1 border-b border-[#E0DDD8]">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter…"
                className="w-full text-[9px] font-mono border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none"
              />
            </div>
            {/* List */}
            <div className="max-h-52 overflow-y-auto">
              {activeTab === 'groups' ? (
                fieldGroups.length === 0 ? (
                  <div className="p-2 text-[9px] text-[#808080] italic">
                    No filter groups for this field. Create them in Category Manager → Filter Groups.
                  </div>
                ) : fieldGroups
                    .filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase()))
                    .map(g => (
                      <button
                        key={g.id}
                        onClick={() => toggleGroup(g)}
                        className={`w-full text-left px-2 py-1 text-[9px] font-mono flex items-center gap-1.5 border-b border-[#F0EEE8] ${
                          isActive(g.id) ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8F6F0]'
                        }`}
                      >
                        <span className="text-[11px] shrink-0">{g.icon || '▪'}</span>
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-[8px] text-[#808080] shrink-0">{g.values.length}</span>
                        {isActive(g.id) && <span className="text-[#316AC5] text-[10px] shrink-0">✓</span>}
                      </button>
                    ))
              ) : loadingValues ? (
                <div className="p-2 text-[9px] text-[#808080]">Loading…</div>
              ) : (
                distinctValues
                  .filter(v => !search || v.toLowerCase().includes(search.toLowerCase()))
                  .map(v => (
                    <button
                      key={v}
                      onClick={() => toggleValue(v)}
                      className={`w-full text-left px-2 py-0.5 text-[9px] font-mono border-b border-[#F0EEE8] flex items-center gap-1 ${
                        isActive(v) ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8F6F0]'
                      }`}
                    >
                      {isActive(v) && <span className="text-[#316AC5] text-[10px] shrink-0">✓</span>}
                      <span>{v}</span>
                    </button>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1.5" ref={containerRef}>
      <span className="text-[10px] font-mono text-[#404040] whitespace-nowrap w-24 shrink-0 pt-0.5">
        {FIELD_LABELS[field]}
      </span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0 relative">
        <button
          onClick={() => { setIsOpen(v => !v); setSearch('') }}
          className="h-5 px-1.5 text-[9px] font-mono border border-[#808080] bg-[#D4D0C8] hover:bg-[#E8E8E0] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] whitespace-nowrap shrink-0"
        >
          ▼ Add…
        </button>
        <FilterChips items={items} onChange={onChange} />

        {isOpen && (
          <div className="absolute top-6 left-0 z-50 w-64 bg-white border border-[#808080] shadow-[2px_2px_4px_rgba(0,0,0,0.3)]">
            {/* Tabs */}
            <div className="flex border-b border-[#808080] bg-[#D4D0C8]">
              <button
                onClick={() => setActiveTab('groups')}
                className={`px-2 py-0.5 text-[9px] font-mono border-r border-[#808080] ${activeTab === 'groups' ? 'bg-white' : 'hover:bg-[#C8C4BC]'}`}
              >
                Filter Groups
              </button>
              <button
                onClick={() => { setActiveTab('values'); loadValues() }}
                className={`px-2 py-0.5 text-[9px] font-mono ${activeTab === 'values' ? 'bg-white' : 'hover:bg-[#C8C4BC]'}`}
              >
                Values
              </button>
            </div>
            {/* Search */}
            <div className="p-1 border-b border-[#E0DDD8]">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter…"
                className="w-full text-[9px] font-mono border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none"
              />
            </div>
            {/* List */}
            <div className="max-h-52 overflow-y-auto">
              {activeTab === 'groups' ? (
                fieldGroups.length === 0 ? (
                  <div className="p-2 text-[9px] text-[#808080] italic">
                    No filter groups for this field. Create them in Category Manager → Filter Groups.
                  </div>
                ) : fieldGroups
                    .filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase()))
                    .map(g => (
                      <button
                        key={g.id}
                        onClick={() => toggleGroup(g)}
                        className={`w-full text-left px-2 py-1 text-[9px] font-mono flex items-center gap-1.5 border-b border-[#F0EEE8] ${
                          isActive(g.id) ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8F6F0]'
                        }`}
                      >
                        <span className="text-[11px] shrink-0">{g.icon || '▪'}</span>
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-[8px] text-[#808080] shrink-0">{g.values.length}</span>
                        {isActive(g.id) && <span className="text-[#316AC5] text-[10px] shrink-0">✓</span>}
                      </button>
                    ))
              ) : loadingValues ? (
                <div className="p-2 text-[9px] text-[#808080]">Loading…</div>
              ) : (
                distinctValues
                  .filter(v => !search || v.toLowerCase().includes(search.toLowerCase()))
                  .map(v => (
                    <button
                      key={v}
                      onClick={() => toggleValue(v)}
                      className={`w-full text-left px-2 py-0.5 text-[9px] font-mono border-b border-[#F0EEE8] flex items-center gap-1 ${
                        isActive(v) ? 'bg-[#EEF4FF]' : 'hover:bg-[#F8F6F0]'
                      }`}
                    >
                      {isActive(v) && <span className="text-[#316AC5] text-[10px] shrink-0">✓</span>}
                      <span>{v}</span>
                    </button>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
