"use client"

import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { FormularyItem, SupplyRecord } from "@/lib/types"
import type { FieldValueMap, DomainRecord, DomainValue } from "@/lib/formulary-diff"

interface SupplyTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  domainRecords?: DomainRecord[]
  onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void
}

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

// Expandable multi-domain view — one row per NDC, expandable when diffs exist
function SupplyUnionView({ domainRecords, onCreateTask }: { domainRecords: DomainRecord[]; onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void }) {
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)
  const [expandedNdcs, setExpandedNdcs] = useState<Set<string>>(new Set())

  const loadedDomains = domainRecords.filter(dr => dr.item !== null)

  // Collect union of all NDCs across all domains
  const ndcMap = new Map<string, Map<string, SupplyRecord>>()
  for (const dr of loadedDomains) {
    for (const rec of dr.item!.supplyRecords) {
      if (!ndcMap.has(rec.ndc)) ndcMap.set(rec.ndc, new Map())
      ndcMap.get(rec.ndc)!.set(dr.domain, rec)
    }
  }

  // Sort: NDCs present in all domains first, then by NDC string
  const allNdcs = [...ndcMap.keys()].sort((a, b) => {
    const aAll = loadedDomains.every(dr => ndcMap.get(a)?.has(dr.domain))
    const bAll = loadedDomains.every(dr => ndcMap.get(b)?.has(dr.domain))
    if (aAll !== bAll) return aAll ? -1 : 1
    return a.localeCompare(b)
  })

  const getNdcDiff = (ndc: string) => {
    const domainData = ndcMap.get(ndc)!
    const presentIn = loadedDomains.filter(dr => domainData.has(dr.domain))
    if (loadedDomains.some(dr => !domainData.has(dr.domain))) return true
    if (presentIn.length > 1 && new Set(presentIn.map(dr => domainData.get(dr.domain)!.isActive)).size > 1) return true
    if (presentIn.length > 1 && new Set(presentIn.map(dr => domainData.get(dr.domain)!.manufacturerLabelDescription)).size > 1) return true
    return false
  }

  const toggleExpand = (ndc: string) => {
    setExpandedNdcs(prev => {
      const next = new Set(prev)
      next.has(ndc) ? next.delete(ndc) : next.add(ndc)
      return next
    })
  }

  const diffCount = allNdcs.filter(getNdcDiff).length

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      <div className="flex-1 overflow-auto border border-[#808080]">
        <Table className="text-xs font-mono border-collapse w-full min-w-max">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-6" />
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">Act</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8 text-center">1*</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-36">NDC</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080]">Manufacturer / Description</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-8">B/G</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground w-20">AWP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allNdcs.map((ndc, idx) => {
              const domainData = ndcMap.get(ndc)!
              const isDiff = getNdcDiff(ndc)
              const isExpanded = expandedNdcs.has(ndc)
              const isSelected = selectedNdc === ndc

              // Base record: first domain that has this NDC
              const baseEntry = loadedDomains.find(dr => domainData.has(dr.domain))!
              const baseRec = domainData.get(baseEntry.domain)!
              const baseDesc = baseRec.manufacturerLabelDescription || baseRec.manufacturer

              return [
                <TableRow
                  key={ndc}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? 'bg-[#316AC5] text-white'
                      : isDiff
                      ? 'bg-[#FFF3CD] hover:bg-[#FFE88A]'
                      : idx % 2 === 0
                      ? 'bg-white hover:bg-[#C7D5E8]'
                      : 'bg-[#F0F0F0] hover:bg-[#C7D5E8]'
                  }`}
                  onClick={() => setSelectedNdc(ndc === selectedNdc ? null : ndc)}
                >
                  <TableCell className="h-5 px-0.5 py-0 border-r border-[#D4D0C8] text-center">
                    {isDiff && (
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); toggleExpand(ndc) }}
                          className={`w-4 h-4 text-[10px] font-bold leading-none flex items-center justify-center border rounded-none
                            ${isSelected
                              ? 'border-white text-white hover:bg-white/20'
                              : 'border-[#808080] bg-[#D4D0C8] text-[#316AC5] hover:bg-[#C0BBB0]'
                            }`}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                        {onCreateTask && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const domainValues: DomainValue[] = loadedDomains.map(dr => {
                                const rec = domainData.get(dr.domain)
                                return {
                                  domain: dr.domain,
                                  badge: dr.badge,
                                  bg: dr.bg,
                                  text: dr.text,
                                  value: rec ? (rec.manufacturerLabelDescription || rec.manufacturer || '') : '',
                                }
                              })
                              onCreateTask(`supply.${ndc}`, `NDC ${ndc}`, domainValues)
                            }}
                            className="text-[8px] font-mono h-4 px-0.5 leading-none border rounded-none bg-[#1a4a9a] text-white hover:bg-[#0e3070] border-[#0e3070] whitespace-nowrap"
                            title={`Create task for NDC ${ndc}`}
                          >
                            ⚑
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={baseRec.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={baseRec.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono">{ndc}</TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] truncate max-w-[280px]">{baseDesc}</TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">{baseRec.isBrand ? 'B' : 'G'}</TableCell>
                  <TableCell className="h-5 px-2 py-0">{baseRec.awpCost != null ? `$${baseRec.awpCost.toFixed(4)}` : ''}</TableCell>
                </TableRow>,

                // Expanded per-domain rows
                ...(isExpanded ? loadedDomains.map(dr => {
                  const rec = domainData.get(dr.domain)
                  const desc = rec ? (rec.manufacturerLabelDescription || rec.manufacturer) : null
                  const segments = rec && desc !== baseDesc ? charDiff(baseDesc, desc!) : null
                  return (
                    <TableRow
                      key={`${ndc}-${dr.domain}`}
                      className="border-b border-[#E8E8E0] bg-[#FAFAF8]"
                      style={{ borderLeft: `3px solid ${dr.bg}` }}
                    >
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]" />
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                        {rec && <Checkbox checked={rec.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />}
                      </TableCell>
                      <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                        {rec && <Checkbox checked={rec.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />}
                      </TableCell>
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded-none leading-none" style={{ background: dr.bg, color: dr.text }}>
                          {dr.badge}
                        </span>
                      </TableCell>
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono" colSpan={3}>
                        {rec
                          ? segments
                            ? segments.map((seg, j) =>
                                seg.diff
                                  ? <mark key={j} className="bg-amber-300 text-black not-italic">{seg.text}</mark>
                                  : <span key={j}>{seg.text}</span>
                              )
                            : desc
                          : <span className="text-[#808080] italic text-[9px]">not present</span>
                        }
                      </TableCell>
                    </TableRow>
                  )
                }) : [])
              ]
            })}
            {allNdcs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-4 text-[#808080]">
                  No supply records
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 p-2 bg-[#D4D0C8] border-t border-[#808080] shrink-0">
        <span className="text-[10px] text-[#808080] self-center">
          {allNdcs.length} NDC{allNdcs.length !== 1 ? 's' : ''} total
          {diffCount > 0 && ` · ${diffCount} differ`}
        </span>
      </div>
    </div>
  )
}

export function SupplyTab({ item, highlightedFields, domainRecords, onCreateTask }: SupplyTabProps) {
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)

  // Use union view when 2+ domains have data
  const loadedDomains = domainRecords?.filter(dr => dr.item !== null) ?? []
  if (domainRecords && loadedDomains.length >= 2) {
    return <SupplyUnionView domainRecords={domainRecords} onCreateTask={onCreateTask} />
  }

  // Single-domain view (original)
  const supplyData = item?.supplyRecords ?? []
  const ndcSetHighlighted = highlightedFields?.has('ndcSet') ?? false

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {ndcSetHighlighted && (
        <div className="px-2 py-1 bg-[#FFF3CD] border-b border-amber-400 text-xs font-mono text-amber-800">
          ⚠ NDC set differs across domains
        </div>
      )}
      <div className="flex-1 overflow-auto border border-[#808080]">
        <Table className="text-xs font-mono border-collapse w-full min-w-max">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8"></TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">1*</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-32">Drug ID</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-24">Inner NDC</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-12">Active</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-44">Manufacturer</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-44">Description</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20">Package</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">BIO</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-8">B/G</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-20">AWP</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16">Cost1</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-16">Cost2</TableHead>
              <TableHead className="h-6 px-1 text-xs font-mono text-foreground w-16">Lot Info</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplyData.map((row, idx) => {
              const isSelected = selectedNdc === row.ndc
              return (
                <TableRow
                  key={`${row.ndc}-${idx}`}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? "bg-[#316AC5] text-white"
                      : idx % 2 === 0
                      ? "bg-white hover:bg-[#C7D5E8]"
                      : "bg-[#F0F0F0] hover:bg-[#C7D5E8]"
                  }`}
                  onClick={() => setSelectedNdc(row.ndc)}
                >
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">{idx + 1}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={row.isPrimary} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className={`h-5 px-1 py-0 border-r border-[#D4D0C8] font-mono ${isSelected ? "bg-white text-[#000080] border border-[#000080]" : ""}`}>
                    {row.ndc}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.isNonReference ? row.ndc : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={row.isActive} className="rounded-none border-[#808080] h-3 w-3" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.manufacturer}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.manufacturerLabelDescription}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]"></TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    {row.isBiological && <Checkbox checked className="rounded-none border-[#808080] h-3 w-3" />}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.isBrand ? "B" : "G"}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.awpCost != null ? `$${row.awpCost.toFixed(4)}` : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost1 != null ? String(row.cost1) : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost2 != null ? String(row.cost2) : ""}</TableCell>
                  <TableCell className="h-5 px-1 py-0">
                    <div className="flex items-center justify-center">
                      <div className="grid grid-cols-3 gap-px w-6 h-5 border border-[#808080] cursor-pointer hover:bg-[#C7D5E8]">
                        {[...Array(9)].map((_, i) => <div key={i} className="bg-[#808080] w-1 h-1" />)}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2 p-2 bg-[#D4D0C8] border-t border-[#808080]">
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Move Up</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Move Down</Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Group</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">New</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Properties</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">Item Build</Button>
      </div>
    </div>
  )
}
