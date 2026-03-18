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

const identifierData = [
  { id: 1, type: "Brand Name", identifier: "Tylenol", active: true, primary: true },
  { id: 2, type: "Charge Number", identifier: "54000278", active: true, primary: true },
  { id: 3, type: "Description", identifier: "acetaminophen 500 mg Tab", active: true, primary: true },
  { id: 4, type: "Generic Name", identifier: "acetaminophen", active: true, primary: true },
  { id: 5, type: "Pyxis Interface ID", identifier: "10275", active: true, primary: true },
  { id: 6, type: "Rx Misc5", identifier: "087701417726", active: true, primary: true },
  { id: 7, type: "Rx Misc5", identifier: "087701979453", active: true, primary: false },
  { id: 8, type: "RX Unique ID", identifier: "acetaminophen 500 mg Tab - acetaminophen 500 mg Tab - Active", active: true, primary: true },
  { id: 9, type: "Short Description", identifier: "acet500Tab", active: true, primary: false },
  { id: 10, type: "Short Description", identifier: "acetaminophen 500 mg Tab", active: true, primary: true },
]

export function IdentifiersTab() {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [rows, setRows] = useState(identifierData)

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
                    defaultChecked={row.active}
                    className="rounded-none border-[#808080] h-3.5 w-3.5"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="h-5 px-2 py-0 text-center">
                  <Checkbox
                    defaultChecked={row.primary}
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
