"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import type { NdcMoveAlertResponse } from "@/app/api/admin/ndc-move-alert/route"
import { setAdminScanCache } from "@/lib/admin-scan-cache"

/**
 * NDC-move-alert workflow — `/admin/ndc-move-alert`.
 *
 * Three steps the page walks the user through:
 *
 *   1. Paste CDM codes (one per line). Click "Generate query".
 *   2. Copy the parameterized CCL query into Discern Explorer, run it
 *      against P152E / P152C / P152W, concatenate results in Excel,
 *      paste back into the textarea.
 *   3. Click "Analyze". The page bucketizes facilities into:
 *        • Tier 1 — scanned in last 30 days (URGENT, with mailto links)
 *        • Tier 2 — flexed but no recent scans (heads-up tier)
 *        • Unresolved — facility names the alias map didn't recognize
 */
export default function NdcMoveAlertPage() {
  const [rawInput, setRawInput] = useState("")
  const [pastedTsv, setPastedTsv] = useState("")
  const [data, setData] = useState<NdcMoveAlertResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedQuery, setCopiedQuery] = useState(false)

  const inputs = useMemo(
    () => rawInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    [rawInput],
  )

  // Pre-fill from `?inputs=ndc1,ndc2,…` URL param. Used by the Supply tab's
  // MMDC mismatch banner ("Alert facilities →") to hand off a per-MMDC NDC
  // group, so the user lands here with the input already populated and just
  // has to click "Generate query".
  useEffect(() => {
    if (typeof window === 'undefined') return
    const fromUrl = new URLSearchParams(window.location.search).get('inputs')
    if (fromUrl) {
      setRawInput(fromUrl.split(/[\s,]+/).filter(Boolean).join('\n'))
    }
  }, [])

  async function analyze(includeTsv: boolean) {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/ndc-move-alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputs,
          pastedTsv: includeTsv ? pastedTsv : undefined,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      const json = await r.json() as NdcMoveAlertResponse
      setData(json)
      // Persist barcode totals to the shared admin-scan cache so the Supply
      // tab and other views can overlay usage data on their NDC lists.
      // Skip when no TSV was pasted (the no-data response carries an empty
      // map and would clobber a previously loaded cache).
      if (includeTsv && Object.keys(json.barcodeTotals ?? {}).length > 0) {
        const totalScans = Object.values(json.barcodeTotals).reduce((a, b) => a + b, 0)
        setAdminScanCache({
          loadedAt: new Date().toISOString(),
          lookbackDays: 30,
          totalScans,
          uniqueBarcodes: Object.keys(json.barcodeTotals).length,
          barcodeTotals: json.barcodeTotals,
          facilityScansByBarcode: json.facilityScansByBarcode ?? {},
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AdminWindowFrame icon="📨" title="NDC Move Alert" subtitle="(architect)">
      <div className="p-3 space-y-3 font-mono text-xs">
        <Intro />

        {error && (
          <div className="border border-red-600 bg-red-50 text-red-900 px-2 py-1.5">
            {error}
          </div>
        )}

        <Section title="Step 1 · Enter NDCs and/or CDMs">
          <div className="text-[10px] text-[#606060] mb-1">
            One per line, or comma/space separated. NDCs in 5-4-2 hyphenated form
            (<code>45802-0060-70</code>) — scans will be filtered to only that
            specific NDC. CDMs are numeric (<code>54116157</code>) — all scans
            under the CDM are counted.
          </div>
          <textarea
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            rows={4}
            placeholder="45802-0060-70&#10;54116157"
            className="border border-[#808080] bg-white px-1.5 py-1 font-mono text-xs w-full"
          />
          <div className="flex gap-2 mt-2 items-center">
            <button
              onClick={() => analyze(false)}
              disabled={loading || inputs.length === 0}
              className="border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white px-2 py-0.5 text-xs disabled:opacity-50"
            >
              {loading ? '…' : 'Generate query'}
            </button>
            <span className="text-[#606060]">{inputs.length} input(s)</span>
          </div>
        </Section>

        {data && data.resolvedInputs.length > 0 && (
          <Section title={`Resolved inputs · queries ${data.queriedCdms.length} CDM${data.queriedCdms.length !== 1 ? 's' : ''}`}>
            <table className="w-full border-collapse text-xs">
              <thead className="bg-[#E8E8E8]">
                <tr>
                  <th className="px-2 py-0.5 text-left w-32">Input</th>
                  <th className="px-2 py-0.5 text-left w-16">Type</th>
                  <th className="px-2 py-0.5 text-left">Resolved CDM(s)</th>
                  <th className="px-2 py-0.5 text-left">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.resolvedInputs.map(r => (
                  <tr key={r.raw} className={`border-t border-[#E8E8E8] ${r.type === 'invalid' ? 'bg-red-50' : ''}`}>
                    <td className="px-2 py-0.5 font-bold">{r.raw}</td>
                    <td className="px-2 py-0.5 text-[10px]" style={{
                      color: r.type === 'ndc' ? '#0F8C5C' : r.type === 'cdm' ? '#316AC5' : '#CC0000',
                    }}>
                      {r.type === 'ndc' ? 'NDC' : r.type === 'cdm' ? 'CDM' : 'invalid'}
                    </td>
                    <td className="px-2 py-0.5 font-mono">
                      {r.cdmCodes.length === 0
                        ? <span className="text-red-700 italic">— could not resolve to a CDM</span>
                        : r.cdmCodes.join(', ')}
                    </td>
                    <td className="px-2 py-0.5">{r.description ?? <span className="text-[#A0A0A0]">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.ndcFilterActive && (
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-[#0F8C5C]">
                  ✓ NDC filter active — barcode must match the input NDC or any
                  sibling NDC under the same product (supply_records flex group +
                  Multum MMDC).
                </div>
                {data.resolvedInputs
                  .filter(r => r.type === 'ndc' && (r.siblingNdcs?.length ?? 0) > 0)
                  .map(r => (
                    <SiblingsBlock key={r.raw} resolved={r} />
                  ))}
              </div>
            )}
          </Section>
        )}

        {data && (
          <>
            <Section
              title="Step 2 · Run this CCL query in Discern Explorer (one run per prod domain)"
              action={
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(data.cclQuery)
                    setCopiedQuery(true)
                    setTimeout(() => setCopiedQuery(false), 1500)
                  }}
                  className="border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-2 py-0.5 text-[11px]"
                >
                  {copiedQuery ? '✓ Copied' : 'Copy query'}
                </button>
              }
            >
              <pre className="border border-[#C0C0C0] bg-[#FAFAF8] px-2 py-1.5 text-[11px] overflow-x-auto whitespace-pre-wrap">
                {data.cclQuery}
              </pre>
              <div className="text-[10px] text-[#606060] mt-1">
                Run against P152E (East), P152C (Central), and P152W (West).
                Concatenate the three result sets in Excel under one header
                row, then paste below. <code>curdomain</code> self-tags each row.
              </div>
            </Section>

            <Section title="Step 3 · Paste TSV result">
              <textarea
                value={pastedTsv}
                onChange={e => setPastedTsv(e.target.value)}
                rows={6}
                placeholder="DOMAIN&#9;BARCODE&#9;FACILITY&#9;SCAN_COUNT&#10;P152E&#9;…"
                className="border border-[#808080] bg-white px-1.5 py-1 font-mono text-[11px] w-full"
              />
              <div className="flex gap-2 mt-2 items-center">
                <button
                  onClick={() => analyze(true)}
                  disabled={loading || !pastedTsv.trim()}
                  className="border border-[#808080] bg-[#0F8C5C] hover:bg-[#0A6E48] text-white px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  {loading ? '…' : 'Analyze'}
                </button>
                <span className="text-[#606060]">
                  {data.parsedScanRows > 0
                    ? data.ndcFilterActive
                      ? `${data.matchedScanRows} of ${data.parsedScanRows} rows matched the input NDC(s)`
                      : `${data.parsedScanRows} scan rows parsed`
                    : 'No analysis yet'}
                </span>
              </div>
            </Section>

            {data.parsedScanRows > 0 && (
              <Results data={data} />
            )}

            {data.parsedScanRows === 0 && data.cdmContext.length > 0 && (
              <CdmContextPanel cdmContext={data.cdmContext} />
            )}
          </>
        )}
      </div>
    </AdminWindowFrame>
  )
}

/** Collapsible list of sibling NDCs that count as the same product when
 *  filtering scan rows. Sibling source legend:
 *    site = flexed under the same supply_records group_id
 *    multum = same Multum MMDC (clinically equivalent)
 *    both = both views agree */
function SiblingsBlock({
  resolved,
}: { resolved: NdcMoveAlertResponse['resolvedInputs'][number] }) {
  const [expanded, setExpanded] = useState(false)
  const sibs = resolved.siblingNdcs ?? []
  const siteCount = sibs.filter(s => s.source !== 'multum').length
  const multumOnly = sibs.filter(s => s.source === 'multum').length
  return (
    <details
      className="text-[10px]"
      open={expanded}
      onToggle={e => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-[#404040] py-0.5">
        {sibs.length} sibling NDC{sibs.length !== 1 ? 's' : ''} for {resolved.raw}{' '}
        ({siteCount} site-flexed, {multumOnly} Multum-only)
      </summary>
      <div className="mt-1 px-2 py-1 border border-[#C0C0C0] bg-[#FAFAF8]">
        <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 font-mono">
          {sibs.map(s => (
            <div key={s.ndc} className="flex items-center gap-1">
              <span>{s.ndc}</span>
              <span
                className="px-1 text-[9px]"
                style={{
                  background: s.source === 'both' ? '#0F8C5C'
                    : s.source === 'supply' ? '#316AC5'
                    : '#A66B00',
                  color: 'white',
                }}
                title={
                  s.source === 'both' ? 'Flexed at site AND in Multum MMDC'
                    : s.source === 'supply' ? 'Flexed under same supply_records group'
                    : 'Same Multum MMDC; not formally flexed at site'
                }
              >
                {s.source === 'both' ? 'site+M' : s.source === 'supply' ? 'site' : 'multum'}
              </span>
              {s.isNonReference && (
                <span className="text-[9px] text-[#A66B00]" title="Non-reference (often inner / repackaged)">
                  ⓘ
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}

function Intro() {
  return (
    <div className="border border-[#C0C0C0] bg-[#FFFAE5] px-2 py-1.5 text-[11px]">
      <div className="font-bold mb-0.5">When to use this</div>
      <div className="text-[#404040] leading-relaxed">
        Before moving an NDC from one Pyxis ID to another, find which
        facilities have it in active use. Generates the parameterized CCL
        query, parses the pasted scan results, and produces a tiered alert
        list with pharmacy contacts per facility. Tier 1 = scanned recently
        (urgent). Tier 2 = flexed but no recent scans (heads-up).
      </div>
    </div>
  )
}

function Section({
  title, action, children,
}: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-[#C0C0C0] bg-white">
      <div className="flex items-center px-2 py-1 bg-[#E8E8E8] border-b border-[#C0C0C0]">
        <div className="text-[11px] uppercase font-bold tracking-wide text-[#404040]">
          {title}
        </div>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-2">{children}</div>
    </div>
  )
}

function CdmContextPanel({ cdmContext }: { cdmContext: NdcMoveAlertResponse['cdmContext'] }) {
  return (
    <Section title={`Resolved CDMs (${cdmContext.length})`}>
      <div className="text-[10px] text-[#606060] mb-1">
        Per-CDM context loaded from the formulary extract. Flexed-facility
        list shows facilities that currently have this CDM in their
        inventory across any prod domain.
      </div>
      <table className="w-full border-collapse text-xs">
        <thead className="bg-[#E8E8E8]">
          <tr>
            <th className="px-2 py-0.5 text-left w-24">CDM</th>
            <th className="px-2 py-0.5 text-left">Description</th>
            <th className="px-2 py-0.5 text-left w-24">Flexed at</th>
          </tr>
        </thead>
        <tbody>
          {cdmContext.map(c => (
            <tr key={c.cdmCode} className="border-t border-[#E8E8E8]">
              <td className="px-2 py-0.5 font-mono">{c.cdmCode}</td>
              <td className="px-2 py-0.5">{c.description ?? <span className="text-[#A0A0A0]">(not in extract)</span>}</td>
              <td className="px-2 py-0.5 text-[#606060]">
                {c.flexedFacilities.length} {c.flexedFacilities.length === 1 ? 'facility' : 'facilities'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function Results({ data }: { data: NdcMoveAlertResponse }) {
  return (
    <>
      <CdmContextPanel cdmContext={data.cdmContext} />

      <Section
        title={`Tier 1 — Urgent: scanned in last 30 days (${data.tier1.length})`}
        action={
          data.tier1.length > 0 ? (
            <CopyAllEmails facilities={data.tier1} label="Copy all tier-1 emails" />
          ) : null
        }
      >
        {data.tier1.length === 0 && (
          <div className="text-[#606060] italic">No facilities scanned this product recently.</div>
        )}
        <div className="space-y-2">
          {data.tier1.map(f => (
            <FacilityCard key={f.mnemonic} facility={f} tier={1} />
          ))}
        </div>
      </Section>

      <Section
        title={`Tier 2 — Heads-up: flexed but no recent scans (${data.tier2.length})`}
        action={
          data.tier2.length > 0 ? (
            <CopyAllEmails facilities={data.tier2} label="Copy all tier-2 emails" />
          ) : null
        }
      >
        {data.tier2.length === 0 && (
          <div className="text-[#606060] italic">No additional flexed-but-unscanned facilities.</div>
        )}
        <div className="space-y-2">
          {data.tier2.map(f => (
            <FacilityCard key={f.mnemonic} facility={f} tier={2} />
          ))}
        </div>
      </Section>

      {data.unmatchedBarcodes.length > 0 && (
        <Section title={`Unmatched barcodes (${data.unmatchedBarcodes.length}) — under parent CDM but ≠ input NDC`}>
          <div className="text-[10px] text-[#606060] mb-1">
            These barcodes were scanned at facilities under one of the queried
            CDMs but didn't decode to any input NDC — different package size,
            different manufacturer, or repackaged. Useful for verifying the
            filter math: if a barcode here looks like the NDC you actually
            care about, the input NDC may be off by one digit.
          </div>
          <table className="w-full border-collapse text-xs">
            <thead className="bg-[#E8E8E8]">
              <tr>
                <th className="px-2 py-0.5 text-left w-36">Barcode</th>
                <th className="px-2 py-0.5 text-left w-20">Domain</th>
                <th className="px-2 py-0.5 text-right w-20">Scans</th>
              </tr>
            </thead>
            <tbody>
              {data.unmatchedBarcodes.map((u, idx) => (
                <tr key={`${u.barcode}-${u.domain}-${idx}`} className="border-t border-[#E8E8E8]">
                  <td className="px-2 py-0.5 font-mono">{u.barcode}</td>
                  <td className="px-2 py-0.5 font-mono text-[#606060]">{u.domain}</td>
                  <td className="px-2 py-0.5 text-right">{u.scanCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {data.unresolvedFacilities.length > 0 && (
        <Section title={`Unresolved (${data.unresolvedFacilities.length})`}>
          <div className="text-[10px] text-[#606060] mb-1">
            These facility strings from the CCL output didn't match any
            mnemonic in the alias table. Add manual aliases on the{' '}
            <Link href="/admin/facilities" className="text-[#0000FF] hover:underline">
              Facility Admin
            </Link>{' '}
            page so they resolve next time.
          </div>
          <table className="w-full border-collapse text-xs">
            <thead className="bg-[#E8E8E8]">
              <tr>
                <th className="px-2 py-0.5 text-left">Facility (from CCL)</th>
                <th className="px-2 py-0.5 text-left w-20">Domain</th>
                <th className="px-2 py-0.5 text-right w-20">Scans</th>
              </tr>
            </thead>
            <tbody>
              {data.unresolvedFacilities.map((u, idx) => (
                <tr key={`${u.facility}-${idx}`} className="border-t border-[#E8E8E8]">
                  <td className="px-2 py-0.5">{u.facility}</td>
                  <td className="px-2 py-0.5 font-mono text-[#606060]">{u.domain}</td>
                  <td className="px-2 py-0.5 text-right">{u.scanCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  )
}

function FacilityCard({
  facility, tier,
}: { facility: NdcMoveAlertResponse['tier1'][number]; tier: 1 | 2 }) {
  const tierColor = tier === 1 ? '#CC0000' : '#A66B00'
  const emails = facility.contacts.map(c => c.email).filter(Boolean) as string[]
  return (
    <div
      className="border bg-white"
      style={{ borderColor: tier === 1 ? '#CC0000' : '#A66B00' }}
    >
      <div className="flex items-baseline px-2 py-1 border-b border-[#E0E0E0] gap-2">
        <span className="font-bold text-sm" style={{ color: tierColor }}>
          {facility.mnemonic}
        </span>
        <span>{facility.longName}</span>
        <span className="text-[10px] text-[#808080]">
          {facility.region}{facility.region ? ' · ' : ''}
          {tier === 1 ? `${facility.scanCount} scan${facility.scanCount !== 1 ? 's' : ''}` : 'flexed only'}
        </span>
        {emails.length > 0 && (
          <a
            href={`mailto:${emails.join(',')}?subject=${encodeURIComponent(`NDC move at ${facility.mnemonic}`)}`}
            className="ml-auto text-[10px] border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white px-1.5 py-0.5"
            title="Open mail client with all this facility's emails"
          >
            ✉ Email all ({emails.length})
          </a>
        )}
      </div>
      {facility.contacts.length === 0 ? (
        <div className="px-2 py-1 text-[#A06000] italic">
          No reachable contacts on file.{' '}
          <Link
            href={`/admin/facilities/${facility.mnemonic}`}
            className="text-[#0000FF] hover:underline"
          >
            Add some →
          </Link>
        </div>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <tbody>
            {facility.contacts.map((c, i) => (
              <tr key={i} className="border-t border-[#F0F0F0]">
                <td className="px-2 py-0.5 w-44 text-[#606060]">{prettyRole(c.role)}</td>
                <td className="px-2 py-0.5">{c.name || <span className="text-[#A0A0A0]">—</span>}</td>
                <td className="px-2 py-0.5">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="text-[#0000FF] hover:underline">{c.email}</a>
                  ) : <span className="text-[#A0A0A0]">—</span>}
                </td>
                <td className="px-2 py-0.5 w-32 font-mono text-[10px]">{c.phone ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CopyAllEmails({
  facilities, label,
}: { facilities: NdcMoveAlertResponse['tier1']; label: string }) {
  const [copied, setCopied] = useState(false)
  const allEmails = useMemo(
    () => [
      ...new Set(
        facilities.flatMap(f => f.contacts.map(c => c.email).filter(Boolean) as string[]),
      ),
    ],
    [facilities],
  )
  return (
    <div className="flex gap-1">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(allEmails.join(', '))
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        disabled={allEmails.length === 0}
        className="text-[11px] border border-[#808080] bg-[#D4D0C8] hover:bg-[#E0DBD0] text-black px-2 py-0.5 disabled:opacity-50"
      >
        {copied ? `✓ ${allEmails.length} copied` : `${label} (${allEmails.length})`}
      </button>
    </div>
  )
}

function prettyRole(role: string): string {
  switch (role) {
    case 'pharmacy_director': return 'Pharmacy Director'
    case 'operations_manager': return 'Ops Manager'
    case 'clinical_manager': return 'Clinical Manager'
    case 'ip_pharmacist': return 'IP Pharmacist'
    case 'is_director': return 'IS Director'
    case 'main_pharmacy_phone': return 'Main Pharmacy'
    default: return role
  }
}
