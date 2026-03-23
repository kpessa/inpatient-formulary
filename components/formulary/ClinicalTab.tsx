"use client"

import React from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { FormularyItem } from "@/lib/types"
import { FieldDiffTooltip } from "./FieldDiffTooltip"
import type { FieldValueMap } from "@/lib/formulary-diff"
import { tcLabel } from "@/lib/therapeutic-class-map"

interface ClinicalTabProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
}

export function ClinicalTab({ item, highlightedFields, fieldValueMap }: ClinicalTabProps) {
  const d = item?.clinical
  const hl = (key: string): React.CSSProperties => highlightedFields?.has(key) ? { background: '#FFF3CD', borderRadius: '2px' } : {}
  return (
    <div className="p-3 text-xs font-mono flex flex-col gap-3">
      {/* Left/Right split */}
      <div className="flex gap-4">
        {/* Left column */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Generic formulation */}
          <FieldDiffTooltip values={fieldValueMap?.['genericFormulationCode']} style={hl('genericFormulationCode')}>
            <div className="flex flex-col gap-0.5">
              <Label className="text-xs font-mono text-[#808080]">Generic formulation:</Label>
              <div className="flex gap-1">
                <Input
                  value={d?.genericFormulationCode ?? ""}
                  readOnly
                  disabled
                  className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 flex-1 bg-[#D4D0C8]"
                />
                <button className="h-6 w-7 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                  ...
                </button>
              </div>
            </div>
          </FieldDiffTooltip>

          {/* Drug formulation */}
          <FieldDiffTooltip values={fieldValueMap?.['drugFormulationCode']} style={hl('drugFormulationCode')}>
            <div className="flex flex-col gap-0.5">
              <Label className="text-xs font-mono text-[#808080]">Drug formulation (drug, strength, form):</Label>
              <div className="flex gap-1">
                <Input
                  value={d?.drugFormulationCode ?? ""}
                  readOnly
                  disabled
                  className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 flex-1 bg-[#D4D0C8]"
                />
                <button className="h-6 w-7 border border-[#808080] bg-[#D4D0C8] text-xs font-mono flex items-center justify-center">
                  ...
                </button>
              </div>
            </div>
          </FieldDiffTooltip>

          {/* Suppress alerts */}
          <FieldDiffTooltip values={fieldValueMap?.['suppressMultumAlerts']} style={hl('suppressMultumAlerts')}>
            <div className="flex items-center gap-1">
              <Checkbox
                checked={d?.suppressMultumAlerts ?? false}
                className="rounded-none border-[#808080] h-3.5 w-3.5"
              />
              <span className="text-xs font-mono">Suppress clinical checking alerts</span>
            </div>
          </FieldDiffTooltip>

          {/* Order alerts */}
          <FieldDiffTooltip values={fieldValueMap?.['orderAlert1']} style={hl('orderAlert1')}>
            <div className="border border-[#808080] p-1 flex-1 flex flex-col">
              <div className="text-xs font-mono mb-1">Order alerts</div>
              <div className="border border-[#808080] bg-white flex-1 min-h-52 p-1">
                {d?.orderAlert1 && (
                  <div className="text-xs font-mono">{d.orderAlert1}</div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs font-mono rounded-none border-[#808080] px-3 mt-2 self-center"
              >
                Update Order Alerts
              </Button>
            </div>
          </FieldDiffTooltip>
        </div>

        {/* Right column */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Therapeutic class */}
          <FieldDiffTooltip values={fieldValueMap?.['therapeuticClass']} style={hl('therapeuticClass')}>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono">Therapeutic class:</Label>
                <div className="flex items-center gap-1">
                  <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5" />
                  <span className="text-xs font-mono">Show all</span>
                </div>
              </div>
              <Input
                value={tcLabel(d?.therapeuticClass)}
                readOnly
                className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0 bg-white"
              />
            </div>
          </FieldDiffTooltip>

          {/* Order catalog DC information */}
          <div className="border border-[#808080] p-2">
            <div className="text-xs font-mono mb-2">Order catalog DC information</div>
            <div className="flex gap-4">
              <FieldDiffTooltip values={fieldValueMap?.['dcInteractionDays']} style={hl('dcInteractionDays')}>
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs font-mono">Interaction:</Label>
                  <Input
                    value={d?.dcInteractionDays != null ? String(d.dcInteractionDays) : ""}
                    readOnly
                    className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 w-24"
                  />
                </div>
              </FieldDiffTooltip>
              <FieldDiffTooltip values={fieldValueMap?.['dcDisplayDays']} style={hl('dcDisplayDays')}>
                <div className="flex flex-col gap-0.5">
                  <Label className="text-xs font-mono">Display:</Label>
                  <Input
                    value={d?.dcDisplayDays != null ? String(d.dcDisplayDays) : ""}
                    readOnly
                    className="h-6 text-xs font-mono rounded-none border-[#808080] px-1 py-0.5 w-24"
                  />
                </div>
              </FieldDiffTooltip>
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
