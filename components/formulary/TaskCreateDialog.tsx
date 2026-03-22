'use client'

import { useState, useMemo } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import type { DomainValue } from '@/lib/formulary-diff'

interface Props {
  drugKey: string
  drugDescription: string
  fieldName?: string
  fieldLabel?: string
  domainValues?: DomainValue[]
  availableDomains: string[]
  onClose: () => void
  onCreated: () => void
}

export function TaskCreateDialog({
  drugKey,
  drugDescription,
  fieldName,
  fieldLabel,
  domainValues,
  availableDomains,
  onClose,
  onCreated,
}: Props) {
  const isDiff = !!fieldName
  const [targetValueMode, setTargetValueMode] = useState('')   // selected option, '__custom__', or plain text
  const [targetValueCustom, setTargetValueCustom] = useState('')
  const [targetDomain, setTargetDomain] = useState('all')
  const [assignedTo, setAssignedTo] = useState('')
  const [notes, setNotes] = useState('')
  const [freeFormLabel, setFreeFormLabel] = useState('')
  const [saving, setSaving] = useState(false)

  // Deduplicated values from domainValues for the "Standardize to" selector
  const uniqueValueOptions = useMemo(() => {
    if (!domainValues?.length) return []
    const map = new Map<string, DomainValue[]>()
    for (const dv of domainValues) {
      if (!dv.value) continue
      if (!map.has(dv.value)) map.set(dv.value, [])
      map.get(dv.value)!.push(dv)
    }
    return [...map.entries()].map(([value, dvs]) => ({ value, domains: dvs }))
  }, [domainValues])
  const showSelector = uniqueValueOptions.length >= 2
  const effectiveTargetValue = targetValueMode === '__custom__' ? targetValueCustom : targetValueMode

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const domainValuesJson = domainValues
        ? JSON.stringify(Object.fromEntries(domainValues.map(dv => [dv.domain, dv.value])))
        : undefined
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drugKey,
          drugDescription,
          type: isDiff ? 'diff' : 'free_form',
          fieldName: isDiff ? fieldName : (freeFormLabel || undefined),
          fieldLabel: isDiff ? fieldLabel : (freeFormLabel || undefined),
          targetDomain: targetDomain === 'all' ? undefined : targetDomain,
          domainValues: domainValuesJson,
          targetValue: effectiveTargetValue || undefined,
          status: 'pending',
          assignedTo: assignedTo || undefined,
          notes: notes || undefined,
        }),
      })
      onCreated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const labelClass = 'text-[10px] font-mono text-[#404040] mb-0.5'
  const inputClass = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'
  const readonlyClass = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-[#E8E4DC] text-[#606060]'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none border-2 border-[#808080] bg-[#D4D0C8] p-0 font-mono shadow-[4px_4px_0_#000] max-w-sm">
        {/* Win95 title bar */}
        <div className="bg-[#316AC5] text-white text-[11px] font-mono font-bold px-2 py-1 flex items-center">
          Add Change Task
        </div>
        <DialogHeader className="sr-only">
          <DialogTitle>Add Change Task</DialogTitle>
        </DialogHeader>

        <div className="p-3 space-y-2">
          {/* Drug */}
          <div>
            <div className={labelClass}>Drug</div>
            <div className={readonlyClass}>{drugDescription}</div>
          </div>

          {/* Field (diff task: read-only; free-form: editable) */}
          <div>
            <div className={labelClass}>{isDiff ? 'Field' : 'Task description'}</div>
            {isDiff
              ? <div className={readonlyClass}>{fieldLabel ?? fieldName}</div>
              : <input
                  className={inputClass}
                  placeholder="e.g. Update charge number"
                  value={freeFormLabel}
                  onChange={e => setFreeFormLabel(e.target.value)}
                />
            }
          </div>

          {/* Current domain values (diff tasks only) */}
          {isDiff && domainValues && domainValues.length > 0 && (
            <div>
              <div className={labelClass}>Current values</div>
              <div className="border border-[#808080] bg-white p-1 space-y-0.5">
                {domainValues.map(dv => (
                  <div key={dv.domain} className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span
                      className="px-1 py-0 font-bold text-[9px] min-w-[16px] text-center"
                      style={{ background: dv.bg, color: dv.text }}
                    >
                      {dv.badge}
                    </span>
                    <span className="text-black">{dv.value || <span className="text-[#808080] italic">—</span>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Target value — smart selector when domain values differ */}
          <div>
            <div className={labelClass}>Standardize to</div>
            {showSelector ? (
              <>
                <select
                  className={inputClass}
                  value={targetValueMode}
                  onChange={e => setTargetValueMode(e.target.value)}
                >
                  <option value="">— select target —</option>
                  {uniqueValueOptions.map(({ value, domains }) => (
                    <option key={value} value={value}>
                      [{domains.map(d => d.badge).join(' ')}] {value}
                    </option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
                {targetValueMode === '__custom__' && (
                  <input
                    className={`${inputClass} mt-1`}
                    placeholder="Type target value…"
                    value={targetValueCustom}
                    onChange={e => setTargetValueCustom(e.target.value)}
                    autoFocus
                  />
                )}
              </>
            ) : (
              <input
                className={inputClass}
                placeholder="What should it be?"
                value={targetValueMode}
                onChange={e => setTargetValueMode(e.target.value)}
              />
            )}
          </div>

          {/* Target domain */}
          <div>
            <div className={labelClass}>Target domain</div>
            <select
              className={inputClass}
              value={targetDomain}
              onChange={e => setTargetDomain(e.target.value)}
            >
              <option value="all">All domains</option>
              {availableDomains.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Assigned to */}
          <div>
            <div className={labelClass}>Assign to</div>
            <input
              className={inputClass}
              placeholder="Initials (e.g. KP)"
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <div className={labelClass}>Notes</div>
            <textarea
              className={`${inputClass} h-12 resize-none`}
              placeholder="Optional notes…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-row gap-2 justify-end px-3 pb-3 pt-0">
          <button
            onClick={onClose}
            className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || (!isDiff && !freeFormLabel.trim())}
            className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Add Task'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
