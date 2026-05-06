"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { AdminWindowFrame } from "@/components/admin/AdminWindowFrame"
import type { NdcMoveAlertResponse } from "@/app/api/admin/ndc-move-alert/route"

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
  const [cdmInput, setCdmInput] = useState("")
  const [pastedTsv, setPastedTsv] = useState("")
  const [data, setData] = useState<NdcMoveAlertResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedQuery, setCopiedQuery] = useState(false)

  const cdmCodes = useMemo(
    () => cdmInput.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    [cdmInput],
  )

  async function analyze(includeTsv: boolean) {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/ndc-move-alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cdmCodes,
          pastedTsv: includeTsv ? pastedTsv : undefined,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
      setData(await r.json())
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

        <Section title="Step 1 · Enter CDM codes">
          <div className="text-[10px] text-[#606060] mb-1">
            One CDM per line, or comma/space separated. Numeric only.
          </div>
          <textarea
            value={cdmInput}
            onChange={e => setCdmInput(e.target.value)}
            rows={4}
            placeholder="54349287&#10;54337530&#10;54062112"
            className="border border-[#808080] bg-white px-1.5 py-1 font-mono text-xs w-full"
          />
          <div className="flex gap-2 mt-2 items-center">
            <button
              onClick={() => analyze(false)}
              disabled={loading || cdmCodes.length === 0}
              className="border border-[#808080] bg-[#316AC5] hover:bg-[#2456A5] text-white px-2 py-0.5 text-xs disabled:opacity-50"
            >
              {loading ? '…' : 'Generate query'}
            </button>
            <span className="text-[#606060]">{cdmCodes.length} CDM(s) entered</span>
          </div>
        </Section>

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
                    ? `${data.parsedScanRows} scan rows parsed`
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
                {c.flexedFacilities.length} facility{c.flexedFacilities.length !== 1 ? 'ies' : ''}
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
