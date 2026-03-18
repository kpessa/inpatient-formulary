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

export function DispenseTab() {
  return (
    <div className="p-3 text-xs font-mono w-fit">
      {/* Main two-column layout */}
      <div className="grid grid-cols-[auto_auto] gap-x-8 gap-y-4">
        
        {/* LEFT COLUMN */}
        <div className="space-y-3">
          
          {/* Strength / Volume */}
          <div className="flex gap-3 items-end">
            <FormField label="Strength:" required>
              <div className="flex gap-1 items-center">
                <Input
                  defaultValue="500"
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-16"
                />
                <Select defaultValue="mg">
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="mg">mg</SelectItem>
                    <SelectItem value="mcg">mcg</SelectItem>
                    <SelectItem value="g">g</SelectItem>
                    <SelectItem value="mEq">mEq</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormField>
            <span className="text-xs font-mono mb-1">/</span>
            <FormField label="Volume:" required>
              <div className="flex gap-1 items-center">
                <Input
                  defaultValue="1"
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12"
                />
                <Select defaultValue="tabs">
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="tabs">Tabs</SelectItem>
                    <SelectItem value="caps">Caps</SelectItem>
                    <SelectItem value="mL">mL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormField>
          </div>

          {/* Dispense quantity / Dispense category */}
          <div className="flex gap-3 items-end">
            <FormField label="Dispense quantity:">
              <div className="flex gap-1 items-center">
                <Input
                  defaultValue="1"
                  className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12"
                />
                <Select defaultValue="tabs">
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="tabs">Tabs</SelectItem>
                    <SelectItem value="caps">Caps</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormField>
            <FormField label="Dispense category:">
              <div className="flex gap-1 items-center">
                <Select defaultValue="ud">
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 w-24 bg-[#316AC5] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="ud">UD</SelectItem>
                    <SelectItem value="bulk">Bulk</SelectItem>
                  </SelectContent>
                </Select>
                <button className="h-6 w-6 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                  ...
                </button>
              </div>
            </FormField>
          </div>

          {/* Dispense factor */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">Dispense factor: 1 Tabs =</span>
            <Input
              defaultValue="1"
              className="text-xs font-mono rounded-none border border-[#808080] px-1 w-12 h-6"
            />
            <span className="text-xs font-mono">Each</span>
          </div>

          {/* Package dispense quantity */}
          <div className="border border-[#808080] p-2">
            <div className="text-xs font-mono font-bold mb-2">Package dispense quantity</div>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-xs font-mono">Number of:</span>
              <Input defaultValue="1" className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5" />
              <span className="text-xs font-mono">Tabs</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-mono">per package:</span>
              <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5" />
              <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" />
              <span className="text-xs font-mono">Allow Package to be Broken</span>
            </div>
          </div>

          {/* Formulary status */}
          <FormField label="Formulary status:" required className="w-full">
            <Select defaultValue="formulary">
              <SelectTrigger className="w-full text-xs font-mono rounded-none border border-[#808080] px-1 bg-[#316AC5] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs font-mono rounded-none">
                <SelectItem value="formulary">Formulary</SelectItem>
                <SelectItem value="nonformulary">Non-Formulary</SelectItem>
                <SelectItem value="restricted">Restricted</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* CMS billing unit */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono">CMS billing unit:</span>
            <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-20 h-6" />
            <span className="text-xs font-mono">mg</span>
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-3">
          
          {/* Used in total volume / Workflow sequence */}
          <div className="flex gap-3 items-end">
            <FormField label="Used in total volume calculation:" className="flex-1">
              <Select defaultValue="never">
                <SelectTrigger className="w-full text-xs font-mono rounded-none border border-[#808080] px-1 bg-[#316AC5] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="text-xs font-mono rounded-none">
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="always">Always</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Workflow sequence:" className="w-40">
              <Select>
                <SelectTrigger className="w-full text-xs font-mono rounded-none border border-[#808080] px-1">
                  <SelectValue placeholder="" />
                </SelectTrigger>
                <SelectContent className="text-xs font-mono rounded-none">
                  <SelectItem value="1">1</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {/* Divisible product options */}
          <div className="border border-[#808080] p-2">
            <div className="flex items-center gap-1 mb-2">
              <Checkbox defaultChecked className="rounded-none border-[#808080] h-3.5 w-3.5" />
              <span className="text-xs font-mono font-bold">This product is divisible</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <input type="radio" name="divisible" defaultChecked className="w-3 h-3" />
              <span className="text-xs font-mono">Minimum divisible factor</span>
              <Input
                defaultValue="0.25"
                className="text-xs font-mono rounded-none border border-[#808080] px-1 w-14 h-5"
              />
              <span className="text-xs font-mono">Tabs</span>
            </div>
            <div className="flex items-center gap-2">
              <input type="radio" name="divisible" className="w-3 h-3" />
              <span className="text-xs font-mono">Infinitely divisible</span>
            </div>
          </div>

          {/* Max QPD for APA / Standardized Range buttons */}
          <div className="flex items-end gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs font-mono">Max QPD for APA:</span>
              <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-16 h-6" />
              <span className="text-xs font-mono">Tabs</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2">
                Standardized Range
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2">
                Preparation Information
              </Button>
            </div>
          </div>

          {/* Par supply section */}
          <div className="space-y-2">
            <div className="text-xs font-mono font-bold">Par supply</div>
            <FormField label="Default par doses, this will override the frequency par defaults:">
              <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-full h-5" />
            </FormField>
            <FormField label="Maximum par quantity to be dispensed at a time:">
              <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-full h-5" />
            </FormField>
          </div>

          {/* Price schedule / Billing factor */}
          <div className="space-y-2">
            <FormField label="Price schedule:">
              <div className="flex gap-1 items-center">
                <Select defaultValue="uhs-otc">
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 flex-1 bg-[#316AC5] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="uhs-otc">UHS-OTC</SelectItem>
                    <SelectItem value="uhs-rx">UHS-RX</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-6 text-xs font-mono rounded-none border-[#808080] px-2">
                  Formula...
                </Button>
              </div>
            </FormField>
            <FormField label="Billing factor:">
              <div className="flex gap-1 items-center">
                <Input className="text-xs font-mono rounded-none border border-[#808080] px-1 w-16 h-6" />
                <Select>
                  <SelectTrigger className="text-xs font-mono rounded-none border border-[#808080] px-1 flex-1">
                    <SelectValue placeholder="" />
                  </SelectTrigger>
                  <SelectContent className="text-xs font-mono rounded-none">
                    <SelectItem value="1">1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormField>
          </div>

          {/* Point of Care scan charge setting */}
          <div className="space-y-1">
            <div className="text-xs font-mono font-bold">Point of Care scan charge setting</div>
            <div className="text-xs font-mono">Charge for:</div>
            <div className="flex items-center gap-1">
              <input type="radio" name="charge" defaultChecked className="w-3 h-3" />
              <span className="text-xs font-mono">Scanned products</span>
            </div>
            <div className="flex items-center gap-1">
              <input type="radio" name="charge" className="w-3 h-3" />
              <span className="text-xs font-mono">Ordered/assigned products</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
