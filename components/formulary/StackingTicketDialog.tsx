"use client"

/**
 * Stacking ticket dialog — opens from the State C verdict card and shows the
 * end user a ready-to-paste ticket body with everything the build team needs:
 *
 *   - The NDC being added (scanned)
 *   - The drug identity (generic, strength, form, AWP, package)
 *   - The target Cerner build to stack onto (Group ID, CDM, Pyxis ID)
 *   - The facility and Cerner domain context
 *
 * The "Pyxis ID" label is Cerner's canonical term and is used regardless of
 * whether the destination site runs Pyxis or Omnicell — the Cerner stacking
 * action is initiated against this single field, and the dispenser-specific
 * propagation happens downstream.
 *
 * If the probe found more than one candidate (rare; typically a data anomaly)
 * we render the first and surface a warning footer pointing the user at the
 * extras for manual investigation.
 *
 * Stays as a single-purpose component so the DiagnosisCard renderer doesn't
 * have to know anything about clipboard wiring.
 */

import { useState } from "react"
import { Copy, Check } from "lucide-react"
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
import type { ScanResult } from "@/lib/scanner"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: ScanResult
}

export function StackingTicketDialog({ open, onOpenChange, result }: Props) {
  const [copied, setCopied] = useState(false)
  const lookup = result.lookup
  const sp = lookup?.stackProbe
  const candidate = sp?.candidates?.[0]

  // Caller should only render us when state === 'C' + candidate exists, but
  // guard anyway so a stale render doesn't crash.
  if (!lookup || !sp || !candidate) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 z-[9000] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[9000] w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-none border-2 border-[#808080] bg-[#FAFAFA] p-4 font-mono shadow-[4px_4px_0_#000]">
            <DialogHeader>
              <DialogTitle>No stacking candidate</DialogTitle>
              <DialogDescription>
                The probe didn&apos;t produce a candidate for this scan.
              </DialogDescription>
            </DialogHeader>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    )
  }

  const id = lookup.identity
  const ticketText = formatTicket({
    ndc: lookup.ndc,
    drugName: id.genericName || sp.formulationName || "(unknown)",
    strength: id.strength,
    strengthUnit: id.strengthUnit,
    dosageForm: id.dosageForm,
    targetChargeNumber: candidate.chargeNumber,
    targetPyxisId: candidate.pyxisId,
    targetDescription: candidate.description,
    extraCandidates: sp.candidates.slice(1),
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(ticketText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts (HTTP) — fall back to a
      // textarea-and-execCommand pattern would go here. For internal use over
      // localhost the modern API works; flag if this ever bites.
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[9000] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[9000] w-full max-w-2xl translate-x-[-50%] translate-y-[-50%] bg-[#FAFAFA] border-2 border-[#808080] rounded-none p-0 font-mono shadow-[4px_4px_0_#000] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
        <DialogHeader className="bg-[#316AC5] text-white px-3 py-2 space-y-0">
          <DialogTitle className="text-sm font-bold">
            Stacking request — {id.genericName || sp.formulationName || lookup.ndc}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-blue-100">
            Stack applies to all Cerner domains.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 space-y-3 text-xs font-mono">
          <Section title="Scanned product (the NDC to add)">
            <Field label="NDC" value={lookup.ndc} mono bold />
            <Field
              label="Drug"
              value={[id.genericName, fmtStrength(id.strength, id.strengthUnit), id.dosageForm]
                .filter(Boolean)
                .join(" ") ||
                sp.formulationName || "—"}
            />
          </Section>

          <Section title="Stack onto this existing product">
            <Field
              label="CDM"
              value={candidate.chargeNumber || "—"}
              mono
              bold={!!candidate.chargeNumber}
            />
            <Field
              label="Pyxis ID"
              value={candidate.pyxisId || "—"}
              mono
              bold={!!candidate.pyxisId}
            />
            <Field label="Description" value={candidate.description || "—"} />
          </Section>

          {sp.candidates.length > 1 && (
            <div className="border border-orange-600 bg-orange-50 text-orange-900 px-2 py-1.5 text-[11px] leading-snug">
              <span className="font-bold">⚠ {sp.candidates.length - 1} other candidate
              group{sp.candidates.length > 2 ? "s" : ""} matched this MMDC</span> —
              typically a data anomaly worth investigating. Other CDMs:{" "}
              {sp.candidates.slice(1).map((c) => c.chargeNumber || c.groupId).join(", ")}.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[#808080] bg-[#D4D0C8] px-3 py-2 flex sm:flex-row-reverse gap-2">
          <Button
            onClick={copy}
            className="h-8 px-3 text-xs font-mono rounded-none border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white"
          >
            {copied ? (
              <><Check size={12} className="mr-1" />Copied</>
            ) : (
              <><Copy size={12} className="mr-1" />Copy ticket text</>
            )}
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
// Layout helpers — local to this component so the visual style stays scoped.
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#C0C0C0] bg-white">
      <div className="px-2 py-1 bg-[#E8E8E8] text-[10px] uppercase text-[#404040] border-b border-[#C0C0C0]">
        {title}
      </div>
      <div className="px-2 py-1.5 space-y-0.5">{children}</div>
    </div>
  )
}

function Field({
  label, value, mono, bold, hint,
}: {
  label: string
  value: string
  mono?: boolean
  bold?: boolean
  hint?: string
}) {
  return (
    <div className="flex items-baseline gap-2 leading-snug">
      <span className="text-[#808080] w-28 shrink-0">{label}:</span>
      <span className={[
        mono ? "font-mono" : "",
        bold ? "font-bold text-black" : "text-[#202020]",
        "min-w-0 flex-1 break-all",
      ].join(" ")}>
        {value}
      </span>
      {hint && (
        <span className="text-[10px] italic text-[#808080] shrink-0 hidden md:inline">{hint}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ticket text formatter — produces what the user pastes into their ticket
// system. Plain text on purpose; renders fine in any input. Headings + key/
// value layout are easy to skim and easy to grep for in a queue.
// ---------------------------------------------------------------------------

interface TicketArgs {
  ndc: string
  drugName: string
  strength: string
  strengthUnit: string
  dosageForm: string
  targetChargeNumber: string
  targetPyxisId: string
  targetDescription: string
  /** Other candidate groups matching this MMDC; rare data anomaly. */
  extraCandidates: ReadonlyArray<{ groupId: string; chargeNumber: string }>
}

/**
 * Minimal ticket text — plain prose with no alignment dependency. Section
 * headings, blank-line separators, and indentation give it visual structure
 * without relying on monospace fonts (so it reads correctly in any ticket
 * system regardless of how it renders).
 *
 * Stacking is applied across all Cerner domains so the request body
 * intentionally omits domain/facility — the build team handles propagation.
 * Pricing/MMDC/Group ID are also skipped — CDM and Pyxis ID are the
 * actionable identifiers; the rest is noise on a build queue.
 */
function formatTicket(a: TicketArgs): string {
  const drugLine = [
    a.drugName,
    fmtStrength(a.strength, a.strengthUnit),
    a.dosageForm,
  ].filter(Boolean).join(" ") || "(unknown — verify identity)"

  const lines: string[] = [
    `STACKING REQUEST`,
    ``,
    `NDC to add: ${a.ndc}`,
    `Drug: ${drugLine}`,
    ``,
    `Stack onto this existing product:`,
    `  CDM: ${a.targetChargeNumber || "(none)"}`,
    `  Pyxis ID: ${a.targetPyxisId || "(none)"}`,
    `  Description: ${a.targetDescription || "(none)"}`,
  ]

  if (a.extraCandidates.length > 0) {
    lines.push(
      ``,
      `NOTE: ${a.extraCandidates.length} other candidate group(s) matched this MMDC — likely a data anomaly. Investigate before submitting:`,
      ...a.extraCandidates.map((c) => `  - ${c.groupId}${c.chargeNumber ? ` (CDM ${c.chargeNumber})` : ""}`),
    )
  }

  return lines.join("\n") + "\n"
}

function fmtStrength(value: string, unit: string): string {
  if (!value) return ""
  return unit ? `${value} ${unit}` : value
}
