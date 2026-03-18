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
import type { FormularyItem } from "@/lib/types"

interface SupplyTabProps {
  item: FormularyItem | null
}

export function SupplyTab({ item }: SupplyTabProps) {
  const [selectedNdc, setSelectedNdc] = useState<string | null>(null)
  const supplyData = item?.supplyRecords ?? []

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {/* Scrollable table */}
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
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox
                      checked={row.isPrimary}
                      className="rounded-none border-[#808080] h-3 w-3"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className={`h-5 px-1 py-0 border-r border-[#D4D0C8] font-mono ${isSelected ? "bg-white text-[#000080] border border-[#000080]" : ""}`}>
                    {row.ndc}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.isNonReference ? row.ndc : ""}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    <Checkbox
                      checked={row.isActive}
                      className="rounded-none border-[#808080] h-3 w-3"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">
                    {row.manufacturer}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">
                    {row.manufacturerLabelDescription}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]"></TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                    {row.isBiological && <Checkbox checked className="rounded-none border-[#808080] h-3 w-3" />}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.isBrand ? "B" : "G"}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.awpCost != null ? `$${row.awpCost.toFixed(4)}` : ""}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.cost1 != null ? String(row.cost1) : ""}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">
                    {row.cost2 != null ? String(row.cost2) : ""}
                  </TableCell>
                  <TableCell className="h-5 px-1 py-0">
                    <div className="flex items-center justify-center">
                      <div className="grid grid-cols-3 gap-px w-6 h-5 border border-[#808080] cursor-pointer hover:bg-[#C7D5E8]">
                        {[...Array(9)].map((_, i) => (
                          <div key={i} className="bg-[#808080] w-1 h-1" />
                        ))}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Bottom action buttons */}
      <div className="flex gap-2 p-2 bg-[#D4D0C8] border-t border-[#808080]">
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          Move Up
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          Move Down
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          Group
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          New
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          Properties
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
          Item Build
        </Button>
      </div>
    </div>
  )
}
