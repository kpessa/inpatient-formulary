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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FormularyItem } from "@/lib/types"
import { FieldDiffTooltip } from "./FieldDiffTooltip"
import type { FieldValueMap, DomainRecord } from "@/lib/formulary-diff"

interface IdentifierRow {
  id: number
  type: string
  identifier: string
  active: boolean
  primary: boolean
  fieldKey: string
}

interface IdentifiersTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  domainRecords?: DomainRecord[]
}

function buildRows(item: FormularyItem | null): IdentifierRow[] {
  if (!item) return []
  const id = item.identifiers
  const rows: IdentifierRow[] = []
  let idx = 1
  const add = (type: string, identifier: string, primary: boolean, fieldKey: string) => {
    if (!identifier) return
    rows.push({ id: idx++, type, identifier, active: true, primary, fieldKey })
  }
  if (id.brandName) add("Brand Name", id.brandName, id.isBrandPrimary, "brandName")
  if (id.brandName2) add("Brand Name", id.brandName2, id.isBrand2Primary, "brandName2")
  if (id.brandName3) add("Brand Name", id.brandName3, id.isBrand3Primary, "brandName3")
  add("Charge Number", id.chargeNumber, true, "chargeNumber")
  add("Description", id.labelDescription, true, "labelDescription")
  add("Generic Name", id.genericName, true, "genericName")
  add("Pyxis Interface ID", id.pyxisId, true, "pyxisId")
  add("HCPCS", id.hcpcsCode, true, "hcpcsCode")
  add("Mnemonic", id.mnemonic, true, "mnemonic")
  return rows
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

function getIdentifierValue(item: FormularyItem, fieldKey: string): string {
  const id = item.identifiers
  switch (fieldKey) {
    case 'brandName':  return id.brandName ?? ''
    case 'brandName2': return id.brandName2 ?? ''
    case 'brandName3': return id.brandName3 ?? ''
    case 'chargeNumber': return id.chargeNumber ?? ''
    case 'labelDescription': return id.labelDescription ?? ''
    case 'genericName': return id.genericName ?? ''
    case 'pyxisId': return id.pyxisId ?? ''
    case 'hcpcsCode': return id.hcpcsCode ?? ''
    case 'mnemonic': return id.mnemonic ?? ''
    default: return ''
  }
}

export function IdentifiersTab({ item, highlightedFields, fieldValueMap, domainRecords }: IdentifiersTabProps) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [extraRows, setExtraRows] = useState<IdentifierRow[]>([])

  const baseRows = buildRows(item)
  const rows = [...baseRows, ...extraRows]

  const loadedDomains = domainRecords?.filter(dr => dr.item !== null) ?? []
  const hasDomainData = loadedDomains.length >= 2

  const toggleExpand = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-2 h-full">
      <div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-mono rounded-none border-[#808080] px-4"
          onClick={() => setShowNewDialog(true)}
        >
          New
        </Button>
      </div>

      <div className="border border-[#808080] overflow-auto flex-1">
        <Table className="text-xs font-mono border-collapse w-full">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              {hasDomainData && (
                <TableHead className="h-6 px-1 text-xs font-mono text-foreground border-r border-[#808080] w-6" />
              )}
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-44">Identifier Type</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080]">Identifier</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-16 text-center">Active</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground w-16 text-center">Primary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => {
              const isHighlighted = highlightedFields?.has(row.fieldKey)
              const isExpanded = expandedRows.has(row.id)
              const isSelected = selectedRow === row.id
              const canExpand = hasDomainData && isHighlighted

              // Per-domain values for expanded view
              const domainValues = hasDomainData
                ? loadedDomains.map(dr => ({
                    ...dr,
                    value: getIdentifierValue(dr.item!, row.fieldKey),
                  }))
                : []
              const baseVal = domainValues[0]?.value ?? ''

              return [
                <TableRow
                  key={row.id}
                  className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                    isSelected
                      ? 'bg-[#316AC5] text-white'
                      : isHighlighted
                      ? 'bg-[#FFF3CD] hover:bg-[#FFE99A]'
                      : idx % 2 === 0
                      ? 'bg-white hover:bg-[#C7D5E8]'
                      : 'bg-[#F0F0F0] hover:bg-[#C7D5E8]'
                  }`}
                  onClick={() => setSelectedRow(row.id)}
                >
                  {hasDomainData && (
                    <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                      {canExpand && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleExpand(row.id) }}
                          className={`w-4 h-4 text-[10px] font-bold leading-none flex items-center justify-center border rounded-none
                            ${isSelected
                              ? 'border-white text-white hover:bg-white/20'
                              : 'border-[#808080] bg-[#D4D0C8] text-[#316AC5] hover:bg-[#C0BBB0]'
                            }`}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">{row.type}</TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                    <FieldDiffTooltip values={fieldValueMap?.[row.fieldKey]} className="max-w-[300px] truncate">
                      {row.identifier}
                    </FieldDiffTooltip>
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox checked={row.active} className="rounded-none border-[#808080] h-3.5 w-3.5" onClick={e => e.stopPropagation()} />
                  </TableCell>
                  <TableCell className="h-5 px-2 py-0 text-center">
                    <Checkbox checked={row.primary} className="rounded-none border-[#808080] h-3.5 w-3.5" onClick={e => e.stopPropagation()} />
                  </TableCell>
                </TableRow>,

                // Expanded per-domain rows
                ...(isExpanded && canExpand ? domainValues.map((dv, di) => {
                  const segments = di === 0 ? null : charDiff(baseVal, dv.value)
                  return (
                    <TableRow key={`${row.id}-domain-${dv.domain}`} className="border-b border-[#E8E8E0]" style={{ borderLeft: `3px solid ${dv.bg}` }}>
                      {hasDomainData && <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]" />}
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 min-w-[18px] text-center inline-block" style={{ background: dv.bg, color: dv.text }}>
                          {dv.badge}
                        </span>
                      </TableCell>
                      <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] font-mono" colSpan={3}>
                        {dv.value
                          ? segments
                            ? segments.map((seg, j) =>
                                seg.diff
                                  ? <mark key={j} className="bg-amber-300 text-black not-italic">{seg.text}</mark>
                                  : <span key={j}>{seg.text}</span>
                              )
                            : dv.value
                          : <span className="text-[#808080] italic">—</span>
                        }
                      </TableCell>
                    </TableRow>
                  )
                }) : [])
              ]
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="text-xs font-mono max-w-sm rounded-none border-[#808080] p-0">
          <DialogHeader className="bg-[#C85A00] text-white px-3 py-1.5 rounded-none">
            <DialogTitle className="text-sm font-mono">New Identifier</DialogTitle>
          </DialogHeader>
          <div className="p-4 space-y-3">
            <div className="flex flex-col gap-0.5">
              <Label className="text-xs font-mono">Identifier Type:</Label>
              <Select>
                <SelectTrigger className="h-7 text-xs font-mono rounded-none border-[#808080] px-2">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent className="text-xs font-mono rounded-none">
                  <SelectItem value="brand">Brand Name</SelectItem>
                  <SelectItem value="charge">Charge Number</SelectItem>
                  <SelectItem value="description">Description</SelectItem>
                  <SelectItem value="generic">Generic Name</SelectItem>
                  <SelectItem value="pyxis">Pyxis Interface ID</SelectItem>
                  <SelectItem value="rxmisc">Rx Misc5</SelectItem>
                  <SelectItem value="rxunique">RX Unique ID</SelectItem>
                  <SelectItem value="short">Short Description</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-xs font-mono">Identifier:</Label>
              <Input className="h-7 text-xs font-mono rounded-none border-[#808080] px-2" />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" defaultChecked />
                <span className="text-xs font-mono">Active</span>
              </div>
              <div className="flex items-center gap-1">
                <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" />
                <span className="text-xs font-mono">Primary</span>
              </div>
            </div>
          </div>
          <DialogFooter className="px-4 pb-4 gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-4" onClick={() => setShowNewDialog(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs font-mono rounded-none bg-[#D4D0C8] text-foreground border border-[#808080] hover:bg-[#C0BBB0] px-4" onClick={() => setShowNewDialog(false)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
