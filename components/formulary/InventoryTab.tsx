"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"

const facilities = [
  "ABM Main", "AIK Centers", "AIKB Psych", "AIKS - ER at Sweetwater",
  "Anchor Hospital-BH", "Brooke Glen Behavioral Hospital", "CHR- Main",
  "CHRB- Cedar Hill Regional Behavioral Hea", "EPBH FAIRMOUNT",
  "EPBH FAIRMOUNT RTC", "Fort Lauderdale Behavioral Health", "GW Hospital",
  "GW Psych", "GWU Liver and Pancreas", "GWU Spine and Pain",
  "GWU Transplant", "GWUW Wound", "Hampton Behavioral Health Center",
  "LWR Main", "MMH Main", "MMHB Psych", "Peachford Hospital-BH",
  "Psychiatric Institute of Washington", "Summit Ridge Hospital-BH",
  "UHS Corp", "UHSB", "UHST", "Windmoor Healthcare of Clearwater", "WRM Center",
]

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

export function InventoryTab() {
  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-3 h-full">
      {/* Column headers */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-xs font-mono">
          <span className="text-[#CC0000]">*</span> Orderable in the following facilities:
        </div>
        <div className="text-xs font-mono">
          Stocked in the following non-floorstock locations:
        </div>
        <div className="text-xs font-mono">
          Stocked in the following floorstock locations:
        </div>
      </div>

      {/* Three-column layout with lists and buttons */}
      <div className="grid grid-cols-3 gap-2 flex-1 min-h-0">
        {/* Column 1: Facilities */}
        <div className="flex flex-col gap-2 min-h-0">
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
              Update Facilities
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
              Flex by Facility
            </Button>
          </div>
        </div>

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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
              Update Pharmacies
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3">
              Flex NDC
            </Button>
          </div>
        </div>

        {/* Column 3: Floorstock + right sidebar */}
        <div className="flex gap-2 min-h-0">
          {/* Floorstock list */}
          <div className="flex flex-col gap-2 flex-1 min-h-0">
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
            <Button variant="outline" size="sm" className="h-7 text-xs font-mono rounded-none border-[#808080] px-3 w-full">
              Update Floorstock
            </Button>
          </div>

          {/* Right panel: Dispense from + checkboxes */}
          <div className="flex flex-col gap-2 w-44 min-h-0">
            <div className="border border-[#808080] p-2">
              <div className="text-xs font-mono mb-1 font-semibold">Dispense from</div>
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <input type="radio" name="dispense" defaultChecked className="w-3 h-3" />
                  <span className="text-xs font-mono">Check location list</span>
                </div>
                <div className="flex items-center gap-1">
                  <input type="radio" name="dispense" className="w-3 h-3" />
                  <span className="text-xs font-mono">Always dispense from non-floorstock location</span>
                </div>
                <div className="flex items-center gap-1">
                  <input type="radio" name="dispense" className="w-3 h-3" />
                  <span className="text-xs font-mono">Always dispense from floorstock</span>
                </div>
              </div>
            </div>
            <div className="space-y-1 overflow-y-auto">
              {[
                { label: "Upon return to pharmacy, this product is reusable.", checked: true },
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
    </div>
  )
}
