"use client"

/**
 * NDC detail popover — opens on click of an NDC cell, fetches Multum content
 * and DailyMed images, and renders the fields a clinician actually looks for:
 * formulation, MMDC, package, cost. Reserves a slot for a DailyMed product
 * image gallery.
 *
 * Caller wraps a clickable element with this component:
 *
 *   <NdcDetailPopover ndc="00904-7704-80">
 *     <button>00904-7704-80</button>
 *   </NdcDetailPopover>
 *
 * Implementation note: this used to be a Radix Popover, but Radix popovers
 * are anchored and can't be moved. Users wanted to drag the panel and resize
 * the image area, so we render a custom floating panel via portal. Keeps the
 * "click trigger to open, click outside or Esc to close" semantics, plus:
 *   - Drag the title bar to reposition (Win95-style)
 *   - Drag the bottom-right corner to resize (the image area expands to fill)
 *   - X button or Escape to close
 *
 * Fetch is on-open (not on-mount) so the table doesn't fire 50 requests when
 * the user hits a multi-NDC product. Both Multum and DailyMed responses are
 * cached at module level for the popover's lifetime.
 */

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import { X as XIcon } from "lucide-react"

/**
 * Maximize state context — lets the hero image's corner button toggle the
 * panel's maximize state without prop-drilling four levels through
 * DetailContents → DetailBody → ImageSlot → ImageGallery.
 */
const MaximizeContext = createContext<{
  maximized: boolean
  toggle: () => void
} | null>(null)

interface MultumImprint {
  side1Marking: string | null
  side2Marking: string | null
  scored: boolean
  shape: string | null
  color: string | null
  flavor: string | null
  additionalDoseForm: string | null
  imageFilename: string | null
}

interface MultumNdcDetail {
  ndc: string
  mmdc: number | null
  awp: number | null
  aCost: number | null
  innerPkgSize: number | null
  outerPkgSize: number | null
  isUnitDose: boolean
  gbo: string | null
  repackaged: string | null
  genericName: string | null
  strengthDescription: string | null
  doseFormDescription: string | null
  manufacturerName: string | null
  otcStatus: string | null
  obsoleteDate: string | null
  csaSchedule: string | null
  orangeBookRating: string | null
  orangeBookDescription: string | null
  imprint: MultumImprint | null
}

interface DailymedImage {
  name: string
  url: string
  mimeType: string | null
}

interface DailymedDetail {
  ndc: string
  setId: string | null
  title: string | null
  publishedDate: string | null
  splCount: number
  images: DailymedImage[]
}

interface OpenFdaActiveIngredient {
  name: string | null
  strength: string | null
}

interface OpenFdaDetail {
  ndc: string
  brandName: string | null
  genericName: string | null
  labelerName: string | null
  dosageForm: string | null
  route: string[]
  marketingCategory: string | null
  marketingStartDate: string | null
  marketingEndDate: string | null
  productNdc: string | null
  productType: string | null
  pharmClass: string[]
  deaSchedule: string | null
  activeIngredients: OpenFdaActiveIngredient[]
  packaging: Array<{
    package_ndc: string | null
    description: string | null
    marketing_start_date: string | null
  }>
  label: {
    indicationsAndUsage: string | null
    dosageAndAdministration: string | null
    contraindications: string | null
    warnings: string | null
    boxedWarning: string | null
    adverseReactions: string | null
    splSetId: string | null
  } | null
}

interface RxNormConcept {
  rxcui: string
  name: string
  tty: string
}

interface RxNormDetail {
  ndc: string
  rxcui: string | null
  name: string | null
  tty: string | null
  status: string | null
  ingredients: RxNormConcept[]
  brandNames: RxNormConcept[]
  scd: RxNormConcept[]
  sbd: RxNormConcept[]
}

interface Props {
  ndc: string
  children: ReactElement<{
    onClick?: (e: ReactMouseEvent) => void
    ref?: Ref<HTMLElement>
  }>
}

