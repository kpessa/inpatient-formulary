"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ScanBarcode, ChevronDown, X as XIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useEasterEggModes } from "@/lib/easter-eggs"
import type { ScanResult } from "@/lib/scanner"
import type { DiagnosisColor } from "@/lib/diagnosis"
import { buildDecisionTrace, type DecisionTrace, type TraceCheck } from "@/lib/diagnosis-trace"
import { StackingTicketDialog } from "./StackingTicketDialog"
import { NdcDetailPopover } from "./NdcDetailPopover"

/**
 * Sentinel for "All facilities" mode — passed to the API as empty string
 * (the scanner backend treats an empty/missing facility as a no-scope scan).
 *
 * Note: the scanner backend (lib/scanner.ts, lib/db.ts, /api/barcode) was
 * generalized to accept a facility array — empty = no scope, 1 = single,
 * 2+ = OR-match across selected. The UI is currently single-select pending
 * the architect-driven classification work (groups + hospital flag). When
 * that lands, this combobox is replaced by a multi-select picker; the wire
 * format already supports it via `?facilities=csv`.
 */
const ALL_FACILITIES = ""
const FACILITY_LS_KEY = "pharmnet-scanner-facility"

function readSavedFacility(): string {
  if (typeof window === "undefined") return ALL_FACILITIES
  try {
    const v = localStorage.getItem(FACILITY_LS_KEY)
    // Treat null (never set) as "All facilities". An empty string written
    // explicitly also means "All facilities" — both map to the sentinel.
    return v ?? ALL_FACILITIES
  } catch {
    return ALL_FACILITIES
  }
}

/**
 * Formulary Diagnosis Scanner — top-level window.
 *
 * Opens from the toolbar Barcode button (and from Product Search). Same
 * Win95-style chrome (drag, resize, minimize, maximize, close) as the other
 * floating windows like TaskManagerWindow.
 *
 * Body: facility picker + barcode/NDC scan zone + diagnosis badge +
 * product card + evidence panel + scope-gate for end-user mode.
 */

interface Props {
  open: boolean
  minimized?: boolean
  focused?: boolean
  onClose: () => void
  onMinimize?: () => void
  onFocus?: () => void
  /** Optional NDC or barcode to seed the input — useful when launched from Product Search with a pre-existing identifier. */
  initialInput?: string
}

type Rect = { x: number; y: number; w: number; h: number }
const MIN_W = 560
const MIN_H = 420

const COLOR_CLASSES: Record<DiagnosisColor, { bg: string; border: string; text: string }> = {
  green: { bg: "bg-green-100", border: "border-green-700", text: "text-green-900" },
  yellow: { bg: "bg-yellow-100", border: "border-yellow-700", text: "text-yellow-900" },
  orange: { bg: "bg-orange-100", border: "border-orange-700", text: "text-orange-900" },
  blue: { bg: "bg-blue-100", border: "border-blue-700", text: "text-blue-900" },
  red: { bg: "bg-red-100", border: "border-red-700", text: "text-red-900" },
}

