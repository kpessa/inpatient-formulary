"use client"

import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormField } from "./FormField"
import type { FormularyItem } from "@/lib/types"

interface OEDefaultsTabProps {
  item: FormularyItem | null
}

export function OEDefaultsTab({ item }: OEDefaultsTabProps) {
  const d = item?.oeDefaults
  return (
    <div className="p-2 space-y-2 text-xs font-mono h-full w-fit">
      {/* Row 1: Dose / Route / Frequency / Infuse over */}
      <div className="flex gap-3 items-end">
        <FormField label="Dose:" className="w-28">
          <Input
            value={d?.dose ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Route:" className="w-32">
          <Input
            value={d?.route ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Frequency:" className="w-36">
          <Input
            value={d?.frequency ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Infuse over:">
          <div className="flex gap-1">
            <Input
              value={d?.infuseOver ?? ""}
              readOnly
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-14"
            />
            <Input
              value={d?.infuseOverUnit ?? ""}
              readOnly
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-28"
            />
          </div>
        </FormField>
      </div>

      {/* Row 2: Freetext rate / Normalized rate / Rate */}
      <div className="flex gap-3 items-end">
        <FormField label="Freetext rate:" className="w-36 text-[#808080]">
          <Input
            value={d?.freetextRate ?? ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField>
        <FormField label="Normalized rate:" className="w-44 text-[#808080]">
          <Input
            value={d ? `${d.normalizedRate} ${d.normalizedRateUnit}`.trim() : ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField>
        <FormField label="Rate:" className="w-28 text-[#808080]">
          <Input
            value={d ? `${d.rate} ${d.rateUnit}`.trim() : ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField>
      </div>

      {/* Row 3: Duration / Stop type / PRN / PRN reason / Default ordered as */}
      <div className="flex gap-3 items-end flex-wrap">
        <FormField label="Duration:">
          <div className="flex gap-1">
            <Input
              value={d?.duration != null ? String(d.duration) : ""}
              readOnly
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-10"
            />
            <Input
              value={d?.durationUnit ?? ""}
              readOnly
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-24"
            />
          </div>
        </FormField>
        <FormField label="Stop type:" className="w-32">
          <Input
            value={d?.stopType ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField>
        <FormField label="PRN:" className="items-center">
          <Checkbox
            checked={d?.isPrn ?? false}
            className="rounded-none border-[#808080] h-4 w-4"
          />
        </FormField>
        <FormField label="PRN reason:" className="w-36">
          <Input
            value={d?.prnReason ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Default ordered as:" className="w-36">
          <Input
            value={d?.orderedAsSynonym ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField>
      </div>

      {/* Row 4: SIG / Default screen format */}
      <div className="flex gap-3 items-end">
        <FormField label="SIG:" className="flex-1">
          <Input
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Default screen format:" className="w-40">
          <Input
            value={d?.defaultFormat ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField>
      </div>

      {/* Notes section */}
      <div className="flex gap-3">
        <fieldset className="flex-1 border border-[#808080] rounded-md p-2 pt-1">
          <legend className="text-xs font-mono px-1 ml-1 text-black">Notes</legend>
          <div className="space-y-2">
            {/* Note 1 */}
            <div className="flex gap-4 items-stretch">
              <div className="flex flex-1 gap-2 border border-[#808080]">
                <textarea
                  value={d?.notes1 ?? ""}
                  readOnly
                  className="flex-1 text-xs font-mono p-1 resize-none border-0 outline-none w-full h-full bg-white"
                />
                <div className="border-l border-[#808080] p-1 flex flex-col justify-between w-5 h-full bg-[#D4D0C8]">
                  <button className="text-[10px] leading-none h-1/2 flex items-center justify-center border-b border-[#808080] hover:bg-[#E8E8E0] active:bg-[#B0A898]">▲</button>
                  <button className="text-[10px] leading-none h-1/2 flex items-center justify-center hover:bg-[#E8E8E0] active:bg-[#B0A898]">▼</button>
                </div>
              </div>
              <fieldset className="border border-[#808080] rounded-md p-1.5 pt-0.5 text-xs font-mono w-48 shrink-0 -mt-1">
                <legend className="text-xs font-mono px-1 ml-1 text-black">Applies to</legend>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-0.5">
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes1AppliesToFill ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes1AppliesToMar ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes1AppliesToLabel ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Label</span>
                  </div>
                </div>
              </fieldset>
            </div>
            {/* Note 2 */}
            <div className="flex gap-4 items-stretch mt-2">
              <div className="flex flex-1 gap-2 border border-[#808080]">
                <textarea
                  value={d?.notes2 ?? ""}
                  readOnly
                  className="flex-1 text-xs font-mono p-1 resize-none border-0 outline-none w-full h-full bg-white"
                />
                <div className="border-l border-[#808080] p-1 flex flex-col justify-between w-5 h-full bg-[#D4D0C8]">
                  <button className="text-[10px] leading-none h-1/2 flex items-center justify-center border-b border-[#808080] hover:bg-[#E8E8E0] active:bg-[#B0A898]">▲</button>
                  <button className="text-[10px] leading-none h-1/2 flex items-center justify-center hover:bg-[#E8E8E0] active:bg-[#B0A898]">▼</button>
                </div>
              </div>
              <fieldset className="border border-[#808080] rounded-md p-1.5 pt-0.5 text-xs font-mono w-48 shrink-0 -mt-1">
                <legend className="text-xs font-mono px-1 ml-1 text-black">Applies to</legend>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-0.5">
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes2AppliesToFill ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes2AppliesToMar ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox checked={d?.notes2AppliesToLabel ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Label</span>
                  </div>
                </div>
              </fieldset>
            </div>
          </div>
        </fieldset>

        {/* Search filter types */}
        <fieldset className="w-36 border border-[#808080] rounded-md p-2 pt-1 pb-3">
          <legend className="text-xs font-mono px-1 ml-1 text-black">Search filter types</legend>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Checkbox
                checked={d?.searchMedication ?? false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">Medication</span>
            </div>
            <div className="flex items-center gap-1">
              <Checkbox
                checked={d?.searchContinuous ?? false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">Continuous</span>
            </div>
            <div className="flex items-center gap-1">
              <Checkbox
                checked={false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">TPN</span>
            </div>
            <div className="flex items-center gap-1">
              <Checkbox
                checked={d?.searchIntermittent ?? false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">Intermittent</span>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