// Module-level caches — repeat opens of the same NDC popover don't refetch.
const multumCache = new Map<string, MultumNdcDetail | null>()
const dailymedCache = new Map<string, DailymedDetail | null>()
const openfdaCache = new Map<string, OpenFdaDetail | null>()
const rxnormCache = new Map<string, RxNormDetail | null>()

const MIN_W = 280
const MIN_H = 280
const DEFAULT_W = 340
const DEFAULT_H = 540
const VIEWPORT_MARGIN = 8
const Z_INDEX = 9000

interface Size {
  w: number
  h: number
}
interface Position {
  x: number
  y: number
}

export function NdcDetailPopover({ ndc, children }: Props) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [size, setSize] = useState<Size>({ w: DEFAULT_W, h: DEFAULT_H })
  const [maximized, setMaximized] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{ startX: number; startY: number; startPos: Position } | null>(null)
  const resizeState = useRef<{ startX: number; startY: number; startSize: Size } | null>(null)
  // Saved geometry from before maximize, restored when toggling back.
  const preMaxState = useRef<{ position: Position; size: Size } | null>(null)

  const toggleMaximize = useCallback(() => {
    setMaximized((prev) => {
      if (prev) {
        if (preMaxState.current) {
          setPosition(preMaxState.current.position)
          setSize(preMaxState.current.size)
        }
        return false
      }
      if (position) {
        preMaxState.current = { position, size }
      }
      return true
    })
  }, [position, size])

  // Compose the child trigger to add our click handler + ref. The original
  // onClick still fires (e.g. e.stopPropagation in the caller) before we
  // toggle the panel.
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          triggerRef.current = el
        },
        onClick: (e: ReactMouseEvent) => {
          children.props.onClick?.(e)
          if (e.defaultPrevented) return
          if (open) {
            setOpen(false)
            return
          }
          // Position the panel near the trigger. Prefer left side; flip to
          // right if there's no room. Clamp to viewport so it doesn't open
          // partially off-screen.
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const left = rect.left - size.w - VIEWPORT_MARGIN
          const right = rect.right + VIEWPORT_MARGIN
          const x =
            left >= VIEWPORT_MARGIN
              ? left
              : right + size.w + VIEWPORT_MARGIN <= window.innerWidth
              ? right
              : Math.max(VIEWPORT_MARGIN, window.innerWidth - size.w - VIEWPORT_MARGIN)
          const maxY = window.innerHeight - size.h - VIEWPORT_MARGIN
          const y = Math.max(VIEWPORT_MARGIN, Math.min(rect.top, maxY))
          setPosition({ x, y })
          setOpen(true)
        },
      })
    : children

  // Close on click-outside (but not on the trigger itself — clicking the
  // trigger again toggles).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener("pointerdown", onDown)
    return () => window.removeEventListener("pointerdown", onDown)
  }, [open])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Drag + resize pointer handlers — global so user can drag past the panel
  // edges. Mirrors the pattern in ScannerWindow.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragState.current) {
        const { startX, startY, startPos } = dragState.current
        const x = startPos.x + e.clientX - startX
        const y = startPos.y + e.clientY - startY
        // Clamp to viewport so the panel can't be lost off-screen.
        const maxX = window.innerWidth - size.w
        const maxY = window.innerHeight - size.h
        setPosition({
          x: Math.max(0, Math.min(x, maxX)),
          y: Math.max(0, Math.min(y, maxY)),
        })
        return
      }
      if (resizeState.current) {
        const { startX, startY, startSize } = resizeState.current
        setSize({
          w: Math.max(MIN_W, startSize.w + e.clientX - startX),
          h: Math.max(MIN_H, startSize.h + e.clientY - startY),
        })
      }
    }
    const onUp = () => {
      dragState.current = null
      resizeState.current = null
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [size.w, size.h])

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!position || maximized) return
    e.preventDefault()
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos: position,
    }
  }

  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    if (maximized) return
    e.preventDefault()
    e.stopPropagation()
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startSize: size,
    }
  }

  // Reset maximize state when the panel closes — opening it again should
  // start at the user's last manual size, not stuck-maximized.
  useEffect(() => {
    if (!open) setMaximized(false)
  }, [open])

  return (
    <>
      {trigger}
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              style={
                maximized
                  ? {
                      position: "fixed",
                      left: VIEWPORT_MARGIN,
                      top: VIEWPORT_MARGIN,
                      right: VIEWPORT_MARGIN,
                      bottom: VIEWPORT_MARGIN,
                      zIndex: Z_INDEX,
                    }
                  : {
                      position: "fixed",
                      left: position.x,
                      top: position.y,
                      width: size.w,
                      height: size.h,
                      zIndex: Z_INDEX,
                    }
              }
              className="border-2 border-[#808080] bg-[#FAFAFA] font-mono text-xs shadow-[3px_3px_0_#000] flex flex-col select-none"
              onPointerDown={(e) => {
                // Don't treat clicks inside the panel as outside-click closes.
                e.stopPropagation()
              }}
            >
              {/* Title bar — drag handle (no-op when maximized). Double-click
                  to toggle maximize matches Win95 convention. */}
              <div
                onPointerDown={startDrag}
                onDoubleClick={toggleMaximize}
                className={`px-2 py-1 bg-[#316AC5] text-white text-[11px] font-bold flex items-center justify-between shrink-0 ${
                  maximized ? "cursor-default" : "cursor-move"
                }`}
              >
                <span>Multum detail</span>
                <span className="font-mono tabular-nums opacity-90 px-2 truncate">
                  {ndc}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={toggleMaximize}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center hover:bg-[#E0DBD0] leading-none text-[10px]"
                    aria-label={maximized ? "Restore" : "Maximize"}
                    title={maximized ? "Restore" : "Maximize"}
                  >
                    {maximized ? "❐" : "□"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="w-4 h-4 border border-white/40 bg-[#D4D0C8] text-black flex items-center justify-center hover:bg-[#E0DBD0]"
                    aria-label="Close"
                    title="Close"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              </div>

              {/* Body — flex column so the image gallery can claim remaining
                  vertical space when the user resizes the panel taller. The
                  outer overflow-hidden lets the inner gallery's flex-1 grow
                  without being constrained by a scroll container. Metadata
                  sections (formulation, identifiers, package, cost) take
                  their natural heights at top/bottom; the image fills the
                  middle. text-selectable so users can copy values. */}
              <MaximizeContext.Provider value={{ maximized, toggle: toggleMaximize }}>
                <div className="flex-1 min-h-0 overflow-hidden p-2 flex flex-col gap-2 select-text">
                  <DetailContents ndc={ndc} />
                </div>
              </MaximizeContext.Provider>

              {/* Resize handle — bottom-right corner. Hidden while maximized
                  since the panel fills the viewport. */}
              {!maximized && (
                <div
                  onPointerDown={startResize}
                  className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, transparent 0%, transparent 50%, #808080 50%, #808080 60%, transparent 60%, transparent 70%, #808080 70%, #808080 80%, transparent 80%)",
                  }}
                  aria-label="Resize"
                />
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * Content inside the panel: Multum detail block + DailyMed image gallery.
 * Split out so the panel-shell logic above stays focused on geometry.
 */
function DetailContents({ ndc }: { ndc: string }) {
  const [detail, setDetail] = useState<MultumNdcDetail | null | undefined>(
    () => multumCache.get(ndc),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (multumCache.has(ndc)) {
      setDetail(multumCache.get(ndc))
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/ndc/${encodeURIComponent(ndc)}/multum`)
      .then(async (r) => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as MultumNdcDetail
      })
      .then((d) => {
        multumCache.set(ndc, d)
        setDetail(d)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Lookup failed")
        setDetail(null)
      })
      .finally(() => setLoading(false))
  }, [ndc])

  if (loading) return <Skeleton />
  if (error) {
    return (
      <div className="border border-[#CC0000] bg-red-50 text-[#CC0000] px-2 py-1 text-[11px]">
        {error}
      </div>
    )
  }
  if (detail === null) {
    return (
      <div className="text-[11px] text-[#606060] italic px-1">
        Not found in Multum. This NDC may be a hospital-repackaged inner NDC
        or a non-reference product added under another row&apos;s properties.
      </div>
    )
  }
  if (!detail) return null
  return <DetailBody detail={detail} />
}

function Skeleton() {
  return (
    <div className="space-y-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-3 bg-[#E0E0E0] animate-pulse"
          style={{ width: `${50 + ((i * 13) % 40)}%` }}
        />
      ))}
    </div>
  )
}

function DetailBody({ detail }: { detail: MultumNdcDetail }) {
  const formulation = [
    detail.genericName,
    detail.strengthDescription,
    detail.doseFormDescription,
  ]
    .filter(Boolean)
    .join(" ")

  // Layout strategy: the image gallery is `flex-1 min-h-0` so it claims any
  // vertical space the metadata sections don't use. Text sections wrap in a
  // shrink-0 group at top (formulation, obsolete) and a shrink-0 scrollable
  // group at the bottom (identifiers/package/cost) — that bottom group can
  // scroll on its own if the panel is too short for everything.
  return (
    <>
      <div className="shrink-0 space-y-1">
        {formulation && (
          <div className="font-bold text-[12px] text-[#202020] leading-snug pb-1 border-b border-[#E0E0E0]">
            {formulation}
          </div>
        )}
        {detail.obsoleteDate && (
          <div className="border border-orange-700 bg-orange-50 text-orange-900 px-2 py-1 text-[10px]">
            ⚠ Obsolete since {detail.obsoleteDate} — Multum has flagged this NDC discontinued.
          </div>
        )}
        {detail.imprint && <ImprintSummary imprint={detail.imprint} />}
      </div>

      <ImageSlot ndc={detail.ndc} />

      <div className="shrink-0 overflow-y-auto space-y-2 max-h-[40%]">
        <Section title="Identifiers">
          <Row
            label="MMDC"
            value={detail.mmdc != null ? String(detail.mmdc) : "—"}
            mono
          />
          <Row
            label="B/G"
            value={
              detail.gbo === "B"
                ? "Brand"
                : detail.gbo === "G"
                ? "Generic"
                : detail.gbo === "N"
                ? "Neither (OTC etc.)"
                : "—"
            }
          />
          {detail.manufacturerName && (
            <Row label="Labeler" value={detail.manufacturerName} />
          )}
          {detail.otcStatus && <Row label="OTC status" value={detail.otcStatus} />}
          {detail.csaSchedule && detail.csaSchedule !== "0" && (
            <Row label="CSA schedule" value={detail.csaSchedule} />
          )}
          {detail.orangeBookRating && detail.orangeBookRating !== "O" && (
            <Row
              label="Orange Book"
              value={`${detail.orangeBookRating}${detail.orangeBookDescription ? ` — ${detail.orangeBookDescription}` : ""}`}
            />
          )}
        </Section>

        <Section title="Package">
          <Row
            label="Inner"
            value={detail.innerPkgSize != null ? String(detail.innerPkgSize) : "—"}
            mono
          />
          <Row
            label="Outer"
            value={detail.outerPkgSize != null ? String(detail.outerPkgSize) : "—"}
            mono
          />
          <Row label="Unit dose" value={detail.isUnitDose ? "yes" : "no"} />
          <Row
            label="Repackaged"
            value={
              detail.repackaged === "T" ? "yes" : detail.repackaged === "F" ? "no" : "—"
            }
          />
        </Section>

        <Section title="Cost">
          <Row label="AWP" value={fmtMoney(detail.awp)} mono />
          <Row label="Acquisition" value={fmtMoney(detail.aCost)} mono />
        </Section>

        {/* OpenFDA — NDC Directory + label highlights. Lazy-fetched alongside
            Multum so the user gets the FDA's view of marketing status,
            ingredients, and pharm class without leaving the popover. */}
        <OpenFdaSlot ndc={detail.ndc} />

        {/* RxNorm — NLM concept service. Surfaces RxCUI + ingredient/brand
            concepts so the user can cross-reference into RxNav or other
            RxCUI-based systems. */}
        <RxNormSlot ndc={detail.ndc} />
      </div>
    </>
  )
}

/**
 * OpenFDA detail slot inside the popover. Fetches `/api/ndc/[ndc]/openfda`,
 * caches at module level, renders a compact section. Empty state when the
 * NDC isn't in OpenFDA.
 */
function OpenFdaSlot({ ndc }: { ndc: string }) {
  const [detail, setDetail] = useState<OpenFdaDetail | null | undefined>(
    () => openfdaCache.get(ndc),
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (openfdaCache.has(ndc)) {
      setDetail(openfdaCache.get(ndc))
      return
    }
    setLoading(true)
    fetch(`/api/ndc/${encodeURIComponent(ndc)}/openfda`)
      .then(async (r) => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as OpenFdaDetail
      })
      .then((d) => {
        openfdaCache.set(ndc, d)
        setDetail(d)
      })
      .catch(() => {
        // Network/timeout — leave silent. The DailyMed section above already
        // signals NIH availability; users can re-open if they need the data.
        setDetail(null)
      })
      .finally(() => setLoading(false))
  }, [ndc])

  if (loading) {
    return (
      <Section title="OpenFDA">
        <div className="text-[10px] text-[#808080] italic">Loading…</div>
      </Section>
    )
  }
  if (!detail) {
    return (
      <Section title="OpenFDA">
        <div className="text-[10px] text-[#808080] italic">Not in OpenFDA.</div>
      </Section>
    )
  }
  const ingredients = detail.activeIngredients
    .filter((i) => i.name)
    .map((i) => `${i.name}${i.strength ? ` ${i.strength}` : ""}`)
    .join(" / ")
  return (
    <Section title="OpenFDA">
      {detail.brandName && <Row label="Brand" value={detail.brandName} />}
      {detail.genericName && <Row label="Generic" value={detail.genericName} />}
      {detail.dosageForm && <Row label="Form" value={detail.dosageForm} />}
      {detail.route.length > 0 && <Row label="Route" value={detail.route.join(", ")} />}
      {detail.marketingCategory && (
        <Row label="Marketing" value={detail.marketingCategory} />
      )}
      {detail.deaSchedule && <Row label="DEA" value={detail.deaSchedule} />}
      {detail.productNdc && <Row label="Product NDC" value={detail.productNdc} mono />}
      {ingredients && <Row label="Active" value={ingredients} />}
      {detail.label?.boxedWarning && (
        <div className="mt-1 px-1.5 py-1 border border-orange-700 bg-orange-50 text-orange-900 text-[10px]">
          ⚠ Boxed warning on file — see full label on FDA.
        </div>
      )}
    </Section>
  )
}

/**
 * RxNorm detail slot inside the popover. Fetches `/api/ndc/[ndc]/rxnorm`,
 * caches at module level, renders RxCUI + ingredient + brand concept lines
 * with a link to RxNav for the full concept tree.
 */
function RxNormSlot({ ndc }: { ndc: string }) {
  const [detail, setDetail] = useState<RxNormDetail | null | undefined>(
    () => rxnormCache.get(ndc),
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (rxnormCache.has(ndc)) {
      setDetail(rxnormCache.get(ndc))
      return
    }
    setLoading(true)
    fetch(`/api/ndc/${encodeURIComponent(ndc)}/rxnorm`)
      .then(async (r) => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as RxNormDetail
      })
      .then((d) => {
        rxnormCache.set(ndc, d)
        setDetail(d)
      })
      .catch(() => {
        setDetail(null)
      })
      .finally(() => setLoading(false))
  }, [ndc])

  if (loading) {
    return (
      <Section title="RxNorm">
        <div className="text-[10px] text-[#808080] italic">Loading…</div>
      </Section>
    )
  }
  if (!detail) {
    return (
      <Section title="RxNorm">
        <div className="text-[10px] text-[#808080] italic">Not in RxNorm.</div>
      </Section>
    )
  }
  return (
    <Section title="RxNorm">
      {detail.rxcui && <Row label="RxCUI" value={detail.rxcui} mono />}
      {detail.tty && <Row label="TTY" value={detail.tty} />}
      {detail.status && (
        <Row
          label="Status"
          value={detail.status}
        />
      )}
      {detail.name && <Row label="Name" value={detail.name} />}
      {detail.ingredients.length > 0 && (
        <Row
          label="Ingredients"
          value={detail.ingredients.map((i) => i.name).join(" / ")}
        />
      )}
      {detail.brandNames.length > 0 && (
        <Row
          label="Brands"
          value={detail.brandNames.map((b) => b.name).join(", ")}
        />
      )}
      {detail.rxcui && (
        <a
          href={`https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${detail.rxcui}`}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-[#0033AA] hover:underline mt-0.5 inline-block"
        >
          open in RxNav →
        </a>
      )}
    </Section>
  )
}

/**
 * DailyMed image gallery — fetches `/api/ndc/[ndc]/dailymed`. The hero image
 * fills the available width; clicking thumbnails swaps it in place. Heights
 * are flexible so the gallery grows when the user resizes the panel taller.
 */
function ImageSlot({ ndc }: { ndc: string }) {
  const [detail, setDetail] = useState<DailymedDetail | null | undefined>(
    () => dailymedCache.get(ndc),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (dailymedCache.has(ndc)) {
      setDetail(dailymedCache.get(ndc))
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/ndc/${encodeURIComponent(ndc)}/dailymed`)
      .then(async (r) => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as DailymedDetail
      })
      .then((d) => {
        dailymedCache.set(ndc, d)
        setDetail(d)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "DailyMed lookup failed")
        setDetail(null)
      })
      .finally(() => setLoading(false))
  }, [ndc])

  if (loading) {
    return (
      <div className="shrink-0 h-24 border border-[#C0C0C0] bg-[#F5F5F5] flex items-center justify-center text-[10px] text-[#808080] italic">
        Loading DailyMed…
      </div>
    )
  }
  if (error) {
    return (
      <div className="shrink-0 border border-[#CC0000] bg-red-50 text-[#CC0000] px-2 py-1 text-[10px]">
        DailyMed: {error}
      </div>
    )
  }
  if (!detail || detail.images.length === 0) {
    return (
      <div className="shrink-0 h-12 border border-dashed border-[#C0C0C0] bg-[#F5F5F5] flex items-center justify-center text-[10px] text-[#808080] italic px-2 text-center">
        {detail ? "DailyMed has no images for this NDC." : "Not in DailyMed."}
      </div>
    )
  }
  return <ImageGallery detail={detail} />
}

