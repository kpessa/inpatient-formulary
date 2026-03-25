"use client"

import React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import type { FormularyItem, LintResultMap } from "@/lib/types"
import { FieldDiffTooltip } from "./FieldDiffTooltip"
import type { FieldValueMap } from "@/lib/formulary-diff"

const nonFloorstock = [
  "CHR MedKeeper", "GWU MedKeeper", "LWR MedKeeper", "MMH MedKeeper",
  "WRM MedKeeper", "xABM Main Pharmacy", "xAIK BH Pharmacy",
  "xAIK Main Pharmacy", "xAIK OR Pharmacy", "xANC Main Pharmacy",
  "xBGH Main Pharmacy", "xCHR Main Pharmacy", "xFAI Main Pharmacy",
  "xFLH Main Pharmacy", "xGWU Main Pharmacy", "xHAM Main Pharmacy",
  "xLWR Main Pharmacy", "xMMH Main Pharmacy", "xMMH OR Pharmacy",
  "xPEC Main Pharmacy", "xPIW Main Pharmacy", "xSRB Main Pharmacy",
  "xWHC Main Pharmacy", "xWRM Main Pharmacy",
]

const floorstockLocations = [
  "FAI A2", "FAI A3", "FAI A4", "Hampton ECT",
  "SRB Adol/Adult Flex Psych (Acute)", "SRB Adult East",
  "SRB Adult South", "SRB Pre", "SRB Progressive Care Unit",
  "SRB Specialty Care Unit", "xAIK 2LC Pyxis", "xAIK 2M Pyxis",
  "xAIK 3E Pyxis", "xAIK 3S Pyxis", "xAIK 4 Pyxis",
  "xAIK 5M Pyxis", "xAIK 5S Pyxis", "xAIK CATHREC Pyxis",
  "xAIK ED Pyxis", "xAIK ICUE Pyxis", "xAIK ICUW Pyxis",
  "xAIK LDR Pyxis", "xAIK OPS Pyxis", "xAIK PCU Pyxis",
  "xAIK PEDS Pyxis", "xAIK TRIAGE Pyxis", "xAIKB IOWA Pyxis",
  "xAIKS SWT-MED Pyxis", "xCHR 3MED SURG Pyxis", "xCHR 3NO Pyxis",
]

interface InventoryTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  lintViolations?: LintResultMap
}

