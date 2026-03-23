'use client'

import { useState, useMemo, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Dialog, DialogPortal, DialogOverlay, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TC_MAP, TC_PARENTS, tcLabel, tcDescendants, tcHasChildren } from '@/lib/therapeutic-class-map'

interface TherapeuticClassPickerProps {
  value: string
  onChange: (code: string) => void
  children: React.ReactNode
}

// Pre-computed at module level (static data)
const CHILDREN_OF: Record<string, string[]> = {}
for (const [child, parent] of Object.entries(TC_PARENTS)) {
  if (!CHILDREN_OF[parent]) CHILDREN_OF[parent] = []
  CHILDREN_OF[parent].push(child)
}

const ROOTS = Object.keys(TC_MAP).filter(k => !TC_PARENTS[k] && CHILDREN_OF[k])

function getAncestors(code: string): string[] {
  const ancestors: string[] = []
  let current = TC_PARENTS[code]
  while (current) {
    ancestors.push(current)
    current = TC_PARENTS[current]
  }
  return ancestors
}

export function TherapeuticClassPicker({ value, onChange, children }: TherapeuticClassPickerProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(value)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open) {
      setPending(value)
      setSearch('')
      if (value) {
        setExpanded(new Set(getAncestors(value)))
      } else {
        setExpanded(new Set())
      }
    }
  }, [open, value])

  const toggle = (code: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const searchResults = useMemo(() => {
    if (!search) return null
    const q = search.toLowerCase()
    const matched = Object.keys(TC_MAP).filter(k =>
      (TC_MAP[k] ?? '').toLowerCase().includes(q)
    )
    const matchedSet = new Set(matched)
    const childrenOf: Record<string, string[]> = {}
    const roots: string[] = []
    for (const v of matched) {
      const p = TC_PARENTS[v]
      if (p && matchedSet.has(p)) {
        if (!childrenOf[p]) childrenOf[p] = []
        childrenOf[p].push(v)
      } else {
        roots.push(v)
      }
    }
    return { roots, childrenOf }
  }, [search])

  const renderSearchNode = (code: string, depth: number): React.ReactNode => (
    <button
      key={code}
      onClick={() => setPending(code)}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={`w-full text-left pr-2 py-0.5 text-[11px] font-mono flex items-center gap-1 ${
        pending === code ? 'bg-[#316AC5] text-white' : 'hover:bg-[#E8F0FF]'
      }`}
    >
      <span className="w-3 text-center shrink-0 text-[9px]">
        {tcHasChildren(code) ? '⊇' : ''}
      </span>
      {TC_MAP[code] ?? code}
    </button>
  )

  const renderNode = (code: string, depth: number): React.ReactNode => {
    const hasChildren = !!CHILDREN_OF[code]
    const isExpanded = expanded.has(code)
    const isSelected = pending === code

    return (
      <div key={code}>
        <div
          className={`flex items-center text-[11px] font-mono ${
            isSelected ? 'bg-[#316AC5] text-white' : 'hover:bg-[#E8F0FF]'
          }`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
        >
          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); toggle(code) }}
              className="w-4 h-4 flex items-center justify-center shrink-0 text-[9px] font-bold mr-0.5"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="w-4 h-4 mr-0.5 shrink-0" />
          )}
          <button
            onClick={() => setPending(code)}
            className="flex-1 text-left py-0.5 pr-2"
          >
            {TC_MAP[code] ?? code}
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {CHILDREN_OF[code].map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const descendants = pending ? tcDescendants(pending) : []
  const hasKids = descendants.length > 0

  return (
    <>
      <div onClick={() => setOpen(true)} className="contents">{children}</div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
        <DialogOverlay className="z-[200]" />
        <DialogPrimitive.Content
          className="rounded-none border-2 border-[#808080] bg-[#D4D0C8] p-0 font-mono shadow-[4px_4px_0_#000] max-w-[520px] fixed top-[50%] left-[50%] z-[200] w-full translate-x-[-50%] translate-y-[-50%] flex flex-col"
        >
          {/* Accessibility title (hidden) */}
          <DialogHeader className="sr-only">
            <DialogTitle>Select Therapeutic Class</DialogTitle>
          </DialogHeader>

          {/* Win95 title bar */}
          <div className="bg-[#316AC5] text-white text-[11px] font-mono font-bold px-2 py-1 flex items-center justify-between">
            <span>Select Therapeutic Class</span>
            <button
              onClick={() => setOpen(false)}
              className="w-4 h-4 bg-[#D4D0C8] text-black text-[10px] flex items-center justify-center border border-[#808080] leading-none font-bold hover:bg-[#C0C0C0]"
            >
              ✕
            </button>
          </div>

          {/* Search */}
          <div className="px-2 pt-2 pb-1 flex items-center gap-1">
            <span className="text-[10px] font-mono shrink-0">Search:</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name…"
              className="flex-1 text-[11px] font-mono px-1.5 py-0.5 border border-[#808080] bg-white focus:outline-none"
              autoFocus
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-[10px] font-mono px-1.5 py-0.5 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C0C0C0]"
              >
                ✕
              </button>
            )}
          </div>

          {/* Tree */}
          <div className="mx-2 overflow-y-auto max-h-80 bg-white border border-[#808080]">
            {searchResults ? (
              searchResults.roots.length === 0 ? (
                <div className="text-[10px] font-mono text-[#808080] p-2">No matches</div>
              ) : (
                searchResults.roots.flatMap(root => [
                  renderSearchNode(root, 0),
                  ...(searchResults.childrenOf[root] ?? []).flatMap(child => [
                    renderSearchNode(child, 1),
                    ...(searchResults.childrenOf[child] ?? []).map(gc => renderSearchNode(gc, 2)),
                  ]),
                ])
              )
            ) : (
              ROOTS.map(root => renderNode(root, 0))
            )}
          </div>

          {/* Info panel */}
          <div className="mx-2 mt-1 border border-[#808080] bg-[#FFF8E0] px-2 py-1 text-[10px] font-mono min-h-[36px]">
            {pending ? (
              hasKids ? (
                <>
                  <span className="font-bold">{tcLabel(pending)}</span>
                  {' '}includes{' '}
                  <span className="font-bold">{descendants.length}</span>
                  {' '}subcategor{descendants.length === 1 ? 'y' : 'ies'}:{' '}
                  <span className="text-[#555]">
                    {descendants.slice(0, 8).map(tcLabel).join(', ')}
                    {descendants.length > 8 ? ', …' : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-bold">{tcLabel(pending)}</span>
                  {' '}<span className="text-[#808080]">— leaf class, matches exactly this category</span>
                </>
              )
            ) : (
              <span className="text-[#808080]">Select a class from the tree above</span>
            )}
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 px-2 py-2">
            <button
              onClick={() => { if (pending) { onChange(pending); setOpen(false) } }}
              disabled={!pending}
              className="text-[11px] font-mono px-4 py-0.5 border border-[#808080] bg-[#D4D0C8] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] hover:bg-[#C0C0C0] disabled:opacity-50"
            >
              Select
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] font-mono px-4 py-0.5 border border-[#808080] bg-[#D4D0C8] shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] hover:bg-[#C0C0C0]"
            >
              Cancel
            </button>
          </div>
        </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  )
}