/**
 * Hero + thumbnail strip. Thumbnail click swaps the hero in place (no new
 * tab); a small ↗ link in the hero corner is the explicit "open full size"
 * affordance. Hero height is flexible so resizing the panel taller gives
 * the image more room.
 */
function ImageGallery({ detail }: { detail: DailymedDetail }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  useEffect(() => {
    setSelectedIdx(0)
  }, [detail.ndc])
  const max = useContext(MaximizeContext)

  const selected = detail.images[selectedIdx] ?? detail.images[0]
  const showThumbStrip = detail.images.length > 1

  // flex-1 + min-h-0 lets this gallery claim all the vertical space the
  // sibling sections (formulation, identifiers/package/cost) don't use.
  // Hero image inside scales with this container's height.
  return (
    <div className="flex flex-col gap-1 flex-1 min-h-0">
      <div className="relative border border-[#808080] bg-white flex items-center justify-center flex-1 min-h-[6rem]">
        <img
          src={selected.url}
          alt={detail.title ?? `DailyMed image for NDC ${detail.ndc}`}
          loading="lazy"
          className="max-w-full max-h-full object-contain"
        />
        {/* Maximize toggle — top-right corner. Expands the panel to nearly
            fill the viewport so the image gets the most real estate possible
            without leaving the app. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            max?.toggle()
          }}
          className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 bg-white/90 hover:bg-white border border-[#808080] text-[#0033AA] hover:text-[#000080] focus:outline-none focus:ring-1 focus:ring-[#0033AA]"
          title={max?.maximized ? "Restore panel size" : "Maximize panel"}
          aria-label={max?.maximized ? "Restore" : "Maximize"}
        >
          {max?.maximized ? "↙ restore" : "↗ maximize"}
        </button>
        {/* View enlargement — bottom-right corner, mirrors DailyMed's own
            "VIEW ENLARGEMENT +" affordance. Opens the raw NIH image in a
            new browser tab for the case where even the maximized panel
            isn't big enough (or the user wants to download / share). */}
        <a
          href={selected.url}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 bg-white/90 hover:bg-white border border-transparent hover:border-[#0033AA] text-[#0033AA] hover:text-[#000080] tracking-wide uppercase focus:outline-none focus:ring-1 focus:ring-[#0033AA]"
          onClick={(e) => e.stopPropagation()}
          title="Open the full-resolution image at NIH/NLM in a new tab"
        >
          View enlargement +
        </a>
      </div>

      {showThumbStrip && (
        <div className="shrink-0 flex gap-1 overflow-x-auto">
          {detail.images.map((img, i) => {
            const isSelected = i === selectedIdx
            return (
              <button
                key={`${img.name}-${i}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedIdx(i)
                }}
                className={`shrink-0 bg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0033AA] ${
                  isSelected
                    ? "border-2 border-[#316AC5] -m-px"
                    : "border border-[#C0C0C0] hover:border-[#808080]"
                }`}
                title={img.name}
                aria-label={`Show ${img.name}`}
                aria-pressed={isSelected}
              >
                <img
                  src={img.url}
                  alt={img.name}
                  loading="lazy"
                  className="h-12 w-12 object-contain"
                />
              </button>
            )
          })}
        </div>
      )}

      <div className="shrink-0 text-[9px] text-[#606060] truncate" title={selected.name}>
        {selected.name}
      </div>
      {detail.title && (
        <div className="shrink-0 text-[9px] text-[#606060] truncate" title={detail.title}>
          {detail.title}
        </div>
      )}
      <div className="shrink-0 text-[9px] text-[#808080] flex items-center justify-between">
        <span>
          DailyMed
          {detail.splCount > 1 ? ` · ${detail.splCount} labels` : ""}
          {detail.publishedDate ? ` · ${detail.publishedDate}` : ""}
        </span>
        {detail.setId && (
          <a
            href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${detail.setId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[#0033AA] hover:underline"
          >
            full label →
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Compact pill-identification line — imprint markings + color/shape/etc.
 * From Multum's `mltm_ndc_image` table joined with the shape/color/flavor/
 * additional-doseform lookups. The image filename is shown when present so
 * users know a Multum image *exists* even before the binary is wired in.
 *
 * Kept terse on purpose: this sits above the DailyMed gallery and
 * complements it for the ~70% of NDCs DailyMed doesn't cover.
 */
function ImprintSummary({ imprint }: { imprint: MultumImprint }) {
  const markings = [imprint.side1Marking, imprint.side2Marking]
    .filter(Boolean)
    .join(" / ")
  const traits = [
    imprint.color,
    imprint.shape,
    imprint.additionalDoseForm,
    imprint.flavor,
    imprint.scored ? "scored" : null,
  ].filter(Boolean) as string[]

  if (!markings && traits.length === 0 && !imprint.imageFilename) return null

  return (
    <div className="border border-[#C0C0C0] bg-[#FAFAFA] px-2 py-1 space-y-0.5">
      <div className="text-[9px] uppercase text-[#808080] tracking-wide leading-none">
        Pill ID (Multum)
      </div>
      {markings && (
        <div className="text-[11px] font-bold text-[#202020] tracking-wide">
          {markings}
        </div>
      )}
      {traits.length > 0 && (
        <div className="text-[10px] text-[#404040]">
          {traits.join(" · ")}
        </div>
      )}
      {imprint.imageFilename && (
        <div className="text-[9px] text-[#808080] italic truncate" title={imprint.imageFilename}>
          image: {imprint.imageFilename}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase text-[#808080] tracking-wide leading-none mb-0.5">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-2 leading-tight">
      <span className="text-[#808080] w-20 shrink-0">{label}:</span>
      <span
        className={`text-[#202020] flex-1 min-w-0 truncate ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </span>
    </div>
  )
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—"
  return `$${v.toFixed(2)}`
}
