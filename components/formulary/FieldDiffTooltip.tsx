'use client'
import { useState } from 'react'
import type { DomainValue } from '@/lib/formulary-diff'

// Finds common prefix/suffix and marks the middle segment as changed
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
  values?: DomainValue[]
  fieldName?: string
  fieldLabel?: string
  onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void
  style?: React.CSSProperties
  className?: string
  children: React.ReactNode
}

export function FieldDiffTooltip({ values, fieldName, fieldLabel, onCreateTask, style, className, children }: Props) {
  const [show, setShow] = useState(false)
  if (!values?.length) return <div style={style} className={className}>{children}</div>

  const baseValue = values[0].value

  return (
    <div
      style={style}
      className={`relative ${className ?? ''}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute z-[200] bottom-full left-0 mb-px min-w-[200px] w-max bg-white border border-[#808080] shadow-[2px_2px_0px_#000000]">
          {/* Win95 title bar */}
          <div className="bg-[#316AC5] text-white text-[9px] font-mono font-bold px-1.5 py-0.5 flex items-center justify-between gap-2">
            <span>Domain Values</span>
            {onCreateTask && fieldName && (
              <button
                className="text-[9px] font-mono px-1.5 py-0.5 bg-[#1a4a9a] text-white hover:bg-[#0e3070] border border-white/30 leading-none"
                onClick={(e) => {
                  e.stopPropagation()
                  setShow(false)
                  onCreateTask(fieldName, fieldLabel ?? fieldName, values)
                }}
              >
                + Task
              </button>
            )}
          </div>
          <div className="p-1 space-y-0.5">
            {values.map((dv, i) => {
              const segments = i === 0 ? null : charDiff(baseValue, dv.value)
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
        </div>
      )}
    </div>
  )
}
