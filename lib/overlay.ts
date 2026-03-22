import type { FormularyItem, FieldOverride } from './types'

/**
 * Merges field_overrides onto a FormularyItem without mutating the original.
 * Handles top-level fields (e.g. 'description') and nested tab fields
 * (e.g. 'oeDefaults.dose', 'identifiers.chargeNumber').
 */
export function applyOverrides(item: FormularyItem, overrides: FieldOverride[]): FormularyItem {
  const result = structuredClone(item) as Record<string, unknown>
  for (const o of overrides) {
    const value = JSON.parse(o.overrideValue)
    const parts = o.fieldPath.split('.')
    if (parts.length === 1) {
      result[parts[0]] = value
    } else {
      const [section, field] = parts
      const sec = (result[section] ?? {}) as Record<string, unknown>
      result[section] = { ...sec, [field]: value }
    }
  }
  return result as FormularyItem
}
