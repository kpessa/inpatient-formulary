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

interface IdentifierRow {
  id: number
  type: string
  identifier: string
  active: boolean
  primary: boolean
}

interface IdentifiersTabProps {
  item: FormularyItem | null
}

function buildRows(item: FormularyItem | null): IdentifierRow[] {
  if (!item) return []
  const id = item.identifiers
  const rows: IdentifierRow[] = []
  let idx = 1

  const add = (type: string, identifier: string, primary: boolean) => {
    if (!identifier) return
    rows.push({ id: idx++, type, identifier, active: true, primary })
  }

  if (id.brandName) add("Brand Name", id.brandName, id.isBrandPrimary)
  if (id.brandName2) add("Brand Name", id.brandName2, id.isBrand2Primary)
  if (id.brandName3) add("Brand Name", id.brandName3, id.isBrand3Primary)
  add("Charge Number", id.chargeNumber, true)
  add("Description", id.labelDescription, true)
  add("Generic Name", id.genericName, true)
  add("Pyxis Interface ID", id.pyxisId, true)
  add("HCPCS", id.hcpcsCode, true)
  add("Mnemonic", id.mnemonic, true)

  return rows
}

export function IdentifiersTab({ item }: IdentifiersTabProps) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [extraRows, setExtraRows] = useState<IdentifierRow[]>([])

  const baseRows = buildRows(item)
  const rows = [...baseRows, ...extraRows]

  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-2 h-full">
      {/* New button */}
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

      {/* Identifiers table */}
      <div className="border border-[#808080] overflow-auto flex-1">
        <Table className="text-xs font-mono border-collapse w-full">
          <TableHeader className="sticky top-0 bg-[#D4D0C8] z-10">
            <TableRow className="border-b border-[#808080]">
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-44">Identifier Type</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080]">Identifier</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground border-r border-[#808080] w-16 text-center">Active</TableHead>
              <TableHead className="h-6 px-2 text-xs font-mono text-foreground w-16 text-center">Primary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow
                key={row.id}
                className={`border-b border-[#D4D0C8] cursor-pointer h-6 ${
                  selectedRow === row.id
                    ? "bg-[#316AC5] text-white"
                    : idx % 2 === 0
                    ? "bg-white hover:bg-[#C7D5E8]"
                    : "bg-[#F0F0F0] hover:bg-[#C7D5E8]"
                }`}
                onClick={() => setSelectedRow(row.id)}
              >
                <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8]">
                  {row.type}
                </TableCell>
                <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] max-w-[300px] truncate">
                  {row.identifier}
                </TableCell>
                <TableCell className="h-5 px-2 py-0 border-r border-[#D4D0C8] text-center">
                  <Checkbox
                    checked={row.active}
                    className="rounded-none border-[#808080] h-3.5 w-3.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="h-5 px-2 py-0 text-center">
                  <Checkbox
                    checked={row.primary}
                    className="rounded-none border-[#808080] h-3.5 w-3.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* New Identifier Dialog */}
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
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono rounded-none border-[#808080] px-4"
              onClick={() => setShowNewDialog(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs font-mono rounded-none bg-[#D4D0C8] text-foreground border border-[#808080] hover:bg-[#C0BBB0] px-4"
              onClick={() => setShowNewDialog(false)}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
