'use client'

import { FormField } from "./FormField"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { FormularyItem } from "@/lib/types"
import { FieldDiffTooltip } from "./FieldDiffTooltip"
import type { FieldValueMap, DomainValue } from "@/lib/formulary-diff"

interface FormularyHeaderProps {
  item: FormularyItem | null
  highlightedFields?: Set<string>
  fieldValueMap?: FieldValueMap
  onCreateTask?: (fieldName: string, fieldLabel: string, values: DomainValue[]) => void
}

export function FormularyHeader({ item, highlightedFields, fieldValueMap, onCreateTask }: FormularyHeaderProps) {
  const h = (...fields: string[]) =>
    fields.some(f => highlightedFields?.has(f))
      ? 'bg-[#FFF3CD] border-[#E6A817]'
      : ''

  const taskProps = (fieldName: string, fieldLabel: string) =>
    onCreateTask && fieldValueMap?.[fieldName]
      ? { fieldName, fieldLabel, onCreateTask }
      : {}

  return (
    <div className="px-3 py-2 bg-[#D4D0C8] border-b border-[#808080] shrink-0">
      {/* Row 1: Description / Strength / Status / Therapeutic Substitutions */}
      <div className="flex gap-3 items-end mb-2">
        <FieldDiffTooltip values={fieldValueMap?.['description']} className="flex-1 min-w-0 max-w-[220px]" {...taskProps('description', 'Description')}>
          <FormField label="Description:" required>
            <Input
              value={item?.description ?? ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('description'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['strength']} className="w-28" {...taskProps('strength', 'Strength')}>
          <FormField label="Strength:" required>
            <Input
              value={item ? `${item.strength} ${item.strengthUnit}`.trim() : ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('strength', 'strengthUnit'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['status']} className="w-28" {...taskProps('status', 'Status')}>
          <FormField label="Status:">
            <Input
              value={item?.status ?? ""}
              disabled
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-[#D4D0C8]", h('status'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <div className="flex items-start gap-1 pb-0.5 ml-2">
          <Checkbox className="rounded-none border-[#808080] h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="text-xs font-mono leading-tight">Therapeutic<br />Substitutions</span>
        </div>
      </div>

      {/* Row 2: Generic / Dosage form / Legal status / Mnemonic */}
      <div className="flex gap-3 items-end">
        <FieldDiffTooltip values={fieldValueMap?.['genericName']} className="flex-1 min-w-0 max-w-[220px]" {...taskProps('genericName', 'Generic Name')}>
          <FormField label="Generic:" required>
            <Input
              value={item?.genericName ?? ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('genericName'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['dosageForm']} className="w-28" {...taskProps('dosageForm', 'Dosage Form')}>
          <FormField label="Dosage form:" required>
            <Input
              value={item?.dosageForm ?? ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('dosageForm'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['legalStatus']} className="w-28" {...taskProps('legalStatus', 'Legal Status')}>
          <FormField label="Legal status:" required>
            <Input
              value={item?.legalStatus ?? ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('legalStatus'))}
            />
          </FormField>
        </FieldDiffTooltip>
        <FieldDiffTooltip values={fieldValueMap?.['mnemonic']} className="flex-1 min-w-0 max-w-[140px]" {...taskProps('mnemonic', 'Mnemonic')}>
          <FormField label="Mnemonic:" required>
            <Input
              value={item?.mnemonic ?? ""}
              readOnly
              className={cn("w-full text-xs font-mono rounded-none border-[#808080] px-1 border bg-white", h('mnemonic'))}
            />
          </FormField>
        </FieldDiffTooltip>
      </div>
    </div>
  )
}
