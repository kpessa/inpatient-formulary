'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  recentSearches: string[]
  onSelect: (term: string) => void
  onClear: () => void
}

export function RecentSearchDropdown({ recentSearches, onSelect, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (recentSearches.length === 0) return null

  return (
    <div ref={ref} className="relative">
      {/* Win95 raised button */}
      <button
        onMouseDown={e => { e.preventDefault(); setOpen(v => !v) }}
        className="h-5 w-4 flex items-center justify-center text-[9px] font-mono bg-[#D4D0C8] border border-t-white border-l-white border-b-[#808080] border-r-[#808080] active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white shrink-0 cursor-default select-none"
        title="Recent searches"
        tabIndex={-1}
      >
        ▾
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-px z-[300] bg-white border border-[#808080] shadow-[2px_2px_0px_#000000] min-w-[180px] max-w-[280px] py-0.5"
          style={{ marginTop: 1 }}
        >
          {recentSearches.map((s, i) => (
            <button
              key={i}
              className="block w-full text-left px-3 py-0.5 text-[11px] font-mono cursor-default truncate hover:bg-[#316AC5] hover:text-white"
              onClick={() => { setOpen(false); onSelect(s) }}
            >
              {s}
            </button>
          ))}
          <div className="border-t border-[#C0C0C0] mt-0.5 pt-0.5">
            <button
              className="block w-full text-left px-3 py-0.5 text-[11px] font-mono cursor-default text-[#808080] hover:bg-[#316AC5] hover:text-white"
              onClick={() => { setOpen(false); onClear() }}
            >
              Clear history
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
