"use client"

/**
 * CDM Request dialog — opens from the Scanner Window after an NDC resolves.
 * Shows the auto-populated pharmacy-side cells of the UHS CDM Request Form
 * (rev. 04-27-2018, A5..AC5) grouped by visible color band, with a
 * provenance badge on each field so pharmacy can audit the autofill before
 * submitting. Charge Services fields (AD5..AR5) are deliberately omitted.
 *
 * Mirrors StackingTicketDialog.tsx structurally so the visual style stays
 * consistent across the Scanner Window's modals.
 */

import { useEffect, useState } from "react"
import { Copy, Check, ExternalLink, AlertTriangle, Download, Table } from "lucide-react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { CdmFieldSource, CdmFieldValue, CdmRequestPayload } from "@/lib/cdm/types"
import { CDM_CELL_MAP, getField, type CdmFieldPath } from "@/lib/cdm/cellMap"
import { payloadToMarkdown } from "@/lib/cdm/markdown"
import { payloadToTsv } from "@/lib/cdm/tsv"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ndc: string
}

export function CdmRequestDialog({ open, onOpenChange, ndc }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<CdmRequestPayload | null>(null)
  // Track which copy action was last used so the Check icon flashes on the
  // right button. `null` = no recent copy.
  const [copied, setCopied] = useState<'markdown' | 'tsv' | null>(null)

  // Fetch on open. Avoid fetching when closed — the dialog is mounted
  // unconditionally by the parent so it can animate in/out smoothly.
  useEffect(() => {
    if (!open || !ndc) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/cdm-request/${encodeURIComponent(ndc)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`Lookup failed (${r.status})`)
        return (await r.json()) as CdmRequestPayload
      })
      .then(p => { if (!cancelled) setPayload(p) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, ndc])

  async function copyMarkdown() {
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payloadToMarkdown(payload, { wrapSection: true }))
      setCopied('markdown')
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }

  /** Copy a tab-separated row of A5..AC5 values. Pharmacist opens the
   *  CDM Request template, clicks A5, hits Cmd+V — Excel auto-fills 29
   *  cells in one paste. */
  async function copyTsv() {
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payloadToTsv(payload))
      setCopied('tsv')
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }

  /** Download a fresh xlsx file with A5..AC5 pre-filled from the resolver. */
  function downloadXlsx() {
    if (!payload) return
    // Hit the API directly so the browser's native download flow handles
    // the Content-Disposition header — no in-memory blob juggling needed.
    window.location.href = `/api/cdm-request/${encodeURIComponent(payload.ndc)}?format=xlsx`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[9000] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[9000] w-[min(960px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-[#808080] bg-[#FAFAFA] p-0 font-mono shadow-[4px_4px_0_#000] flex flex-col">
          <DialogHeader className="bg-[#316AC5] text-white px-3 py-1.5 border-b-2 border-[#000] shrink-0">
            <DialogTitle className="text-xs font-bold uppercase tracking-wide">
              CDM Request — UHS Form (Rev. 04-27-2018)
            </DialogTitle>
            <DialogDescription className="text-[10px] text-white/85 mt-0.5">
              {payload?.drugNameHeading || `NDC ${ndc}`}
              {payload && !payload.resolved && (
                <span className="ml-2 px-1.5 py-0.5 bg-orange-500 text-white text-[9px] rounded-sm">
                  NDC NOT IN MULTUM
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto p-3 space-y-3 text-xs">
            {loading && (
              <div className="text-[#404040] italic">Resolving CDM Request data…</div>
            )}

            {error && (
              <div className="border border-red-600 bg-red-50 text-red-900 px-2 py-1.5 text-[11px] flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {payload && (
              <>
                <Band title="Requesting" subtitle="Submitter info — fill before sending">
                  <Row label="Hospital"            v={payload.requesting.hospital} />
                  <Row label="DOP Name"            v={payload.requesting.dopName} />
                  <Row label="DOP Approval Date"   v={payload.requesting.dopApprovalDate} />
                  <Row label="P&T Approval Date"   v={payload.requesting.ptApprovalDate} />
                </Band>

                <Band title="Drug" subtitle="Identity — auto-resolved from Multum">
                  <Row label="Generic Name"  v={payload.drug.genericName} />
                  <Row label="Brand Name"    v={payload.drug.brandName} />
                  <Row label="Outer NDC"     v={payload.drug.outerNdc}  mono />
                  <Row label="Inner NDC"     v={payload.drug.innerNdc}  mono />
                  <Row label="Barcode"       v={payload.drug.barcode}   mono />
                  <Row label="Powerplan"     v={payload.drug.powerplan} hint="N (new) or R (replacement)" />
                  <Row label="Manufacturer"  v={payload.drug.manufacturer} />
                </Band>

                <Band title="Dispensing Information" subtitle="Default order entry — Cerner RxBuilder most-common">
                  <Row label="Default Type"     v={payload.dispensing.defaultType}   hint="IVPB / Cont / IM / PO / etc." />
                  <Row label="Dosage Form"      v={payload.dispensing.dosageForm} />
                  <Row label="Usual Dose"       v={payload.dispensing.usualDose} />
                  <Row label="Route"            v={payload.dispensing.route} />
                  <Row label="Usual Frequency"  v={payload.dispensing.usualFrequency} />
                  <Row label="PRN (Y/N)"        v={payload.dispensing.prnYN} />
                  <Row label="PRN Indication"   v={payload.dispensing.prnIndication} />
                  <Row label="Product Notes"    v={payload.dispensing.productNotes} />
                  <Row label="Formulary (Y/N)"  v={payload.dispensing.formularyYN} hint="Already on formulary?" />
                </Band>

                <Band title="Indicators">
                  <Row label="Controlled Drug"        v={payload.indicators.controlled} />
                  <Row label="Actual Cost / Dose"     v={payload.indicators.actualCostPerDose} mono />
                  <Row label="AWP / Dose"             v={payload.indicators.awpPerDose}        mono />
                  <Row label="Single-Use Product"     v={payload.indicators.singleUse} />
                </Band>

                <Band title="Billing Description (≤27 chars)" subtitle="Last pharmacy-fillable cell — corporate-pharmacy suggestion">
                  <Row label="Billing Description" v={payload.billing.billingDescription} mono />
                </Band>

                <div className="border-2 border-dashed border-[#808080] bg-[#F0F0F0] px-3 py-2 text-[#606060]">
                  <div className="text-[10px] uppercase font-bold mb-1">
                    Charge Services use only — filled after submission
                  </div>
                  <div className="text-[10px] leading-snug">
                    Cells AD–AR (CDM Code, charge description, tech description, proc/rev/GL/INS codes,
                    billing units, route of admin, therapeutic class, price, divisor, SI, JW) are filled
                    by the Charge Services department once the request is processed. They are intentionally
                    not auto-populated here.
                  </div>
                </div>
              </>
            )}

            {/* Cell-map debug strip — shows the on-form cell address for every
                row above. Useful for verifying the resolver against the real
                spreadsheet during development. Renders as a subtle hint band. */}
            {payload && (
              <details className="text-[10px] text-[#808080]">
                <summary className="cursor-pointer">Cell map (A5..AC5)</summary>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {CDM_CELL_MAP.map(c => {
                    const v = getField(payload, c.path as CdmFieldPath)
                    return (
                      <div key={c.cell} className="flex justify-between">
                        <span className="font-mono">{c.cell}</span>
                        <span className="truncate ml-2">
                          {v.missing ? <em className="text-orange-700">MISSING</em> : v.value}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </div>

          <DialogFooter className="border-t border-[#808080] bg-[#D4D0C8] px-3 py-2 flex sm:flex-row-reverse gap-2 shrink-0 flex-wrap">
            {/* Primary: download the fully autofilled xlsx — what most
                pharmacists will click. */}
            <Button
              onClick={downloadXlsx}
              disabled={!payload}
              className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white disabled:opacity-50"
              title="Download a copy of the CDM Request form with A5..AC5 pre-filled."
            >
              <Download size={12} className="mr-1" />Download .xlsx
            </Button>
            {/* Paste-into-existing-template path. */}
            <Button
              onClick={copyTsv}
              disabled={!payload}
              className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black disabled:opacity-50"
              title="Copy A5..AC5 as a tab-separated row. Open your CDM template, click A5, paste."
            >
              {copied === 'tsv' ? (
                <><Check size={12} className="mr-1" />Copied</>
              ) : (
                <><Table size={12} className="mr-1" />Copy as cells</>
              )}
            </Button>
            <Button
              onClick={copyMarkdown}
              disabled={!payload}
              className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black disabled:opacity-50"
              title="Copy as a markdown table for ticket / BrainSpace paste."
            >
              {copied === 'markdown' ? (
                <><Check size={12} className="mr-1" />Copied</>
              ) : (
                <><Copy size={12} className="mr-1" />Copy as markdown</>
              )}
            </Button>
            <Button
              onClick={() => {
                if (!payload) return
                window.open(`brainspace://cdm?ndc=${encodeURIComponent(payload.ndc)}`, '_blank')
              }}
              disabled={!payload}
              className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black disabled:opacity-50"
              title="Opens BrainSpace via brainspace:// URL scheme — must be installed."
            >
              <ExternalLink size={12} className="mr-1" />Open in BrainSpace
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers — visual style scoped to this dialog.
// ---------------------------------------------------------------------------

function Band({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#C0C0C0] bg-white">
      <div className="px-2 py-1 bg-[#E8E8E8] border-b border-[#C0C0C0]">
        <div className="text-[10px] uppercase text-[#404040] font-bold tracking-wide">{title}</div>
        {subtitle && <div className="text-[9px] italic text-[#808080] leading-tight">{subtitle}</div>}
      </div>
      <div className="px-2 py-1 space-y-0.5">{children}</div>
    </div>
  )
}

function Row({
  label, v, mono, hint,
}: { label: string; v: CdmFieldValue; mono?: boolean; hint?: string }) {
  const display = v.missing ? <span className="font-bold text-orange-700">MISSING</span> : (v.value ?? '—')
  return (
    <div className="flex items-baseline gap-2 leading-snug">
      <span className="text-[#808080] w-32 shrink-0">{label}:</span>
      <span
        className={[
          mono ? "font-mono" : "",
          v.missing ? "" : "text-[#202020]",
          "min-w-0 flex-1 break-words",
        ].join(" ")}
        title={v.note ?? undefined}
      >
        {display}
      </span>
      {v.source && (
        <SourceBadge source={v.source} />
      )}
      {hint && (
        <span className="text-[9px] italic text-[#808080] shrink-0 hidden md:inline">{hint}</span>
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: CdmFieldSource }) {
  const styles: Record<CdmFieldSource, { bg: string; fg: string; label: string }> = {
    multum:    { bg: '#316AC5', fg: 'white',   label: 'Multum' },
    rxbuilder: { bg: '#0F8C5C', fg: 'white',   label: 'RxBuilder' },
    extract:   { bg: '#666666', fg: 'white',   label: 'Extract' },
    cost:      { bg: '#A66B00', fg: 'white',   label: 'Cost' },
    derived:   { bg: '#808080', fg: 'white',   label: 'Derived' },
    user:      { bg: '#CC0000', fg: 'white',   label: 'User' },
  }
  const s = styles[source]
  return (
    <span
      className="text-[9px] px-1 py-px font-mono uppercase shrink-0"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  )
}
