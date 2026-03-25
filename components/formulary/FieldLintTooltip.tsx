'use client'
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LinterViolation } from '@/lib/types'
import type { DomainValue } from '@/lib/formulary-diff'

// Char-level diff: mark changed middle segment
function charDiff(base: string, cmp: string): Array<{ text: string; diff: boolean }> {
  if (base === cmp) return [{ text: cmp, diff: false }]
  let p = 0
  while (p < base.length && p < cmp.length && base[p] === cmp[p]) p++
  let s = 0
  while (s < base.length - p && s < cmp.length - p && base[base.length - 1 - s] === cmp[cmp.length - 1 - s]) s++
  const result: Array<{ text: string; diff: boolean }> = []
  if (p > 0) result.push({ text: cmp.slice(0, p), diff: false })
  const mid = s > 0 ? cmp.slice(p, -s) : cmp.slice(p)
  if (mid) result.push({ text: mid, diff: true })
  if (s > 0) result.push({ text: cmp.slice(-s), diff: false })
  return result
}

interface Props {
  violations?: LinterViolation[]
  diffValues?: DomainValue[]
  onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void
  fieldName?: string
  fieldLabel?: string
  style?: React.CSSProperties
  className?: string
  children: React.ReactNode
}

export function FieldLintTooltip({ violations, diffValues, onCreateTask, fieldName, fieldLabel, style, className, children }: Props) {
  const [show, setShow] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  if (!violations?.length) return <div style={style} className={className}>{children}</div>

  return (
    <div
      ref={wrapRef}
      style={style}
      className={`relative ${className ?? ''}`}
      onMouseEnter={() => {
        const r = wrapRef.current?.getBoundingClientRect()
        if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top })
        setShow(true)
      }}
      onMouseLeave={() => { setShow(false); setPos(null) }}
    >
      {children}
      {show && createPortal(
        <div
          className="fixed z-[9001] min-w-[220px] w-max bg-white border border-[#808080] shadow-[2px_2px_0px_#000000]"
          style={pos ? { left: pos.left, bottom: pos.bottom + 2 } : undefined}
        >
          <div className="bg-[#C85A00] text-white text-[9px] font-mono font-bold px-1.5 py-0.5">
            Design Pattern Violations
          </div>
          <div className="p-1 space-y-1">
            {violations.map((v, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span
                  className="shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full border border-black/20 inline-block"
                  style={{ background: v.patternColor }}
                />
                <span className="text-[10px] font-mono text-black leading-tight">
                  <span className="font-bold">{v.patternName}</span>
                  {v.suggestion && (
                    <div className="mt-0.5">
                      <span className="text-[#808080]">should be: </span>
                      <span className="font-bold text-[#C04000]">{v.suggestion}</span>
                    </div>
                  )}
                  <div className="text-[#808080] text-[9px]">{v.expected}</div>
                </span>
              </div>
            ))}
          </div>
          {diffValues && diffValues.length > 0 && (() => {
            const base = diffValues[0].value
            return (
              <>
                <div className="border-t border-[#808080]" />
                <div className="bg-[#316AC5] text-white text-[9px] font-mono font-bold px-1.5 py-0.5 flex items-center justify-between gap-2">
                  <span>Domain Values</span>
                  {onCreateTask && fieldName && (
                    <button
                      className="text-[9px] font-mono px-1.5 py-0.5 bg-[#1a4a9a] text-white hover:bg-[#0e3070] border border-white/30 leading-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShow(false)
                        onCreateTask(fieldName, fieldLabel ?? fieldName, diffValues)
                      }}
                    >
                      + Task
                    </button>
                  )}
                </div>
                <div className="p-1 space-y-0.5">
                  {diffValues.map((dv, i) => {
                    const segments = i === 0 ? null : charDiff(base, dv.value)
                    return (
                      <div key={dv.domain} className="flex items-start gap-1.5">
                        <span
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 whitespace-nowrap shrink-0 leading-none mt-0.5 min-w-[18px] text-center inline-block"
                          style={{ background: dv.bg, color: dv.text }}
                        >
                          {dv.badge}
                        </span>
                        <span className="text-[10px] font-mono text-black leading-tight whitespace-nowrap">
                          {dv.value
                            ? segments
                              ? segments.map((seg, j) =>
                                  seg.diff
                                    ? <mark key={j} className="bg-amber-300 text-black not-italic px-0">{seg.text}</mark>
                                    : <span key={j}>{seg.text}</span>
                                )
                              : dv.value
                            : <span className="text-[#808080] italic">—</span>
                          }
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </div>,
        document.body,
      )}
    </div>
  )
}