export function InventoryTab({ item, highlightedFields, fieldValueMap, lintViolations }: InventoryTabProps) {
  const inv = item?.inventory
  const facilities = inv
    ? Object.entries(inv.facilities).filter(([, v]) => v).map(([k]) => k)
    : []

  const dispenseFrom = inv?.dispenseFrom ?? ""
  const hl = (key: string): React.CSSProperties => highlightedFields?.has(key) ? { background: '#FFF3CD', borderRadius: '2px' } : {}
  const lv = (key: string): React.CSSProperties => lintViolations?.has(key) ? { background: '#FFF0E0', outline: '1px solid #F97316', borderRadius: '2px' } : {}
  const hlv = (key: string): React.CSSProperties => ({ ...hl(key), ...lv(key) })

  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-3 h-full">
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr_180px] gap-3">
        <FieldDiffTooltip values={fieldValueMap?.['facilities']} style={hlv('facilities')}>
          <div className="text-xs font-mono pr-2">
            <span className="text-[#CC0000]">*</span> Orderable in the following<br />facilities:
          </div>
        </FieldDiffTooltip>
        <div className="text-xs font-mono pr-2">
          Stocked in the following non-<br />floorstock locations:
        </div>
        <div className="text-xs font-mono pr-2">
          Stocked in the following<br />floorstock locations:
        </div>
        <div></div>
      </div>

      {/* Four-column layout with lists and buttons */}
      <div className="grid grid-cols-[1fr_1fr_1fr_180px] gap-3 flex-1 min-h-0 mt-1">
        {/* Column 1: Facilities */}
        <FieldDiffTooltip values={fieldValueMap?.['facilities']} style={hlv('facilities')} className="flex flex-col gap-2 min-h-0">
          <div className="border border-[#808080] bg-white overflow-y-auto flex-1">
            {facilities.map((f) => (
              <div
                key={f}
                className="px-1 py-px text-xs font-mono cursor-pointer hover:bg-[#C7D5E8] leading-4"
              >
                {f}
              </div>
            ))}
          </div>
          <div className="flex gap-2 shrink-0 mt-2">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-2 flex-1 relative -mb-1">
              Update Facilities
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-2 flex-1 relative -mb-1">
              Flex by Fac.
            </Button>
          </div>
        </FieldDiffTooltip>

        {/* Column 2: Non-floorstock */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="border border-[#808080] bg-white overflow-y-auto flex-1">
            {nonFloorstock.map((loc) => (
              <div
                key={loc}
                className="px-1 py-px text-xs font-mono cursor-pointer hover:bg-[#C7D5E8] leading-4"
              >
                {loc}
              </div>
            ))}
          </div>
          <div className="flex gap-2 shrink-0 mt-2">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-2 flex-1 relative -mb-1">
              Update Pharmacies
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-2 flex-1 relative -mb-1">
              Flex NDC
            </Button>
          </div>
        </div>

        {/* Column 3: Floorstock */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="border border-[#808080] bg-white overflow-y-auto flex-1">
            {floorstockLocations.map((loc) => (
              <div
                key={loc}
                className="px-1 py-px text-xs font-mono cursor-pointer hover:bg-[#C7D5E8] leading-4"
              >
                {loc}
              </div>
            ))}
          </div>
          <div className="shrink-0 mt-2">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3 w-full relative -mb-1">
              Update Floorstock
            </Button>
          </div>
        </div>

        {/* Column 4: Dispense from + checkboxes */}
        <div className="flex flex-col gap-2 min-h-0">
          <FieldDiffTooltip values={fieldValueMap?.['dispenseFrom']} style={hlv('dispenseFrom')}>
            <fieldset className="border border-[#808080] rounded-md p-1.5 pt-0.5 text-xs font-mono">
              <legend className="text-xs font-mono px-1 ml-1 text-black font-semibold">Dispense from</legend>
              <div className="space-y-1 mt-1">
                <div className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="dispense"
                    checked={dispenseFrom === "Check location list" || dispenseFrom === ""}
                    readOnly
                    className="w-3 h-3"
                  />
                  <span className="text-xs font-mono">Check location list</span>
                </div>
                <div className="flex items-start gap-1">
                  <input
                    type="radio"
                    name="dispense"
                    checked={dispenseFrom === "Always non-floorstock"}
                    readOnly
                    className="w-3 h-3 mt-0.5 shrink-0"
                  />
                  <span className="text-xs font-mono leading-tight">Always dispense from non-floorstock location</span>
                </div>
                <div className="flex items-start gap-1">
                  <input
                    type="radio"
                    name="dispense"
                    checked={dispenseFrom === "Always floorstock"}
                    readOnly
                    className="w-3 h-3 mt-0.5 shrink-0"
                  />
                  <span className="text-xs font-mono leading-tight">Always dispense from floorstock</span>
                </div>
              </div>
            </fieldset>
          </FieldDiffTooltip>
          <div className="space-y-1 overflow-y-auto pr-1">
            <FieldDiffTooltip values={fieldValueMap?.['isReusable']} style={hlv('isReusable')}>
              <div className="flex items-start gap-1">
                <Checkbox
                  checked={inv?.isReusable ?? false}
                  className="rounded-none border-[#808080] h-3.5 w-3.5 mt-0.5 shrink-0"
                />
                <span className="text-xs font-mono leading-tight">Upon return to pharmacy, this product is reusable.</span>
              </div>
            </FieldDiffTooltip>
            {[
              { label: "Track lot numbers", checked: false },
              { label: "Disable APS/APA", checked: false },
              { label: "Skip dispense", checked: false },
              { label: "Waste Charging", checked: false },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-1">
                <Checkbox
                  defaultChecked={item.checked}
                  className="rounded-none border-[#808080] h-3.5 w-3.5 mt-0.5 shrink-0"
                />
                <span className="text-xs font-mono leading-tight">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
