"use client"

import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormField } from "./FormField"
import type { FormularyItem } from "@/lib/types"

interface DispenseTabProps {
  item: FormularyItem | null
}

export function DispenseTab({ item }: DispenseTabProps) {
  const d = item?.dispense
  const totalVolCalcValue = d?.usedInTotalVolumeCalculation ? "always" : "never"

  return (
    <div className="p-3 text-xs font-mono w-fit">
      {/* Main two-column layout */}
      <div className="grid grid-cols-[auto_auto] gap-x-8 gap-y-4">

        {/* LEFT COLUMN */}
        <div className="space-y-4">

          {/* Strength / Volume */}
          <div className="flex gap-4 items-end">
            <FormField label="Strength:" required>
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.strength != null ? String(d.strength) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-16"
                />
                <Input
                  value={d?.strengthUnit ?? ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20"
                />
              </div>
            </FormField>
            <span className="text-xs font-mono mb-1">/</span>
            <FormField label="Volume:" required>
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.volume != null ? String(d.volume) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12"
                />
                <Input
                  value={d?.volumeUnit ?? ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20"
                />
              </div>
            </FormField>
          </div>

          {/* Dispense quantity / Dispense category */}
          <div className="flex gap-3 items-end">
            <FormField label="Dispense quantity:">
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.dispenseQty != null ? String(d.dispenseQty) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12"
                />
                <Input
                  value={d?.dispenseQtyUnit ?? ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20"
                />
              </div>
            </FormField>
            <FormField label="Dispense category:">
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.dispenseCategory ?? ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-24"
                />
                <button className="h-6 w-6 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                  ...
                </button>
              </div>
            </FormField>
          </div>

          {/* Dispense factor */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">Dispense factor: 1 {d?.basePackageUnit ?? ""} =</span>
            <Input
              className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12 h-6"
            />
            <span className="text-xs font-mono">Each</span>
          </div>

          {/* Max QPD for APA */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">Max QPD for APA:</span>
            <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5" />
            <span className="text-xs font-mono pr-2">{d?.basePackageUnit ?? ""}</span>
          </div>

          {/* Package dispense quantity */}
          <fieldset className="border border-[#808080] p-2 pt-1 rounded-md">
            <legend className="text-xs font-mono font-bold px-1 ml-1 text-black">Package dispense quantity</legend>
            <div className="grid grid-cols-[auto_1fr] gap-y-1 gap-x-1 items-center mt-1">
              <span className="text-xs font-mono justify-self-end w-[72px] text-right">Number of:</span>
              <div className="flex items-center gap-1">
                <Input
                  value={d?.packageSize != null ? String(d.packageSize) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5"
                />
                <span className="text-xs font-mono">{d?.packageUnit ?? ""}</span>
              </div>
              <span className="text-xs font-mono justify-self-end w-[72px] text-right">per package:</span>
              <div className="flex items-center gap-1">
                <Input
                  value={d?.outerPackageSize != null ? String(d.outerPackageSize) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5"
                />
                <Checkbox
                  checked={d?.packageDispenseOnlyQtyNeeded ?? false}
                  className="rounded-none border-[#808080] h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">Allow Package to be Broken</span>
              </div>
            </div>
          </fieldset>

          {/* Formulary status */}
          <FormField label="Formulary status:" required className="w-full">
            <Input
              value={d?.formularyStatus ?? ""}
              readOnly
              className="w-full text-xs font-mono rounded-none border border-[#808080] px-1"
            />
          </FormField>

          {/* Price schedule / Billing factor */}
          <div className="space-y-2 mt-2">
            <FormField label="Price schedule:">
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.priceSchedule ?? ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 flex-1"
                />
                <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2">
                  Formula...
                </Button>
              </div>
            </FormField>
            <FormField label="Billing factor:">
              <div className="flex gap-1 items-center">
                <Input
                  value={d?.awpFactor != null ? String(d.awpFactor) : ""}
                  readOnly
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-16 h-6"
                />
                <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 flex-1 h-6" />
              </div>
            </FormField>
          </div>

          {/* CMS billing unit */}
          <div className="mt-3">
            <FormField label="CMS billing unit">
              <div className="flex items-center gap-1">
                <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20 h-6" />
                <span className="text-xs font-mono">{d?.strengthUnit ?? ""}</span>
              </div>
            </FormField>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">

          {/* Used in total volume / Workflow sequence */}
          <div className="flex gap-4 items-end">
            <FormField label="Used in total volume calculation:" className="flex-1">
              <Input
                value={totalVolCalcValue}
                readOnly
                className="w-full text-xs font-mono rounded-none border border-[#808080] px-1"
              />
            </FormField>
            <FormField label="Workflow sequence:" className="w-40">
              <Input className="w-full text-xs font-mono rounded-none border border-[#808080] px-1" />
            </FormField>
          </div>

          {/* Divisible product options */}
          <fieldset className="border border-[#808080] p-2 pt-1 rounded-md">
            <legend className="flex items-center gap-1 px-1 ml-1">
              <Checkbox
                checked={d?.isDivisible ?? false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono font-bold text-black">This product is divisible</span>
            </legend>
            <div className="flex items-center gap-2 mb-1 mt-1 pl-1">
              <input
                type="radio"
                name="divisible"
                defaultChecked={!d?.isInfinitelyDivisible}
                className="w-3 h-3"
              />
              <span className="text-xs font-mono">Minimum divisible factor</span>
              <Input
                value={d?.minimumDoseQty != null ? String(d.minimumDoseQty) : ""}
                readOnly
                className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5"
              />
              <span className="text-xs font-mono">{d?.basePackageUnit ?? ""}</span>
            </div>
            <div className="flex items-center gap-2 pl-1">
              <input
                type="radio"
                name="divisible"
                defaultChecked={d?.isInfinitelyDivisible ?? false}
                className="w-3 h-3"
              />
              <span className="text-xs font-mono">Infinitely divisible</span>
            </div>
          </fieldset>

          {/* Standardized Range buttons */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2 w-[140px]">
              Standardized Range
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2 w-[160px]">
              Preparation Information
            </Button>
          </div>

          {/* Par supply section */}
          <fieldset className="border border-[#808080] p-2 pt-1 rounded-md space-y-2">
            <legend className="text-xs font-mono font-bold px-1 ml-1 text-black">Par supply</legend>
            <div className="mt-1 flex flex-col gap-1">
              <label className="text-xs font-mono leading-none">Default par doses, this will override the frequency par defaults:</label>
              <Input
                value={d?.defaultParDoses != null ? String(d.defaultParDoses) : ""}
                readOnly
                className="text-xs font-mono rounded-none border border-[#808080] px-1 w-[200px] ml-auto block h-5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-mono leading-none">Maximum par quantity to be dispensed at a time:</label>
              <Input
                value={d?.maxParQty != null ? String(d.maxParQty) : ""}
                readOnly
                className="text-xs font-mono rounded-none border border-[#808080] px-1 w-[200px] ml-auto block h-5"
              />
            </div>
          </fieldset>

          {/* Point of Care scan charge setting */}
          <fieldset className="border border-[#808080] p-2 pt-1 rounded-md space-y-1">
            <legend className="text-xs font-mono font-bold px-1 ml-1 text-black">Point of Care scan charge setting</legend>
            <div className="text-xs font-mono mt-1">Charge for:</div>
            <div className="flex items-center gap-1 pl-2">
              <input type="radio" name="charge" defaultChecked className="w-3 h-3" />
              <span className="text-xs font-mono">Scanned products</span>
            </div>
            <div className="flex items-center gap-1 pl-2">
              <input type="radio" name="charge" className="w-3 h-3" />
              <span className="text-xs font-mono">Ordered/assigned products</span>
            </div>
          </fieldset>

        </div>
      </div>
    </div>
  )
}
