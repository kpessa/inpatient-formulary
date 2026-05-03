"use client"

import React from "react"
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
import type { FormularyItem, LintResultMap } from "@/lib/types"
import { FieldDiffTooltip } from "./FieldDiffTooltip"
import { decodeVbTokens } from "@/lib/text-tokens"
import { FieldLintTooltip } from "./FieldLintTooltip"
import type { FieldValueMap } from "@/lib/formulary-diff"

interface OEDefaultsTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  lintViolations?: LintResultMap
}

export function OEDefaultsTab({ item, highlightedFields, fieldValueMap, lintViolations }: OEDefaultsTabProps) {
  const d = item?.oeDefaults
  const hl = (key: string): React.CSSProperties => highlightedFields?.has(key) ? { background: '#FFF3CD', borderRadius: '2px' } : {}
  const lv = (key: string): React.CSSProperties => lintViolations?.has(key) ? { background: '#FFF0E0', outline: '1px solid #F97316', borderRadius: '2px' } : {}
  const hlv = (key: string): React.CSSProperties => ({ ...hl(key), ...lv(key) })
  return (
    <div className="p-2 space-y-2 text-xs font-mono h-full w-fit">
      {/* Row 1: Dose / Route / Frequency / Infuse over */}
      <div className="flex gap-3 items-end">
        <FieldLintTooltip violations={lintViolations?.get('dose')}><FieldDiffTooltip values={fieldValueMap?.['dose']} style={hlv('dose')}><FormField label="Dose:" className="w-28">
          <Input
            value={d?.dose ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField></FieldDiffTooltip></FieldLintTooltip>
        <FieldLintTooltip violations={lintViolations?.get('route')}><FieldDiffTooltip values={fieldValueMap?.['route']} style={hlv('route')}><FormField label="Route:" className="w-32">
          <Input
            value={d?.route ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField></FieldDiffTooltip></FieldLintTooltip>
        <FieldLintTooltip violations={lintViolations?.get('frequency')}><FieldDiffTooltip values={fieldValueMap?.['frequency']} style={hlv('frequency')}><FormField label="Frequency:" className="w-36">
          <Input
            value={d?.frequency ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField></FieldDiffTooltip></FieldLintTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['infuseOver']} style={hlv('infuseOver')}><FormField label="Infuse over:">
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
        </FormField></FieldDiffTooltip>
      </div>

      {/* Row 2: Freetext rate / Normalized rate / Rate */}
      <div className="flex gap-3 items-end">
        <FieldDiffTooltip values={fieldValueMap?.['freetextRate']} style={hlv('freetextRate')}><FormField label="Freetext rate:" className="w-36 text-[#808080]">
          <Input
            value={d?.freetextRate ?? ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField></FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['normalizedRate']} style={hlv('normalizedRate')}><FormField label="Normalized rate:" className="w-44 text-[#808080]">
          <Input
            value={d ? `${d.normalizedRate} ${d.normalizedRateUnit}`.trim() : ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField></FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['rate']} style={hlv('rate')}><FormField label="Rate:" className="w-28 text-[#808080]">
          <Input
            value={d ? `${d.rate} ${d.rateUnit}`.trim() : ""}
            readOnly
            disabled
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]"
          />
        </FormField></FieldDiffTooltip>
      </div>

      {/* Row 3: Duration / Stop type / PRN / PRN reason / Default ordered as */}
      <div className="flex gap-3 items-end flex-wrap">
        <FieldDiffTooltip values={fieldValueMap?.['duration']} style={hlv('duration')}><FormField label="Duration:">
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
        </FormField></FieldDiffTooltip>
        <FieldLintTooltip violations={lintViolations?.get('stopType')}><FieldDiffTooltip values={fieldValueMap?.['stopType']} style={hlv('stopType')}><FormField label="Stop type:" className="w-32">
          <Input
            value={d?.stopType ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField></FieldDiffTooltip></FieldLintTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['isPrn']} style={hlv('isPrn')}><FormField label="PRN:" className="items-center">
          <Checkbox
            checked={d?.isPrn ?? false}
            className="rounded-none border-[#808080] h-4 w-4"
          />
        </FormField></FieldDiffTooltip>
        <FieldLintTooltip violations={lintViolations?.get('prnReason')}><FieldDiffTooltip values={fieldValueMap?.['prnReason']} style={hlv('prnReason')}><FormField label="PRN reason:" className="w-36">
          <Input
            value={d?.prnReason ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField></FieldDiffTooltip></FieldLintTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['orderedAsSynonym']} style={hlv('orderedAsSynonym')}><FormField label="Default ordered as:" className="w-36">
          <Input
            value={d?.orderedAsSynonym ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField></FieldDiffTooltip>
      </div>

      {/* Row 4: SIG / Default screen format */}
      <div className="flex gap-3 items-end">
        <FormField label="SIG:" className="flex-1">
          <Input
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border"
          />
        </FormField>
        <FieldDiffTooltip values={fieldValueMap?.['defaultFormat']} style={hlv('defaultFormat')}><FormField label="Default screen format:" className="w-40">
          <Input
            value={d?.defaultFormat ?? ""}
            readOnly
            className="w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white"
          />
        </FormField></FieldDiffTooltip>
      </div>

      {/* Notes section */}
      <div className="flex gap-3">
        <fieldset className="flex-1 border border-[#808080] rounded-md p-2 pt-1">
          <legend className="text-xs font-mono px-1 ml-1 text-black">Notes</legend>
          <div className="space-y-2">
            {/* Note 1 */}
            <FieldLintTooltip violations={lintViolations?.get('notes1')}><FieldDiffTooltip values={fieldValueMap?.['notes1']} style={hlv('notes1')}>
              <div className="flex gap-4 items-stretch">
                <div className="flex flex-1 gap-2 border border-[#808080]">
                  <textarea
                    value={decodeVbTokens(d?.notes1)}
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
                    <FieldDiffTooltip values={fieldValueMap?.['notes1AppliesToFill']} style={hlv('notes1AppliesToFill')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes1AppliesToFill ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                      </div>
                    </FieldDiffTooltip>
                    <FieldDiffTooltip values={fieldValueMap?.['notes1AppliesToMar']} style={hlv('notes1AppliesToMar')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes1AppliesToMar ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                      </div>
                    </FieldDiffTooltip>
                    <FieldDiffTooltip values={fieldValueMap?.['notes1AppliesToLabel']} style={hlv('notes1AppliesToLabel')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes1AppliesToLabel ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">Label</span>
                      </div>
                    </FieldDiffTooltip>
                  </div>
                </fieldset>
              </div>
            </FieldDiffTooltip></FieldLintTooltip>
            {/* Note 2 */}
            <FieldLintTooltip violations={lintViolations?.get('notes2')}><FieldDiffTooltip values={fieldValueMap?.['notes2']} style={hlv('notes2')}>
              <div className="flex gap-4 items-stretch mt-2">
                <div className="flex flex-1 gap-2 border border-[#808080]">
                  <textarea
                    value={decodeVbTokens(d?.notes2)}
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
                    <FieldDiffTooltip values={fieldValueMap?.['notes2AppliesToFill']} style={hlv('notes2AppliesToFill')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes2AppliesToFill ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">Fill list</span>
                      </div>
                    </FieldDiffTooltip>
                    <FieldDiffTooltip values={fieldValueMap?.['notes2AppliesToMar']} style={hlv('notes2AppliesToMar')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes2AppliesToMar ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">MAR</span>
                      </div>
                    </FieldDiffTooltip>
                    <FieldDiffTooltip values={fieldValueMap?.['notes2AppliesToLabel']} style={hlv('notes2AppliesToLabel')}>
                      <div className="flex items-center gap-1">
                        <Checkbox checked={d?.notes2AppliesToLabel ?? false} className="rounded-none border-[#808080] h-3 w-3" />
                        <span className="text-xs font-mono whitespace-nowrap">Label</span>
                      </div>
                    </FieldDiffTooltip>
                  </div>
                </fieldset>
              </div>
            </FieldDiffTooltip></FieldLintTooltip>
          </div>
        </fieldset>

        {/* Search filter types */}
        <fieldset className="w-36 border border-[#808080] rounded-md p-2 pt-1 pb-3">
          <legend className="text-xs font-mono px-1 ml-1 text-black">Search filter types</legend>
          <div className="space-y-1">
            <FieldDiffTooltip values={fieldValueMap?.['searchMedication']} style={hlv('searchMedication')}>
              <div className="flex items-center gap-1">
                <Checkbox
                  checked={d?.searchMedication ?? false}
                  className="rounded-none border-[#808080] h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">Medication</span>
              </div>
            </FieldDiffTooltip>
            <FieldDiffTooltip values={fieldValueMap?.['searchContinuous']} style={hlv('searchContinuous')}>
              <div className="flex items-center gap-1">
                <Checkbox
                  checked={d?.searchContinuous ?? false}
                  className="rounded-none border-[#808080] h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">Continuous</span>
              </div>
            </FieldDiffTooltip>
            <div className="flex items-center gap-1">
              <Checkbox
                checked={false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">TPN</span>
            </div>
            <FieldDiffTooltip values={fieldValueMap?.['searchIntermittent']} style={hlv('searchIntermittent')}>
              <div className="flex items-center gap-1">
                <Checkbox
                  checked={d?.searchIntermittent ?? false}
                  className="rounded-none border-[#808080] h-3.5 w-3.5"
                />
                <span className="text-xs font-mono">Intermittent</span>
              </div>
            </FieldDiffTooltip>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
