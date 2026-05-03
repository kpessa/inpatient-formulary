'use client'

import { useState } from 'react'

// Click-to-copy value (CDM, Pyxis ID, etc). Shows a brief "✓ copied" inline
// indicator on success. Falls back gracefully if clipboard API is unavailable
// (older browsers / non-HTTPS dev contexts) — the value still renders, just
// without the copy affordance.

interface Props {
  value: string
  className?: string
  /** Optional placeholder shown when value is empty (defaults to a dim em-dash). */
  emptyPlaceholder?: React.ReactNode
}

export function CopyableValue({ value, className = '', emptyPlaceholder }: Props) {
  const [copied, setCopied] = useState(false)

  if (!value) return <>{emptyPlaceholder ?? <span className="text-[#999]">—</span>}</>

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation()  // don't trigger row double-click handlers
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable — silent no-op
    }
  }

  return (
    <button
      onClick={onClick}
      onDoubleClick={e => e.stopPropagation()}
      className={`inline-flex items-center gap-1 px-1 py-px font-mono cursor-pointer hover:bg-[#FFF7C4] hover:underline ${className}`}
      title={`Click to copy ${value}`}
    >
      <span>{value}</span>
      {copied && (
        <span className="text-[#0B6E27] text-[9px] font-semibold animate-in fade-in duration-150">✓ copied</span>
      )}
    </button>
  )
}
