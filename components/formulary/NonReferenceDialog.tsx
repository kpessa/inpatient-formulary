'use client'

import { useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Dialog, DialogPortal, DialogOverlay, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import type { NonReferenceFields } from '@/lib/db'

interface Props {
  availableDomains: { region: string; env: string; domain: string }[]
  onClose: () => void
  onCreated: (groupId: string) => void
}

const PACKAGE_UNITS = ['', 'EA', 'TAB', 'CAP', 'ML', 'MG', 'G', 'VIAL', 'AMP', 'PKT', 'BAG', 'BTL', 'BOX', 'KIT']
const DOSAGE_FORMS = [
  '', 'TABLET', 'CAPSULE', 'INJECTION', 'SOLUTION', 'SUSPENSION', 'POWDER',
  'PATCH', 'CREAM', 'OINTMENT', 'GEL', 'LOTION', 'DROPS', 'SPRAY', 'INHALER',
  'SUPPOSITORY', 'INFUSION', 'CONCENTRATE', 'GRANULES', 'SYRUP', 'ELIXIR',
]

function isValidNdc(ndc: string) {
  return /^[\d-]+$/.test(ndc.trim()) && ndc.trim().length >= 9
}

export function NonReferenceDialog({ availableDomains, onClose, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [ndc, setNdc] = useState('')
  const [ndcError, setNdcError] = useState('')

  // Form fields
  const [manufacturer, setManufacturer] = useState('')
  const [innerNdc, setInnerNdc] = useState('')
  const [genericName, setGenericName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [description, setDescription] = useState('')
  const [brandName, setBrandName] = useState('')
  const [awpCost, setAwpCost] = useState('')
  const [strength, setStrength] = useState('')
  const [packageSize, setPackageSize] = useState('')
  const [packageUnit, setPackageUnit] = useState('')
  const [basePackageUnit, setBasePackageUnit] = useState('')
  const [outerPackageSize, setOuterPackageSize] = useState('')
  const [outerPackageUnit, setOuterPackageUnit] = useState('')
  const [isBiological, setIsBiological] = useState(false)
  const [isUnitDose, setIsUnitDose] = useState(false)
  const [dosageForm, setDosageForm] = useState('')
  const [isBrand, setIsBrand] = useState(false)
  const [suppressClinicalAlerts, setSuppressClinicalAlerts] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const prodDomains = availableDomains.filter(d => d.env === 'prod')

  const handleContinue = () => {
    if (!ndc.trim()) { setNdcError('NDC is required'); return }
    if (!isValidNdc(ndc)) { setNdcError('Enter a valid NDC (e.g. 12345-0123-01)'); return }
    setNdcError('')
    setStep(2)
  }

  const canSubmit = genericName.trim() && mnemonic.trim() && description.trim() &&
    brandName.trim() && strength.trim() && dosageForm.trim()

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const fields: NonReferenceFields = {
        ndc: ndc.trim(),
        manufacturer: manufacturer.trim(),
        genericName: genericName.trim(),
        mnemonic: mnemonic.trim(),
        description: description.trim(),
        brandName: brandName.trim(),
        awpCost: awpCost ? parseFloat(awpCost) : null,
        strength: strength.trim(),
        dosageForm: dosageForm.trim(),
        packageSize: packageSize ? parseFloat(packageSize) : null,
        packageUnit: packageUnit.trim(),
        basePackageUnit: basePackageUnit.trim(),
        outerPackageSize: outerPackageSize ? parseFloat(outerPackageSize) : null,
        outerPackageUnit: outerPackageUnit.trim(),
        isBiological,
        isUnitDose,
        isBrand,
        suppressClinicalAlerts,
      }
      const domains = prodDomains.map(d => {
        const idx = d.domain.lastIndexOf('_')
        return {
          region: d.domain.slice(0, idx),
          environment: d.domain.slice(idx + 1),
          domain: d.domain,
        }
      })

      const res = await fetch('/api/formulary/non-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, domains }),
      })
      const data = await res.json() as { groupId?: string; error?: string }
      if (!res.ok || !data.groupId) throw new Error(data.error ?? 'Failed to create item')

      // Auto-create a ProductBuild entry for tracking
      await fetch('/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drugDescription: description.trim(),
          drugKey: data.groupId,
          domains: prodDomains.map(d => d.domain),
          status: 'in_progress',
        }),
      })

      onCreated(data.groupId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const labelClass = 'text-[10px] font-mono text-[#404040] mb-0.5'
  const inputClass = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-white focus:outline-none focus:border-[#316AC5]'
  const readonlyClass = 'w-full text-[11px] font-mono rounded-none border border-[#808080] px-1.5 py-0.5 bg-[#E8E4DC] text-[#606060]'
  const reqMark = <span className="text-[#CC0000]">*</span>

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[9000] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[9000] w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-[#808080] bg-[#D4D0C8] p-0 font-mono shadow-[4px_4px_0_#000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          {/* Title bar */}
          <div className="bg-[#316AC5] text-white text-[11px] font-mono font-bold px-2 py-1 flex items-center justify-between">
            <span>Non Reference Item Info</span>
            <button onClick={onClose} className="text-white/80 hover:text-white text-[10px]">✕</button>
          </div>
          <DialogHeader className="sr-only">
            <DialogTitle>Non Reference Item Info</DialogTitle>
          </DialogHeader>

          {step === 1 ? (
            /* Step 1: NDC Entry */
            <div className="p-4 space-y-3">
              <div className="text-[11px] font-mono text-[#404040]">
                Enter the NDC for the new non-reference item.
              </div>
              <div>
                <div className={labelClass}>{reqMark} NDC</div>
                <input
                  autoFocus
                  className={inputClass}
                  placeholder="e.g. 12345-0123-01"
                  value={ndc}
                  onChange={e => { setNdc(e.target.value); setNdcError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleContinue()}
                />
                {ndcError && <div className="text-[10px] text-[#CC0000] mt-0.5">{ndcError}</div>}
              </div>
              <DialogFooter className="flex flex-row gap-2 justify-end pt-1">
                <button onClick={onClose} className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]">
                  Cancel
                </button>
                <button onClick={handleContinue} className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]">
                  Continue →
                </button>
              </DialogFooter>
            </div>
          ) : (
            /* Step 2: Full Form */
            <div className="p-3">
              <div className="flex gap-3">
                {/* Left column */}
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div>
                    <div className={labelClass}>Manufacturer</div>
                    <input className={inputClass} value={manufacturer} onChange={e => setManufacturer(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>NDC</div>
                    <div className={readonlyClass}>{ndc}</div>
                  </div>
                  <div>
                    <div className={labelClass}>Inner NDC</div>
                    <input className={inputClass} value={innerNdc} onChange={e => setInnerNdc(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Generic name</div>
                    <input className={inputClass} value={genericName} onChange={e => setGenericName(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Mnemonic</div>
                    <input className={inputClass} value={mnemonic} onChange={e => setMnemonic(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Description</div>
                    <input className={inputClass} value={description} onChange={e => setDescription(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Brand name</div>
                    <input className={inputClass} value={brandName} onChange={e => setBrandName(e.target.value)} />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Base AWP</div>
                    <input className={inputClass} type="number" step="0.01" min="0" value={awpCost} onChange={e => setAwpCost(e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <div className={labelClass}>{reqMark} Strength</div>
                    <input className={inputClass} value={strength} onChange={e => setStrength(e.target.value)} placeholder="e.g. 500 MG" />
                  </div>
                </div>

                {/* Right column */}
                <div className="w-52 space-y-1.5 shrink-0">
                  <div>
                    <div className={labelClass}>{reqMark} Dosage form</div>
                    <select className={inputClass} value={dosageForm} onChange={e => setDosageForm(e.target.value)}>
                      {DOSAGE_FORMS.map(v => <option key={v} value={v}>{v || '— select —'}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className={labelClass}>Package</div>
                    <div className="flex gap-1">
                      <input className={`${inputClass} w-14`} type="number" min="0" step="1" value={packageSize} onChange={e => setPackageSize(e.target.value)} placeholder="#" />
                      <select className={`${inputClass} flex-1`} value={packageUnit} onChange={e => setPackageUnit(e.target.value)}>
                        {PACKAGE_UNITS.map(v => <option key={v} value={v}>{v || '—'}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <div className={labelClass}>Base package</div>
                    <div className="flex gap-1 items-center">
                      <span className="text-[11px] font-mono text-[#404040] w-6 text-center shrink-0">1</span>
                      <select className={`${inputClass} flex-1`} value={basePackageUnit} onChange={e => setBasePackageUnit(e.target.value)}>
                        {PACKAGE_UNITS.map(v => <option key={v} value={v}>{v || '—'}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <div className={labelClass}>Outer package</div>
                    <div className="flex gap-1">
                      <input className={`${inputClass} w-14`} type="number" min="0" step="1" value={outerPackageSize} onChange={e => setOuterPackageSize(e.target.value)} placeholder="#" />
                      <select className={`${inputClass} flex-1`} value={outerPackageUnit} onChange={e => setOuterPackageUnit(e.target.value)}>
                        {PACKAGE_UNITS.map(v => <option key={v} value={v}>{v || '—'}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-4 pt-0.5">
                    <label className="flex items-center gap-1 text-[11px] font-mono cursor-pointer">
                      <input type="checkbox" checked={isBiological} onChange={e => setIsBiological(e.target.checked)} className="w-3 h-3" />
                      BIO
                    </label>
                    <label className="flex items-center gap-1 text-[11px] font-mono cursor-pointer">
                      <input type="checkbox" checked={isUnitDose} onChange={e => setIsUnitDose(e.target.checked)} className="w-3 h-3" />
                      Unit dose
                    </label>
                  </div>
                  <div>
                    <div className={labelClass}>G/B indicator</div>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-1 text-[11px] font-mono cursor-pointer">
                        <input type="radio" name="gb" checked={!isBrand} onChange={() => setIsBrand(false)} className="w-3 h-3" />
                        Generic
                      </label>
                      <label className="flex items-center gap-1 text-[11px] font-mono cursor-pointer">
                        <input type="radio" name="gb" checked={isBrand} onChange={() => setIsBrand(true)} className="w-3 h-3" />
                        Brand
                      </label>
                    </div>
                  </div>
                  <label className="flex items-start gap-1 text-[10px] font-mono cursor-pointer pt-0.5">
                    <input type="checkbox" checked={suppressClinicalAlerts} onChange={e => setSuppressClinicalAlerts(e.target.checked)} className="w-3 h-3 mt-0.5 shrink-0" />
                    Suppress clinical checking alerts
                  </label>
                  {prodDomains.length > 0 && (
                    <div className="pt-1 border-t border-[#808080]">
                      <div className={labelClass}>Creates in {prodDomains.length} domain{prodDomains.length > 1 ? 's' : ''}</div>
                      <div className="text-[9px] font-mono text-[#606060]">{prodDomains.map(d => d.domain).join(', ')}</div>
                    </div>
                  )}
                </div>
              </div>

              {error && <div className="text-[10px] text-[#CC0000] mt-1.5">{error}</div>}

              <DialogFooter className="flex flex-row gap-2 justify-between pt-2 mt-1 border-t border-[#808080]">
                <button onClick={() => setStep(1)} className="text-[11px] font-mono px-2 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]">
                  ← Back
                </button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC]">
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={saving || !canSubmit}
                    className="text-[11px] font-mono px-3 py-1 border border-[#808080] bg-[#D4D0C8] hover:bg-[#C8C4BC] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Creating…' : 'OK'}
                  </button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
