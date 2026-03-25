import type { FormularyItem } from './types'
import type { DesignPattern, PatternFieldRule, LinterViolation, LintResultMap } from './types'

function getFieldValue(item: FormularyItem, field: string): string {
  switch (field) {
    // Header
    case 'description':   return item.description ?? ''
    case 'genericName':   return item.genericName ?? ''
    case 'mnemonic':      return item.mnemonic ?? ''
    case 'strength':      return item.strength ?? ''
    case 'strengthUnit':  return item.strengthUnit ?? ''
    case 'dosageForm':    return item.dosageForm ?? ''
    case 'status':        return item.status ?? ''
    case 'legalStatus':   return item.legalStatus ?? ''
    // OE Defaults
    case 'stopType':      return item.oeDefaults?.stopType ?? ''
    case 'dose':          return item.oeDefaults?.dose ?? ''
    case 'route':         return item.oeDefaults?.route ?? ''
    case 'frequency':     return item.oeDefaults?.frequency ?? ''
    case 'notes1':        return item.oeDefaults?.notes1 ?? ''
    case 'notes2':        return item.oeDefaults?.notes2 ?? ''
    case 'prnReason':     return item.oeDefaults?.prnReason ?? ''
    case 'duration':      return String(item.oeDefaults?.duration ?? '')
    case 'durationUnit':  return item.oeDefaults?.durationUnit ?? ''
    // Dispense
    case 'dispenseCategory':   return item.dispense?.dispenseCategory ?? ''
    case 'formularyStatus':    return item.dispense?.formularyStatus ?? ''
    case 'packageUnit':        return item.dispense?.packageUnit ?? ''
    case 'awpFactor':          return String(item.dispense?.awpFactor ?? '')
    case 'dispenseQty':        return String(item.dispense?.dispenseQty ?? '')
    case 'dispenseQtyUnit':    return item.dispense?.dispenseQtyUnit ?? ''
    case 'priceSchedule':      return item.dispense?.priceSchedule ?? ''
    // Clinical
    case 'therapeuticClass':    return item.clinical?.therapeuticClass ?? ''
    case 'orderAlert1':         return item.clinical?.orderAlert1 ?? ''
    case 'suppressMultumAlerts': return item.clinical?.suppressMultumAlerts ? 'true' : 'false'
    case 'genericFormulationCode': return item.clinical?.genericFormulationCode ?? ''
    case 'drugFormulationCode':    return item.clinical?.drugFormulationCode ?? ''
    // Identifiers
    case 'brandName':        return item.identifiers?.brandName ?? ''
    case 'chargeNumber':     return item.identifiers?.chargeNumber ?? ''
    case 'labelDescription': return item.identifiers?.labelDescription ?? ''
    case 'pyxisId':          return item.identifiers?.pyxisId ?? ''
    case 'groupRxMnemonic':  return item.identifiers?.groupRxMnemonic ?? ''
    case 'hcpcsCode':        return item.identifiers?.hcpcsCode ?? ''
    default:                 return ''
  }
}

export function rulePass(operator: string, ruleValue: string, fieldValue: string): boolean {
  const fv = fieldValue.toLowerCase()
  const rv = ruleValue.toLowerCase()
  switch (operator) {
    case 'equals':       return fv === rv
    case 'not_equals':   return fv !== rv
    case 'contains':     return fv.includes(rv)
    case 'not_contains': return !fv.includes(rv)
    case 'starts_with':  return fv.startsWith(rv)
    case 'ends_with':    return fv.endsWith(rv)
    case 'matches_regex': {
      try { return new RegExp(ruleValue, 'i').test(fieldValue) } catch { return false }
    }
    case 'not_empty':    return fieldValue.trim().length > 0
    default:             return true
  }
}

function patternAppliesTo(
  pattern: DesignPattern,
  item: FormularyItem,
  categoryIds: string[],
): boolean {
  if (pattern.scopeType === 'all') return true
  if (pattern.scopeType === 'category') return categoryIds.includes(pattern.scopeValue)
  if (pattern.scopeType === 'rule') {
    try {
      const scope = JSON.parse(pattern.scopeValue) as { field: string; operator: string; value: string }
      const fieldValue = getFieldValue(item, scope.field)
      return rulePass(scope.operator, scope.value, fieldValue)
    } catch {
      return false
    }
  }
  return false
}

// Attempt to compute a concrete expected value from item data for known field types.
function computeSuggestion(item: FormularyItem, field: string): string {
  if (field === 'mnemonic') {
    const current = item.mnemonic ?? ''
    // Extract the alphabetic prefix before the first digit
    const prefix = current.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? ''
    // Extract just the numeric part of strength (drop unit like "mg")
    const strengthNum = String(item.strength ?? '').match(/[\d.]+/)?.[0] ?? ''
    if (prefix && strengthNum) return `${prefix}${strengthNum}HTab`
  }

  if (field === 'description') {
    const generic = item.genericName ?? ''
    const strength = String(item.strength ?? '').match(/[\d.]+/)?.[0] ?? ''
    const unit = item.strengthUnit ?? ''
    // Try to pull whole-tab strength from current description ("Half of X mg")
    const wholeMatch = (item.description ?? '').match(/half of ([\d.]+)/i)
    const wholeStrength = wholeMatch ? wholeMatch[1] : null
    if (generic && strength && unit) {
      const whole = wholeStrength ? `${wholeStrength} ${unit}` : `??? ${unit}`
      return `${generic} ${strength} ${unit} (Half of ${whole} Tab)`
    }
  }

  return ''
}

export function computeLintViolations(
  item: FormularyItem | null,
  patterns: DesignPattern[],
  categoryIds: string[],
): LintResultMap {
  const result = new Map<string, LinterViolation[]>()
  if (!item || patterns.length === 0) return result

  for (const pattern of patterns) {
    if (!patternAppliesTo(pattern, item, categoryIds)) continue
    for (const rule of pattern.fieldRules) {
      const fieldValue = getFieldValue(item, rule.field)
      if (!rulePass(rule.operator, rule.value, fieldValue)) {
        if (!result.has(rule.field)) result.set(rule.field, [])
        const suggestion = computeSuggestion(item, rule.field)
        result.get(rule.field)!.push({
          patternId: pattern.id,
          patternName: pattern.name,
          patternColor: pattern.color,
          expected: rule.expectedDisplay || `${rule.operator.replace(/_/g, ' ')} "${rule.value}"`,
          ...(suggestion ? { suggestion } : {}),
        })
      }
    }
  }

  return result
}
