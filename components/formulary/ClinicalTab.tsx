"use client"

import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ClinicalTab() {
  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-3">
      {/* Left/Right split */}
      <div className="flex gap-4">
        {/* Left column */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Generic formulation */}
          <div className="flex flex-col gap-0.5">
            <Label className="text-xs font-mono text-[#808080]">Generic formulation:</Label>
            <div className="flex gap-1">
              <Input
                defaultValue="acetaminophen"
                disabled
                className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 flex-1 bg-[#D4D0C8]"
              />
              <button className="h-6 w-7 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                ...
              </button>
            </div>
          </div>

          {/* Drug formulation */}
          <div className="flex flex-col gap-0.5">
            <Label className="text-xs font-mono text-[#808080]">Drug formulation (drug, strength, form):</Label>
            <div className="flex gap-1">
              <Input
                defaultValue="acetaminophen 500 mg oral tablet"
                disabled
                className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 flex-1 bg-[#D4D0C8]"
              />
              <button className="h-6 w-7 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                ...
              </button>
            </div>
          </div>

          {/* Suppress alerts */}
          <div className="flex items-center gap-1">
            <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" />
            <span className="text-xs font-mono">Suppress clinical checking alerts</span>
          </div>

          {/* Order alerts */}
          <div className="border border-[#808080] p-1 flex-1 flex flex-col">
            <div className="text-xs font-mono mb-1">Order alerts</div>
            <div className="border border-[#808080] bg-white flex-1 min-h-52" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono rounded-none border-[#808080] px-3 mt-2 self-center"
            >
              Update Order Alerts
            </Button>
          </div>
        </div>

        {/* Right column */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Therapeutic class */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-mono">Therapeutic class:</Label>
              <div className="flex items-center gap-1">
                <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" />
                <span className="text-xs font-mono">Show all</span>
              </div>
            </div>
            <Select defaultValue="misc-analgesics">
              <SelectTrigger className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0 bg-[#316AC5] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="misc-analgesics">miscellaneous analgesics</SelectItem>
                <SelectItem value="nsaids">NSAIDs</SelectItem>
                <SelectItem value="opioids">Opioids</SelectItem>
                <SelectItem value="antibiotics">Antibiotics</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Order catalog DC information */}
          <div className="border border-[#808080] p-2">
            <div className="text-xs font-mono mb-2">Order catalog DC information</div>
            <div className="flex gap-4">
              <div className="flex flex-col gap-0.5">
                <Label className="text-xs font-mono">Interaction:</Label>
                <Input
                  defaultValue="0"
                  className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 w-24"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-xs font-mono">Display:</Label>
                <Input
                  defaultValue="2"
                  className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 w-24"
                />
              </div>
            </div>
          </div>

          {/* Label warnings */}
          <div className="border border-[#808080] p-1 flex-1 flex flex-col">
            <div className="text-xs font-mono mb-1">Label warnings</div>
            <div className="border border-[#808080] bg-white flex-1 min-h-52" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono rounded-none border-[#808080] px-3 mt-2 self-center"
            >
              Update Label Warnings
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