export function ScannerWindow({
  open,
  minimized = false,
  focused = true,
  onClose,
  onMinimize,
  onFocus,
  initialInput = "",
}: Props) {
  // ---------- Window geometry ----------
  const [rect, setRect] = useState<Rect | null>(null)
  const [maximized, setMaximized] = useState(false)
  const preMaxRect = useRef<Rect | null>(null)
  const isResizing = useRef<{ dir: string; startX: number; startY: number; startRect: Rect } | null>(null)

  useEffect(() => {
    if (rect) return
    setRect({
      x: Math.max(0, (window.innerWidth - 760) / 2),
      y: Math.max(0, (window.innerHeight - 600) / 2),
      w: 760,
      h: 600,
    })
  }, [rect])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizing.current) return
      const { dir, startX, startY, startRect } = isResizing.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (dir === 'move') { setRect({ ...startRect, x: startRect.x + dx, y: startRect.y + dy }); return }
      let { x, y, w, h } = startRect
      if (dir.includes('e')) w = Math.max(MIN_W, startRect.w + dx)
      if (dir.includes('w')) { const nw = Math.max(MIN_W, startRect.w - dx); x = startRect.x + (startRect.w - nw); w = nw }
      if (dir.includes('s')) h = Math.max(MIN_H, startRect.h + dy)
      if (dir.includes('n')) { const nh = Math.max(MIN_H, startRect.h - dy); y = startRect.y + (startRect.h - nh); h = nh }
      setRect({ x, y, w, h })
    }
    const onUp = () => { isResizing.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])

  const handlePointerDown = (dir: string) => (e: React.PointerEvent) => {
    if (!rect || maximized) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.current = { dir, startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  const toggleMaximize = () => {
    if (maximized) { if (preMaxRect.current) setRect(preMaxRect.current); setMaximized(false) }
    else { preMaxRect.current = rect; setMaximized(true) }
  }

  // ---------- Scanner state ----------
  const { isAdminMode, isMaintainerMode } = useEasterEggModes()
  const canBypassGate = isAdminMode || isMaintainerMode
  const modeName = isAdminMode ? "Architect" : isMaintainerMode ? "Analyst" : "End user"

  const [facilities, setFacilities] = useState<string[]>([])
  // facility === "" means "All facilities" (sentinel). Initialize from
  // localStorage so a site user lands on their own facility on every open.
  const [facility, setFacility] = useState<string>(() => readSavedFacility())
  // Two separate inputs — barcode (handheld scanner) vs NDC (manual entry).
  // initialInput from Product Search is an NDC, so it seeds the NDC field.
  const [barcodeInput, setBarcodeInput] = useState<string>("")
  const [ndcInput, setNdcInput] = useState<string>(initialInput)
  const [environment] = useState<"prod" | "cert">("prod")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State C ticket dialog — opens from the "Get build instructions" CTA on
  // the verdict card. Lives in ScannerWindow so the dialog closes cleanly
  // when the user clears or re-scans.
  const [ticketOpen, setTicketOpen] = useState(false)
  const barcodeRef = useRef<HTMLInputElement | null>(null)
  const ndcRef = useRef<HTMLInputElement | null>(null)

  // Reseed NDC input when the window is reopened with a new initialInput.
  useEffect(() => {
    if (open && initialInput) setNdcInput(initialInput)
  }, [open, initialInput])

  const gateActive =
    !canBypassGate && !!result?.diagnosis && result.diagnosis.state === "E"

  useEffect(() => {
    if (!open) return
    fetch("/api/formulary/facilities")
      .then((r) => r.json())
      .then((d: { facilities: string[] }) => setFacilities(d.facilities ?? []))
      .catch(() => setFacilities([]))
  }, [open])

  // Auto-focus the barcode field whenever the window is opened — facility is
  // always selected (defaults to "All facilities" sentinel), so the cursor
  // can sit in this input ready for the handheld scanner.
  useEffect(() => {
    if (open) barcodeRef.current?.focus()
  }, [open])

  // Persist facility selection so a site user lands on their facility next
  // time the scanner opens.
  useEffect(() => {
    try {
      localStorage.setItem(FACILITY_LS_KEY, facility)
    } catch {
      // localStorage unavailable (private mode, etc.) — non-fatal.
    }
  }, [facility])

  async function runScan(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      // Facility may be "" (the All-facilities sentinel); the API accepts
      // an empty/missing facility and runs the diagnosis without scope.
      // (The backend additionally accepts `?facilities=csv` for multi-select;
      // this single-select path uses the legacy `?facility=` shorthand.)
      const url = `/api/barcode/${encodeURIComponent(trimmed)}?facility=${encodeURIComponent(
        facility,
      )}&environment=${environment}`
      const r = await fetch(url)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${r.status}`)
      }
      const data: ScanResult = await r.json()
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed")
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setBarcodeInput("")
    setNdcInput("")
    setResult(null)
    setError(null)
    barcodeRef.current?.focus()
  }

  if (!open || !rect) return null

  const zIndex = focused ? 51 : 50
  const style = maximized
    ? { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 32, zIndex, display: minimized ? 'none' as const : undefined }
    : { position: 'fixed' as const, left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex, display: minimized ? 'none' as const : undefined }

  return (
    <div
      className="flex flex-col bg-[#D4D0C8] font-mono text-xs border border-white border-r-[#808080] border-b-[#808080] shadow-2xl select-none"
      style={style}
      onPointerDownCapture={onFocus}
    >
      {/* Resize handles */}
      {!maximized && <>
        <div onPointerDown={handlePointerDown('n')}  className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-10" />
        <div onPointerDown={handlePointerDown('s')}  className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-10" />
        <div onPointerDown={handlePointerDown('e')}  className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize z-10" />
        <div onPointerDown={handlePointerDown('w')}  className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize z-10" />
        <div onPointerDown={handlePointerDown('nw')} className="absolute top-0 left-0 w-2 h-2 cursor-nw-resize z-10" />
        <div onPointerDown={handlePointerDown('ne')} className="absolute top-0 right-0 w-2 h-2 cursor-ne-resize z-10" />
        <div onPointerDown={handlePointerDown('sw')} className="absolute bottom-0 left-0 w-2 h-2 cursor-sw-resize z-10" />
        <div onPointerDown={handlePointerDown('se')} className="absolute bottom-0 right-0 w-2 h-2 cursor-se-resize z-10" />
      </>}

      {/* Title bar */}
      <div
        className={`flex items-center justify-between text-white px-2 h-7 shrink-0 cursor-default transition-colors duration-150 ${focused ? 'bg-[#316AC5]' : 'bg-[#808080]'}`}
        onPointerDown={handlePointerDown('move')}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <div className="w-4 h-4 bg-white/20 border border-white/40 flex items-center justify-center">
            <ScanBarcode size={10} />
          </div>
          <span className="text-sm font-bold font-mono tracking-tight">Formulary Diagnosis Scanner</span>
        </div>
        <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
          <button onPointerDown={e => { e.stopPropagation(); onMinimize?.() }} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">─</button>
          <button onClick={toggleMaximize} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none" title={maximized ? 'Restore' : 'Maximize'}>{maximized ? '❐' : '□'}</button>
          <button onClick={onClose} className="w-5 h-5 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center text-[10px] leading-none">✕</button>
        </div>
      </div>

      {/* Mode toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#808080] shrink-0">
        <span className="text-[10px] font-mono text-[#808080] uppercase tracking-wide">
          Scan a barcode or paste an NDC for facility-aware diagnosis.
        </span>
        <span
          className={`text-[10px] px-2 py-0.5 border rounded-sm ${
            canBypassGate
              ? "border-[#316AC5] bg-[#E5EEF7] text-[#316AC5]"
              : "border-[#808080] bg-[#D4D0C8] text-[#404040]"
          }`}
          title={
            canBypassGate
              ? "Maintainer/admin mode — scope gate bypassed; full diagnosis output."
              : "End-user mode — scope-gated. Off-formulary NDCs are silently rejected."
          }
        >
          {modeName} mode
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {/* Step 1 — Facility picker */}
        <div className="space-y-1">
          <label className="text-xs font-mono leading-none flex items-center gap-1">
            <span className="inline-flex items-center justify-center w-4 h-4 bg-[#316AC5] text-white text-[10px] font-bold rounded-full">1</span>
            Facility <span className="text-[#808080] italic ml-1">(defaults to all — pick yours to scope)</span>
          </label>
          <FacilityCombobox
            facilities={facilities}
            value={facility}
            onChange={setFacility}
          />
        </div>

        {/* Step 2 — Scan zone (two inputs: barcode vs manual NDC) */}
        <div className="space-y-1">
          <label className="text-xs font-mono leading-none flex items-center gap-1 flex-wrap">
            <span className="inline-flex items-center justify-center w-4 h-4 bg-[#316AC5] text-white text-[10px] font-bold rounded-full">2</span>
            <span className="text-[#CC0000]">*</span> Scan a barcode <span className="text-[#808080]">— or —</span> enter an NDC
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-green-800">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" aria-hidden="true" />
              Ready for {facility || "all facilities"}
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Barcode (handheld scanner) */}
            <div className="border border-[#316AC5] bg-white p-2 transition-colors">
              <div className="text-[10px] uppercase text-[#808080] mb-1 flex items-center gap-1">
                <ScanBarcode size={12} className="text-[#316AC5]" aria-hidden="true" />
                Barcode
              </div>
              <div className="flex gap-1">
                <Input
                  ref={barcodeRef}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      runScan(barcodeInput)
                    }
                  }}
                  placeholder="Pull trigger to scan…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 text-sm font-mono rounded-none border border-[#808080] px-1 h-8 bg-white focus-visible:ring-0 focus-visible:border-[#316AC5]"
                />
                <Button
                  onClick={() => runScan(barcodeInput)}
                  disabled={!barcodeInput.trim() || loading}
                  className="h-8 px-2 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black shrink-0"
                >
                  {loading ? "…" : "Look up"}
                </Button>
              </div>
            </div>

            {/* NDC (manual entry) */}
            <div className="border border-[#316AC5] bg-white p-2 transition-colors">
              <div className="text-[10px] uppercase text-[#808080] mb-1">
                NDC <span className="normal-case text-[#808080]">(manual entry)</span>
              </div>
              <div className="flex gap-1">
                <Input
                  ref={ndcRef}
                  value={ndcInput}
                  onChange={(e) => setNdcInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      runScan(ndcInput)
                    }
                  }}
                  placeholder="Type 11-digit NDC…"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 text-sm font-mono rounded-none border border-[#808080] px-1 h-8 bg-white focus-visible:ring-0 focus-visible:border-[#316AC5]"
                />
                <Button
                  onClick={() => runScan(ndcInput)}
                  disabled={!ndcInput.trim() || loading}
                  className="h-8 px-2 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black shrink-0"
                >
                  {loading ? "…" : "Look up"}
                </Button>
              </div>
            </div>
          </div>

          {(barcodeInput || ndcInput || result || error) && (
            <div className="flex justify-end pt-0.5">
              <Button
                onClick={clear}
                variant="ghost"
                className="h-6 px-2 text-[10px] font-mono rounded-none text-[#808080] hover:bg-[#E0DBD0]"
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="border border-[#CC0000] bg-red-50 text-[#CC0000] px-2 py-1 text-xs">
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="text-[10px] text-[#808080] flex gap-3 flex-wrap">
              <span>Detected: <span className="text-black">{result.parsed.format}</span></span>
              {result.ndc && <span>NDC: <span className="text-black">{result.ndc}</span></span>}
              {result.alternateCandidates.length > 0 && (
                <span>
                  Other candidates tried: {result.alternateCandidates
                    .map((c) => `${c.ndc} (${c.state})`)
                    .join(", ")}
                </span>
              )}
            </div>


            {gateActive ? (
              <ScopeGateCard facility={facility} ndc={result.ndc} />
            ) : result.diagnosis ? (
              <DiagnosisCard
                state={result.diagnosis.state}
                color={result.diagnosis.color}
                emoji={result.diagnosis.emoji}
                label={result.diagnosis.label}
                short={result.diagnosis.short}
                description={result.diagnosis.description}
                action={result.diagnosis.action}
                unverifiedStateC={result.diagnosis.unverifiedStateC}
                /* Only flag "facility unknown" when the user actually picked a
                   facility — in All-facilities mode we *expect* facilityDomain
                   to be null, so the warning would just be noise. */
                facilityUnknown={facility !== ALL_FACILITIES && result.diagnosis.facilityUnknown}
                /* CTA only when we actually have a stack candidate to show. */
                showTicketCta={
                  result.diagnosis.state === "C" &&
                  !!result.lookup?.stackProbe?.candidates.length
                }
                onOpenTicket={() => setTicketOpen(true)}
              />
            ) : (
              <div className="border border-[#808080] bg-white p-2">
                Couldn't parse input as a barcode or NDC. Try entering an 11-digit
                NDC or scanning the package barcode.
              </div>
            )}

            {!gateActive && result.lookup && <IdentityCard lookup={result.lookup} />}

            {!gateActive && result.lookup && (
              <SiblingNdcsPanel
                lookup={result.lookup}
                preferredDomain={result.lookup.facilityDomain}
              />
            )}

            {!gateActive && result.lookup && result.diagnosis && (
              <EvidencePanel evidence={result.diagnosis.evidence} />
            )}

            {canBypassGate && result.lookup && result.diagnosis && (() => {
              const trace = buildDecisionTrace(result)
              return trace ? <DecisionTracePanel trace={trace} /> : null
            })()}
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center h-5 bg-[#D4D0C8] border-t border-[#808080] px-2 shrink-0">
        <span className="text-[9px] font-mono text-[#808080]">
          {result?.diagnosis
            ? `${result.diagnosis.emoji} State ${result.diagnosis.state} — ${result.diagnosis.label}`
            : "Ready."}
        </span>
      </div>

      {/* State C ticket dialog — mounted unconditionally; visibility driven
          by `ticketOpen` state. The dialog component itself guards against
          missing stackProbe / candidates so a stale render won't crash. */}
      {result && (
        <StackingTicketDialog
          open={ticketOpen}
          onOpenChange={setTicketOpen}
          result={result}
        />
      )}
    </div>
  )
}

function ScopeGateCard({ facility, ndc }: { facility: string; ndc: string }) {
  const allMode = facility === ALL_FACILITIES
  return (
    <div className="border-2 border-[#808080] bg-[#F5F5F5] p-3 space-y-1">
      <div className="text-sm font-bold text-[#404040]">
        {allMode ? "Not on any formulary in our system" : `Not on ${facility}'s formulary`}
      </div>
      <div className="text-xs">
        We couldn't find <span className="font-mono">{ndc}</span>{" "}
        {allMode
          ? "anywhere in our formulary, and it isn't a known reusable build candidate."
          : "in your facility's formulary, and it isn't a known reusable build candidate."}
        {" "}New-product requests need to route through Pharmacy Operations first — your DOP can submit
        through the Clinical Pharmacy Workgroup.
      </div>
      <div className="text-[10px] italic text-[#808080] pt-1">
        If you're an analyst or architect investigating this NDC, switch to
        the appropriate mode to bypass this gate.
      </div>
    </div>
  )
}

function DiagnosisCard(props: {
  state: string
  color: DiagnosisColor
  emoji: string
  label: string
  short: string
  description: string
  action: string
  unverifiedStateC: boolean
  facilityUnknown: boolean
  /** Render the State C "Generate stacking ticket" button. Caller handles the click. */
  showTicketCta?: boolean
  onOpenTicket?: () => void
}) {
  const c = COLOR_CLASSES[props.color]
  return (
    <div className={`border-2 ${c.border} ${c.bg} ${c.text} p-3 space-y-1`}>
      <div className="flex items-center gap-2 text-sm font-bold">
        <span className="text-base">{props.emoji}</span>
        <span>State {props.state} — {props.label}</span>
      </div>
      <div className="text-xs">{props.short}</div>
      <div className="text-xs italic opacity-80">{props.description}</div>
      <div className="text-xs font-bold pt-1">→ {props.action}</div>
      {props.showTicketCta && props.onOpenTicket && (
        <div className="pt-2">
          <Button
            onClick={props.onOpenTicket}
            className="h-8 px-3 text-xs font-mono rounded-none border border-[#404040] bg-[#316AC5] hover:bg-[#2456A5] text-white"
          >
            Generate stacking ticket for this NDC
          </Button>
        </div>
      )}
      {props.unverifiedStateC && (
        <div className="text-[10px] mt-2 px-2 py-1 bg-yellow-50 border border-yellow-600 text-yellow-900">
          ⚠ Stacking probe was inconclusive (NDC not in Multum extract) — a
          stack candidate may exist that we couldn&apos;t check. Verify
          manually before treating this as a fresh build.
        </div>
      )}
      {props.facilityUnknown && (
        <div className="text-[10px] mt-2 px-2 py-1 bg-orange-50 border border-orange-600 text-orange-900">
          ⚠ Facility was not found in the formulary inventory map. The
          diagnosis may be misleading — verify the facility name.
        </div>
      )}
    </div>
  )
}

function IdentityCard({ lookup }: { lookup: NonNullable<ScanResult["lookup"]> }) {
  const id = lookup.identity
  return (
    <div className="border border-[#808080] bg-white p-2">
      <div className="text-[10px] uppercase text-[#808080] mb-1">
        Product identity ({
          id.source === "formulary" ? "from formulary"
          : id.source === "multum_data_model" ? "from Multum data model"
          : id.source === "multum_csv" ? "from Multum master"
          : "no identity available"
        })
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
        <Field label="Generic" value={id.genericName} />
        <Field label="Brand" value={id.brandName} />
        <Field label="Strength" value={id.strength ? `${id.strength}${id.strengthUnit ? " " + id.strengthUnit : ""}` : ""} />
        <Field label="Form" value={id.dosageForm} />
        <Field label="Manufacturer" value={id.manufacturer} />
        <Field label="Mnemonic" value={id.mnemonic} />
        <Field label="AWP" value={id.awpCost != null ? `$${id.awpCost.toFixed(2)}` : ""} />
        <Field label="Cost" value={id.cost1 != null ? `$${id.cost1.toFixed(2)}` : ""} />
        <Field
          label="Package"
          value={
            id.packageSize != null
              ? `${id.packageSize}${id.packageUnit ? " " + id.packageUnit : ""}${id.outerPackageSize ? ` × ${id.outerPackageSize}` : ""}`
              : ""
          }
        />
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex gap-1 items-baseline min-w-0">
      <span className="text-[#808080] shrink-0">{label}:</span>
      <span className="truncate">{value || <span className="text-[#808080]">—</span>}</span>
    </div>
  )
}

/**
 * Single NDC cell in the sibling table. NDCs that have Multum reference info
 * render link-styled (blue, underline on hover) and open a `NdcDetailPopover`
 * on click. NDCs without Multum data render plain — clicking would be
 * pointless. The small dot before the NDC reinforces the "this is referenced"
 * signal at a glance.
 */
function NdcCell({
  ndc,
  isReference,
  isSelected,
}: {
  ndc: string
  isReference: boolean
  isSelected: boolean
}) {
  // Non-reference NDC: plain text, no popover (nothing in Multum to show).
  // `select-text` keeps text selectable for copy. Click bubbles up so the
  // row's onClick still selects it — same as clicking any other cell. Color
  // inherits from the cell/row so contrast stays correct in both selected
  // (white-on-blue) and unselected (black-on-light) states.
  if (!isReference) {
    return (
      <span
        className="select-text"
        title="Not in Multum — likely a hospital-repackaged inner NDC or non-reference product."
      >
        {ndc}
      </span>
    )
  }
  // Reference NDC: link-styled trigger that opens the Multum popover.
  // `select-text` overrides the button default of user-select:none so the
  // user can drag-select / right-click → copy or use ⌘+C after selection.
  // Drag without click won't trigger Radix open (drag != click), so text
  // selection coexists with click-to-open cleanly.
  return (
    <NdcDetailPopover ndc={ndc}>
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 font-mono tabular-nums select-text underline-offset-2 decoration-dotted hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0033AA] active:bg-[#E5EEF7] data-[state=open]:bg-[#E5EEF7] data-[state=open]:underline data-[state=open]:decoration-solid px-0.5 -mx-0.5 ${
          isSelected ? "text-white" : "text-[#0033AA]"
        }`}
        title="Click to view Multum reference detail · drag to select text"
      >
        <span
          aria-hidden="true"
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
            isSelected ? "bg-white" : "bg-[#0033AA]"
          }`}
        />
        {ndc}
      </button>
    </NdcDetailPopover>
  )
}

