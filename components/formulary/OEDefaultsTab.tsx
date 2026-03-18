"use client"

import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormField } from "./FormField"

export function OEDefaultsTab() {
  return (
    <div className="p-2 space-y-2 text-xs font-mono h-full">
      {/* Row 1: Dose / Route / Frequency / Infuse over */}
      <div className="flex gap-3 items-end">
        <FormField label="Dose:" className="w-28">
          <Input
            defaultValue="500 mg"
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FormField label="Route:" className="w-32">
          <Select defaultValue="oral">
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="oral">Oral</SelectItem>
              <SelectItem value="iv">IV</SelectItem>
              <SelectItem value="im">IM</SelectItem>
              <SelectItem value="topical">Topical</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Frequency:" className="w-36">
          <Select>
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="q4h">Q4H</SelectItem>
              <SelectItem value="q6h">Q6H</SelectItem>
              <SelectItem value="q8h">Q8H</SelectItem>
              <SelectItem value="qd">Daily</SelectItem>
              <SelectItem value="prn">PRN</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Infuse over:">
          <div className="flex gap-1">
            <Input
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-14"
            />
            <Select>
              <SelectTrigger className="text-xs font-mono rounded-none border-[#808080] px-1 border w-28">
                <SelectValue placeholder="" />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="min">Minutes</SelectItem>
                <SelectItem value="hr">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </FormField>
      </div>

      {/* Row 2: Freetext rate / Normalized rate / Rate */}
      <div className="flex gap-3 items-end">
        <FormField label="Freetext rate:" className="w-36 text-[#808080]">
          <Input
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField>
        <FormField label="Normalized rate:" className="w-44 text-[#808080]">
          <Select disabled>
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="none">-</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Rate:" className="w-28 text-[#808080]">
          <Input
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
              defaultValue="30"
              className="text-xs font-mono rounded-none border-[#808080] px-1 border w-10"
            />
            <Select defaultValue="days">
              <SelectTrigger className="text-xs font-mono rounded-none border-[#808080] px-1 border w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="days">Days</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </FormField>
        <FormField label="Stop type:" className="w-32">
          <Select defaultValue="hardstop">
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#316AC5] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="hardstop">Hard Stop</SelectItem>
              <SelectItem value="softstop">Soft Stop</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="PRN:" className="items-center">
          <Checkbox className="rounded-none border-[#808080] h-4 w-4" />
        </FormField>
        <FormField label="PRN reason:" className="w-36">
          <Select>
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="pain">Pain</SelectItem>
              <SelectItem value="fever">Fever</SelectItem>
              <SelectItem value="nausea">Nausea</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Default ordered as:" className="w-36">
          <Select defaultValue="nodefault">
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#316AC5] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="nodefault">No Default</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
            </SelectContent>
          </Select>
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
          <Select defaultValue="medication">
            <SelectTrigger className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#316AC5] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs font-mono rounded-none">
              <SelectItem value="medication">Medication</SelectItem>
              <SelectItem value="iv">IV</SelectItem>
            </SelectContent>
          </Select>
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
                  className="flex-1 text-xs font-mono p-1 resize-none border-0 outline-none w-full h-full bg-white"
                  readOnly
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
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Label</span>
                  </div>
                </div>
              </fieldset>
            </div>
            {/* Note 2 */}
            <div className="flex gap-4 items-stretch mt-2">
              <div className="flex flex-1 gap-2 border border-[#808080]">
                <textarea
                  className="flex-1 text-xs font-mono p-1 resize-none border-0 outline-none w-full h-full bg-white"
                  readOnly
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
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
                    <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox className="rounded-none border-[#808080] h-3 w-3" />
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
            {[
              { label: "Medication", checked: true },
              { label: "Continuous", checked: false },
              { label: "TPN", checked: false },
              { label: "Intermittent", checked: false },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-1">
                <Checkbox
                  defaultChecked={item.checked}
                  className="rounded-none border-[#808080] h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">{item.label}</span>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  )
}
