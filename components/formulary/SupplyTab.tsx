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

const supplyData = [
  { id: 1, selected: true, preferred: true, drugId: "00904-6730-61", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "$0.0444", cost1: "", cost2: "" },
  { id: 2, selected: false, preferred: false, drugId: "57896-0204-01", innerNdc: "", active: true, manufacturer: "Geri-Care Pharmaceuticals", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0224", cost1: "", cost2: "" },
  { id: 3, selected: false, preferred: false, drugId: "57896-0201-10", innerNdc: "", active: true, manufacturer: "Geri-Care Pharmaceuticals", description: "acetaminophen 500 mg Tab", pkg: "1,000...", bio: false, bg: "G", awp: "$0.01758", cost1: "", cost2: "" },
  { id: 4, selected: false, preferred: false, drugId: "50580-0937-07", innerNdc: "", active: true, manufacturer: "JOHNSON AND JOHNSON", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "", cost1: "", cost2: "" },
  { id: 5, selected: false, preferred: false, drugId: "71399-8022-02", innerNdc: "", active: true, manufacturer: "AKRON PHARMA INC.", description: "acetaminophen 500 mg Tab", pkg: "1,000...", bio: false, bg: "G", awp: "$0.01775", cost1: "", cost2: "" },
  { id: 6, selected: false, preferred: false, drugId: "00904-6720-51", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "50 Ea...", bio: false, bg: "G", awp: "$0.0362", cost1: "", cost2: "" },
  { id: 7, selected: false, preferred: false, drugId: "57896-0222-01", innerNdc: "", active: true, manufacturer: "Geri-Care Pharmaceuticals", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0103", cost1: "", cost2: "" },
  { id: 8, selected: false, preferred: false, drugId: "71399-8022-01", innerNdc: "", active: true, manufacturer: "AKRON PHARMA INC.", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "", cost1: "", cost2: "" },
  { id: 9, selected: false, preferred: false, drugId: "50580-0457-10", innerNdc: "", active: true, manufacturer: "Johnson and Johnson/McN...", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "$0.13834", cost1: "", cost2: "" },
  { id: 10, selected: false, preferred: false, drugId: "50580-0457-70", innerNdc: "", active: true, manufacturer: "Johnson and Johnson/McN...", description: "acetaminophen 500 mg Tab", pkg: "700 E...", bio: false, bg: "B", awp: "$0.05667", cost1: "", cost2: "" },
  { id: 11, selected: false, preferred: false, drugId: "71399-8027-02", innerNdc: "", active: true, manufacturer: "AKRON PHARMA INC.", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "", cost1: "", cost2: "" },
  { id: 12, selected: false, preferred: false, drugId: "00904-6720-80", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "1,000...", bio: false, bg: "G", awp: "$0.01994", cost1: "", cost2: "" },
  { id: 13, selected: false, preferred: false, drugId: "00904-1988-60", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0803", cost1: "", cost2: "" },
  { id: 14, selected: false, preferred: false, drugId: "57896-0221-10", innerNdc: "", active: true, manufacturer: "Geri-Care Pharmaceuticals", description: "acetaminophen 500 mg Tab", pkg: "1,000...", bio: false, bg: "G", awp: "$0.0071", cost1: "", cost2: "" },
  { id: 15, selected: false, preferred: false, drugId: "00904-6730-60", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0234", cost1: "", cost2: "" },
  { id: 16, selected: false, preferred: false, drugId: "00904-6720-40", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "500 E...", bio: false, bg: "G", awp: "$0.01082", cost1: "", cost2: "" },
  { id: 17, selected: false, preferred: false, drugId: "50580-0457-11", innerNdc: "", active: true, manufacturer: "Johnson and Johnson/McN...", description: "acetaminophen 500 mg Tab", pkg: "10 Ea...", bio: false, bg: "B", awp: "$0.7291", cost1: "", cost2: "" },
  { id: 18, selected: false, preferred: false, drugId: "69618-0011-01", innerNdc: "", active: true, manufacturer: "Reliable 1 Laboratories, LLC", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0178", cost1: "", cost2: "" },
  { id: 19, selected: false, preferred: false, drugId: "00904-6720-59", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "G", awp: "$0.0158", cost1: "", cost2: "" },
  { id: 20, selected: false, preferred: false, drugId: "00904-6730-80", innerNdc: "", active: true, manufacturer: "Major Pharmaceuticals Inc", description: "acetaminophen 500 mg Tab", pkg: "1,000...", bio: false, bg: "G", awp: "$0.01775", cost1: "", cost2: "" },
  { id: 21, selected: false, preferred: false, drugId: "50580-0449-09", innerNdc: "", active: true, manufacturer: "Johnson and Johnson/McN...", description: "acetaminophen 500 mg Tab", pkg: "100 E...", bio: false, bg: "B", awp: "$0.0996", cost1: "", cost2: "" },
]

export function SupplyTab() {
  const [selectedRow, setSelectedRow] = useState<number>(1)

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
            {supplyData.map((row, idx) => (
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
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                  {row.id}
                </TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                  <Checkbox
                    defaultChecked={row.preferred}
                    className="rounded-none border-[#808080] h-3 w-3"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className={`h-5 px-1 py-0 border-r border-[#D4D0C8] font-mono ${selectedRow === row.id ? "bg-white text-[#000080] border border-[#000080]" : ""}`}>
                  {row.drugId}
                </TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]"></TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                  <Checkbox
                    defaultChecked={row.active}
                    className="rounded-none border-[#808080] h-3 w-3"
                    onClick={(e) => e.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.manufacturer}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] truncate max-w-[176px]">{row.description}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.pkg}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8] text-center">
                  {row.bio && <Checkbox defaultChecked className="rounded-none border-[#808080] h-3 w-3" />}
                </TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.bg}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.awp}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost1}</TableCell>
                <TableCell className="h-5 px-1 py-0 border-r border-[#D4D0C8]">{row.cost2}</TableCell>
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
            ))}
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