/**
 * Other NDCs stacked on the same product (group_id) as the looked-up NDC.
 * Surfaces manufacturer alternates, repackaged unit-doses, and the inner-NDC
 * companion that lives under another row's properties in phadbproductmgr —
 * so the user can see the full package family at a glance instead of having
 * to open the Supply tab.
 *
 * When the user's facility domain has its own build, prefer those siblings;
 * otherwise merge across all builds and de-dupe by NDC, tagging which domain(s)
 * each appears in.
 */
function SiblingNdcsPanel({
  lookup,
  preferredDomain,
}: {
  lookup: NonNullable<ScanResult["lookup"]>
  preferredDomain: string | null
}) {
  const builds = lookup.builds
  // Hooks must run unconditionally — guard the empty case after them.
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)

  // Prefer the user's-domain build when present; otherwise merge.
  const preferredBuild = preferredDomain
    ? builds.find((b) => b.domain === preferredDomain)
    : null

  type MergedSibling = {
    ndc: string
    isNonReference: boolean
    isPrimary: boolean
    isUnitDose: boolean
    isBrand: boolean
    isActive: boolean
    isReference: boolean
    manufacturer: string
    domains: string[]
  }

  const merged: MergedSibling[] = (() => {
    if (builds.length === 0) return []
    if (preferredBuild) {
      return preferredBuild.siblingNdcs.map((s) => ({
        ndc: s.ndc,
        isNonReference: s.isNonReference,
        isPrimary: s.isPrimary,
        isUnitDose: s.isUnitDose,
        isBrand: s.isBrand,
        isActive: s.isActive,
        isReference: s.isReference,
        manufacturer: s.manufacturer,
        domains: [preferredBuild.domain],
      }))
    }
    const byNdc = new Map<string, MergedSibling>()
    for (const b of builds) {
      for (const s of b.siblingNdcs) {
        const existing = byNdc.get(s.ndc)
        if (existing) {
          if (!existing.domains.includes(b.domain)) existing.domains.push(b.domain)
          // Reference flag is the same per-NDC across domains, but be defensive
          // — a true reading from any build wins.
          if (s.isReference) existing.isReference = true
        } else {
          byNdc.set(s.ndc, {
            ndc: s.ndc,
            isNonReference: s.isNonReference,
            isPrimary: s.isPrimary,
            isUnitDose: s.isUnitDose,
            isBrand: s.isBrand,
            isActive: s.isActive,
            isReference: s.isReference,
            manufacturer: s.manufacturer,
            domains: [b.domain],
          })
        }
      }
    }
    return Array.from(byNdc.values())
  })()

  if (merged.length === 0) return null

  const headingDomain = preferredBuild
    ? `in ${preferredBuild.domain}`
    : "across all domains"
  const totalDomains = preferredBuild
    ? 1
    : new Set(merged.flatMap((s) => s.domains)).size

  return (
    <div className="flex flex-col text-xs font-mono border border-[#808080] bg-white">
      <div className="px-2 py-1 bg-[#D4D0C8] border-b border-[#808080] text-[10px] uppercase text-[#404040] flex items-center justify-between shrink-0">
        <span>Other NDCs on this product ({merged.length})</span>
        <span className="normal-case text-[#808080]">{headingDomain}</span>
      </div>
      <div className="overflow-auto max-h-64">
        <Table className="text-xs font-mono border-collapse w-full min-w-max">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">Act</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">1*</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-32">NDC</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-32">Inner NDC</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center" title="Unit Dose">UD</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080]">Manufacturer</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">B/G</TableHead>
              {totalDomains > 1 && (
                <TableHead className="h-6 px-2 text-xs font-mono text-foreground w-20 text-right">Domains</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {merged.map((s, idx) => {
              const isSelected = selectedNdc === s.ndc
              return (
                <TableRow
                  key={s.ndc}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? "bg-[#316AC5] text-white"
                      : idx % 2 === 0
                      ? "bg-white hover:bg-[#C7D5E8]"
                      : "bg-[#F0F0F0] hover:bg-[#C7D5E8]"
                  }`}
                  onClick={() => setSelectedNdc(s.ndc === selectedNdc ? null : s.ndc)}
                >
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox
                      checked={s.isActive}
                      className="rounded-none border-[#808080] h-3 w-3"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox
                      checked={s.isPrimary}
                      className="rounded-none border-[#808080] h-3 w-3"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono tabular-nums">
                    <NdcCell ndc={s.ndc} isReference={s.isReference} isSelected={isSelected} />
                  </TableCell>
                  <TableCell
                    className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono tabular-nums"
                    title={
                      s.isNonReference
                        ? "Stacked under another NDC's properties — typically an inner-package or repackaged unit-dose. The parent NDC is one of the reference rows on this same product."
                        : undefined
                    }
                  >
                    {s.isNonReference ? (
                      <NdcCell ndc={s.ndc} isReference={s.isReference} isSelected={isSelected} />
                    ) : (
                      ""
                    )}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox
                      checked={s.isUnitDose}
                      className="rounded-none border-[#808080] h-3 w-3"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] truncate max-w-[280px]">
                    {s.manufacturer || (
                      <span className={isSelected ? "italic" : "text-[#808080] italic"}>no manufacturer</span>
                    )}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    {s.isBrand ? "B" : "G"}
                  </TableCell>
                  {totalDomains > 1 && (
                    <TableCell
                      className="h-5 px-2 py-0 text-right"
                      title={s.domains.join(", ")}
                    >
                      <span className={isSelected ? "" : "text-[#808080]"}>
                        {s.domains.length === totalDomains ? "all" : `${s.domains.length}/${totalDomains}`}
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 px-2 py-1 bg-[#D4D0C8] border-t border-[#808080] shrink-0">
        <span className="text-[10px] text-[#808080] self-center">
          {merged.length} NDC{merged.length !== 1 ? "s" : ""}
          {(() => {
            const inner = merged.filter((s) => s.isNonReference).length
            const ud = merged.filter((s) => s.isUnitDose).length
            const inactive = merged.filter((s) => !s.isActive).length
            const parts: string[] = []
            if (inner > 0) parts.push(`${inner} inner`)
            if (ud > 0) parts.push(`${ud} UD`)
            if (inactive > 0) parts.push(`${inactive} inactive`)
            return parts.length > 0 ? ` · ${parts.join(" · ")}` : ""
          })()}
        </span>
      </div>
    </div>
  )
}

function EvidencePanel({ evidence }: { evidence: NonNullable<ScanResult["diagnosis"]>["evidence"] }) {
  return (
    <details className="border border-[#808080] bg-white">
      <summary className="px-2 py-1 cursor-pointer bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[10px] uppercase text-[#404040]">
        Evidence
      </summary>
      <div className="p-2 space-y-2">
        <div className="text-xs">
          Facility domain: <span className="font-bold">{evidence.facilityDomain ?? "(unknown)"}</span>
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#808080] mb-1">
            Builds in this domain ({evidence.buildsInDomain.length})
          </div>
          {evidence.buildsInDomain.length === 0 ? (
            <div className="text-[#808080] italic">none</div>
          ) : (
            <ul className="space-y-0.5">
              {evidence.buildsInDomain.map((b) => (
                <li key={`${b.domain}-${b.groupId}`}>
                  <span className="font-bold">{b.domain}</span> · group {b.groupId} · Pyxis {b.pyxisId || "—"} · CDM {b.chargeNumber || "—"}
                  {b.flexedAtRequestedFacility ? (
                    <span className="ml-2 text-green-800">✓ flexed here</span>
                  ) : (
                    <span className="ml-2 text-yellow-800">flexed at {b.flexedFacilities.length} other</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase text-[#808080] mb-1">
            Builds in other domains ({evidence.buildsInOtherDomains.length})
          </div>
          {evidence.buildsInOtherDomains.length === 0 ? (
            <div className="text-[#808080] italic">none</div>
          ) : (
            <ul className="space-y-0.5">
              {evidence.buildsInOtherDomains.map((b) => (
                <li key={`${b.domain}-${b.groupId}`}>
                  <span className="font-bold">{b.domain}</span> · group {b.groupId} · Pyxis {b.pyxisId || "—"} · CDM {b.chargeNumber || "—"} · flexed at {b.flexedFacilities.length}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="text-xs">
          Multum master CDM:{" "}
          <span className={evidence.multumPresent ? "text-green-800 font-bold" : "text-[#808080]"}>
            {evidence.multumPresent ? "present" : "not in extract"}
          </span>
        </div>
      </div>
    </details>
  )
}

/**
 * Decision Trace — maintainer/admin-only view that walks through every check
 * the classifier ran (and what it didn't run) so investigators can answer
 * "why did this scan get verdict X?". Open by default — investigators are
 * looking at it because they already opened the panel.
 *
 * Status pills mirror diagnosis-trace.ts:
 *   pass     — green   (signal found)
 *   fail     — gray    (signal absent)
 *   skipped  — muted   (earlier branch short-circuited this check)
 *   deferred — orange  (probe exists in design, not yet wired up)
 */
function DecisionTracePanel({ trace }: { trace: DecisionTrace }) {
  return (
    <details open className="border border-[#808080] bg-white">
      <summary className="px-2 py-1 cursor-pointer bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[10px] uppercase text-[#404040] flex items-center justify-between">
        <span>Decision trace (maintainer view)</span>
        <span className="font-mono text-[#404040] normal-case">
          → State {trace.verdict.state} <span className="text-[#808080]">·</span> {trace.verdict.rule}
        </span>
      </summary>
      <div className="p-2 space-y-3 text-xs">
        {/* Parse summary */}
        <div className="border border-[#D0D0D0] bg-[#FAFAFA] p-2 space-y-0.5">
          <div className="text-[10px] uppercase text-[#808080]">Barcode / NDC parse</div>
          <div>
            Format: <span className="font-mono">{trace.parseTrace.format}</span>
            <span className="text-[#808080]"> · </span>
            Digits: <span className="font-mono">{trace.parseTrace.digits || "—"}</span>
          </div>
          <div>
            Candidates tried:{" "}
            <span className="font-mono">
              {trace.parseTrace.candidates.length === 0
                ? "(none parsed)"
                : trace.parseTrace.candidates.join(", ")}
            </span>
          </div>
          <div>
            Chosen: <span className="font-mono font-bold">{trace.parseTrace.chosenNdc || "—"}</span>
            {trace.parseTrace.alternates.length > 0 && (
              <>
                <span className="text-[#808080]"> · alternates: </span>
                <span className="font-mono">
                  {trace.parseTrace.alternates
                    .map((a) => `${a.ndc} (${a.state})`)
                    .join(", ")}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Checks the classifier ran */}
        <div>
          <div className="text-[10px] uppercase text-[#808080] mb-1">
            Checks run ({trace.ranChecks.length})
          </div>
          <ul className="space-y-1">
            {trace.ranChecks.map((c) => (
              <TraceRow key={c.id} check={c} />
            ))}
          </ul>
        </div>

        {/* Deferred probes */}
        <div>
          <div className="text-[10px] uppercase text-[#808080] mb-1">
            Deferred probes ({trace.deferredChecks.length}) — design calls for these but they
            aren&apos;t wired up yet
          </div>
          <ul className="space-y-1">
            {trace.deferredChecks.map((c) => (
              <TraceRow key={c.id} check={c} />
            ))}
          </ul>
        </div>
      </div>
    </details>
  )
}

function TraceRow({ check }: { check: TraceCheck }) {
  const pill = STATUS_PILL[check.status]
  return (
    <li className="border border-[#E0E0E0] bg-white px-2 py-1">
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 mt-0.5 px-1.5 py-0.5 text-[9px] font-bold uppercase border ${pill.cls}`}
          title={check.status}
        >
          {pill.label}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-bold text-[#202020]">{check.label}</div>
          <div className="text-[#404040]">{check.detail}</div>
          {check.reason && (
            <div className="text-[10px] italic text-[#808080]">
              <span className="font-bold not-italic">Why:</span> {check.reason}
            </div>
          )}
          {check.futureSource && (
            <div className="text-[10px] font-mono text-[#606060] break-all">
              <span className="not-italic font-sans font-bold text-[#808080]">→ </span>
              {check.futureSource}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

const STATUS_PILL: Record<TraceCheck["status"], { label: string; cls: string }> = {
  pass: { label: "✓ pass", cls: "border-green-700 bg-green-50 text-green-900" },
  fail: { label: "✗ fail", cls: "border-[#808080] bg-[#F0F0F0] text-[#404040]" },
  skipped: { label: "—skip", cls: "border-[#C0C0C0] bg-[#FAFAFA] text-[#808080]" },
  deferred: { label: "⏳ todo", cls: "border-orange-600 bg-orange-50 text-orange-900" },
}

/**
 * Type-to-filter facility picker.
 *
 * Why a custom combobox instead of the shadcn Select: facility lists are long
 * (every facility in the org), so users want autofill / search. The picker
 * always offers an explicit "All facilities" option at the top — this is
 * also the persisted default for new users via the empty-string sentinel.
 *
 * Single-select for now. Multi-select (with domain tabs and architect-defined
 * groups) is the planned successor — see TaskList items "Design facility
 * classification data model" / "Build FacilityClassificationWindow" /
 * "Rebuild scanner facility picker on top of classifications". The scanner
 * backend already accepts `facilities[]` so the wire format won't change.
 */
function FacilityCombobox({
  facilities,
  value,
  onChange,
}: {
  facilities: string[]
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener("pointerdown", onDown)
    return () => window.removeEventListener("pointerdown", onDown)
  }, [open])

  // When opening, focus the search field and reset query/highlight.
  useEffect(() => {
    if (open) {
      setQuery("")
      setHighlight(0)
      // Defer to allow render before focusing
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Build the option list — "All facilities" always sits at the top,
  // followed by alphabetical facilities filtered by the search query.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items: { value: string; label: string; isAll?: boolean }[] = [
      { value: ALL_FACILITIES, label: "All facilities", isAll: true },
    ]
    for (const f of facilities) {
      if (!q || f.toLowerCase().includes(q)) {
        items.push({ value: f, label: f })
      }
    }
    // If the query doesn't match "all" or "all facilities", drop the All row
    // so the user can hit Enter on the first real match.
    if (q && !"all facilities".includes(q)) {
      return items.filter((i) => !i.isAll)
    }
    return items
  }, [facilities, query])

  // Keep highlight in range when the option list shrinks.
  useEffect(() => {
    if (highlight >= options.length) setHighlight(Math.max(0, options.length - 1))
  }, [options.length, highlight])

  // Scroll highlighted row into view as the user arrows through the list.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [open, highlight])

  function commit(next: string) {
    onChange(next)
    setOpen(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((h) => Math.min(options.length - 1, h + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const opt = options[highlight]
      if (opt) commit(opt.value)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  const displayLabel = value === ALL_FACILITIES ? "All facilities" : value
  const showClear = value !== ALL_FACILITIES

  return (
    <div ref={wrapRef} className="relative w-full max-w-md flex items-stretch gap-1">
      {/* Trigger — looks like an input/select hybrid */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex-1 min-w-0 text-xs font-mono rounded-none border border-[#808080] px-2 h-8 bg-white flex items-center justify-between gap-1 hover:border-[#316AC5] focus:outline-none focus:border-[#316AC5]"
      >
        <span className={`truncate text-left ${value === ALL_FACILITIES ? "text-[#404040] italic" : "text-black"}`}>
          {displayLabel}
        </span>
        <ChevronDown size={12} className="shrink-0 text-[#808080]" />
      </button>
      {/* Sibling reset button — kept outside the trigger so we don't nest
         interactive elements inside a <button>. Only shown once a real
         facility is selected. */}
      {showClear && (
        <button
          type="button"
          onClick={() => commit(ALL_FACILITIES)}
          aria-label="Reset to all facilities"
          title="Reset to all facilities"
          className="shrink-0 h-8 w-8 text-xs font-mono rounded-none border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-[#404040] hover:text-[#CC0000] flex items-center justify-center"
        >
          <XIcon size={12} />
        </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 mt-0.5 z-[200] bg-white border border-[#808080] shadow-lg flex flex-col">
          <div className="p-1 border-b border-[#C0C0C0] bg-[#F5F5F5]">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={handleKey}
              placeholder="Search facilities…"
              autoComplete="off"
              spellCheck={false}
              className="w-full text-xs font-mono border border-[#808080] px-1 h-6 bg-white outline-none focus:border-[#316AC5]"
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-60 overflow-y-auto"
          >
            {options.length === 0 ? (
              <li className="px-2 py-1 text-xs font-mono text-[#808080] italic">
                No facilities match.
              </li>
            ) : (
              options.map((opt, i) => {
                const selected = opt.value === value
                const highlighted = i === highlight
                return (
                  <li
                    key={opt.value || "__all__"}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(opt.value)}
                    className={`px-2 py-1 text-xs font-mono cursor-pointer flex items-center justify-between gap-2 ${
                      highlighted ? "bg-[#316AC5] text-white" : "bg-white text-black"
                    } ${opt.isAll ? "border-b border-[#E0E0E0]" : ""}`}
                  >
                    <span className={`truncate ${opt.isAll ? "italic" : ""}`}>{opt.label}</span>
                    {selected && (
                      <span className={`text-[10px] ${highlighted ? "text-white" : "text-[#316AC5]"}`}>
                        ✓
                      </span>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
