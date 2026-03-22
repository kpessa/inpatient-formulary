import type { FormularyItem, OeDefaults, DispenseInfo, ClinicalInfo, InventoryInfo, Identifiers } from './types'

export type DomainValue = { domain: string; bg: string; text: string; badge: string; value: string }
export type FieldValueMap = Record<string, DomainValue[]>
export type DomainRecord = { domain: string; bg: string; text: string; badge: string; item: FormularyItem | null }

export const REGION_ORDER = ['west', 'central', 'east'] as const

export function buildDomainRecords(domainKeys: string[], items: (FormularyItem | null)[]): DomainRecord[] {
  return domainKeys.map((dk, i) => {
    const [reg, env] = dk.split('_')
    const { bg, text } = getDomainColor(reg, env)
    return { domain: dk, bg, text, badge: getDomainBadge(reg, env), item: items[i] ?? null }
  })
}

export function getDomainColor(region: string, env: string): { bg: string; text: string; border: string } {
  const hue = region === 'east' ? 213 : region === 'west' ? 142 : 32
  const sat  = env === 'prod' ? 75 : env === 'cert' ? 60 : env === 'mock' ? 45 : 30
  const light = env === 'prod' ? 35 : env === 'cert' ? 50 : env === 'mock' ? 63 : 78
  return {
    bg:     `hsl(${hue}, ${sat}%, ${light}%)`,
    text:   light < 58 ? '#ffffff' : '#1a1a1a',
    border: `hsl(${hue}, ${sat}%, ${Math.max(light - 12, 10)}%)`,
  }
}

export function getDomainBadge(region: string, env: string): string {
  const letter = region === 'east' ? 'E' : region === 'west' ? 'W' : 'C'
  return env === 'prod' ? letter : letter.toLowerCase()
}

function checkFieldDiffs<T extends object>(objs: (T | undefined)[], keys: (keyof T)[], fields: Set<string>) {
  for (const key of keys) {
    const vals = objs.map(o => JSON.stringify(o?.[key]))
    if (new Set(vals).size > 1) fields.add(String(key))
  }
}

export function computeHeaderDiffs(items: (FormularyItem | null)[]): Set<string> {
  const loaded = items.filter(Boolean) as FormularyItem[]
  if (loaded.length <= 1) return new Set()
  const fields = new Set<string>()
  checkFieldDiffs(loaded, ['description', 'strength', 'strengthUnit', 'status', 'genericName', 'dosageForm', 'legalStatus', 'mnemonic'], fields)
  return fields
}

export function computeTabDiffs(items: (FormularyItem | null)[], tab: string): { count: number; fields: Set<string> } {
  const loaded = items.filter(Boolean) as FormularyItem[]
  if (loaded.length <= 1) return { count: 0, fields: new Set() }
  const fields = new Set<string>()

  if (tab === 'oe-defaults') {
    checkFieldDiffs<OeDefaults>(loaded.map(i => i.oeDefaults), [
      'dose', 'route', 'frequency', 'infuseOver', 'infuseOverUnit',
      'freetextRate', 'normalizedRate', 'normalizedRateUnit', 'rate', 'rateUnit',
      'isPrn', 'prnReason', 'duration', 'durationUnit', 'stopType',
      'orderedAsSynonym', 'defaultFormat', 'searchMedication', 'searchContinuous', 'searchIntermittent',
      'notes1', 'notes1AppliesToFill', 'notes1AppliesToLabel', 'notes1AppliesToMar',
      'notes2', 'notes2AppliesToFill', 'notes2AppliesToLabel', 'notes2AppliesToMar',
    ], fields)
  } else if (tab === 'dispense') {
    checkFieldDiffs<DispenseInfo>(loaded.map(i => i.dispense), [
      'strength', 'strengthUnit', 'volume', 'volumeUnit', 'usedInTotalVolumeCalculation',
      'dispenseQty', 'dispenseQtyUnit', 'dispenseCategory', 'isDivisible', 'isInfinitelyDivisible',
      'minimumDoseQty', 'packageSize', 'packageUnit', 'outerPackageSize', 'outerPackageUnit',
      'basePackageUnit', 'packageDispenseQty', 'packageDispenseOnlyQtyNeeded',
      'formularyStatus', 'priceSchedule', 'awpFactor', 'defaultParDoses', 'maxParQty',
    ], fields)
  } else if (tab === 'clinical') {
    checkFieldDiffs<ClinicalInfo>(loaded.map(i => i.clinical), [
      'genericFormulationCode', 'drugFormulationCode', 'suppressMultumAlerts',
      'therapeuticClass', 'dcInteractionDays', 'dcDisplayDays', 'orderAlert1',
    ], fields)
  } else if (tab === 'identifiers') {
    checkFieldDiffs<Identifiers>(loaded.map(i => i.identifiers), [
      'brandName', 'isBrandPrimary', 'brandName2', 'isBrand2Primary',
      'brandName3', 'isBrand3Primary', 'chargeNumber', 'labelDescription',
      'genericName', 'hcpcsCode', 'mnemonic', 'pyxisId', 'groupRxMnemonic',
    ], fields)
  } else if (tab === 'inventory') {
    checkFieldDiffs<InventoryInfo>(loaded.map(i => i.inventory), [
      'dispenseFrom', 'isReusable', 'inventoryFactor', 'inventoryBasePackageUnit',
    ], fields)
    const facSets = loaded.map(i =>
      JSON.stringify(Object.entries(i.inventory.facilities).filter(([, v]) => v).map(([k]) => k).sort())
    )
    if (new Set(facSets).size > 1) fields.add('facilities')
  } else if (tab === 'supply') {
    const ndcSets = loaded.map(i => new Set(i.supplyRecords.map(r => r.ndc)))
    const allNdcs = new Set(loaded.flatMap(i => i.supplyRecords.map(r => r.ndc)))
    for (const ndc of allNdcs) {
      if (!ndcSets.every(s => s.has(ndc))) { fields.add('ndcSet'); break }
    }
  }

  return { count: fields.size, fields }
}

export function buildFieldValueMap(
  domainKeys: string[],
  items: (FormularyItem | null)[],
): FieldValueMap {
  const map: FieldValueMap = {}

  const add = (fieldName: string, getValue: (item: FormularyItem) => string) => {
    const vals: DomainValue[] = []
    domainKeys.forEach((dk, i) => {
      const item = items[i]
      if (!item) return
      const [reg, env] = dk.split('_')
      const { bg, text } = getDomainColor(reg, env)
      vals.push({ domain: dk, bg, text, badge: getDomainBadge(reg, env), value: getValue(item) })
    })
    if (new Set(vals.map(v => v.value)).size > 1) map[fieldName] = vals
  }

  const bool = (v: boolean | undefined) => v ? 'Yes' : 'No'

  // Header
  add('description',  i => i.description ?? '')
  add('strength',     i => `${i.strength ?? ''} ${i.strengthUnit ?? ''}`.trim())
  add('strengthUnit', i => String(i.strengthUnit ?? ''))
  add('status',       i => i.status ?? '')
  add('genericName',  i => i.genericName ?? '')
  add('dosageForm',   i => i.dosageForm ?? '')
  add('legalStatus',  i => i.legalStatus ?? '')
  add('mnemonic',     i => i.mnemonic ?? '')

  // OE Defaults
  const oe = (f: keyof OeDefaults, fmt?: (v: unknown) => string) =>
    add(f as string, i => fmt ? fmt(i.oeDefaults?.[f]) : String(i.oeDefaults?.[f] ?? ''))
  oe('dose'); oe('route'); oe('frequency')
  oe('infuseOver'); oe('infuseOverUnit')
  oe('freetextRate'); oe('normalizedRate'); oe('normalizedRateUnit')
  oe('rate'); oe('rateUnit')
  oe('isPrn', v => bool(v as boolean)); oe('prnReason')
  oe('duration'); oe('durationUnit'); oe('stopType')
  oe('orderedAsSynonym'); oe('defaultFormat')
  oe('searchMedication', v => bool(v as boolean))
  oe('searchContinuous', v => bool(v as boolean))
  oe('searchIntermittent', v => bool(v as boolean))
  oe('notes1'); oe('notes2')
  oe('notes1AppliesToFill', v => bool(v as boolean))
  oe('notes1AppliesToLabel', v => bool(v as boolean))
  oe('notes1AppliesToMar', v => bool(v as boolean))
  oe('notes2AppliesToFill', v => bool(v as boolean))
  oe('notes2AppliesToLabel', v => bool(v as boolean))
  oe('notes2AppliesToMar', v => bool(v as boolean))

  // Dispense
  const dp = (f: keyof DispenseInfo, fmt?: (v: unknown) => string) =>
    add(f as string, i => fmt ? fmt(i.dispense?.[f]) : String(i.dispense?.[f] ?? ''))
  dp('strength'); dp('strengthUnit'); dp('volume'); dp('volumeUnit')
  dp('usedInTotalVolumeCalculation'); dp('dispenseQty'); dp('dispenseQtyUnit')
  dp('dispenseCategory')
  dp('isDivisible', v => bool(v as boolean))
  dp('isInfinitelyDivisible', v => bool(v as boolean))
  dp('minimumDoseQty'); dp('packageSize'); dp('packageUnit')
  dp('outerPackageSize'); dp('outerPackageUnit'); dp('basePackageUnit')
  dp('packageDispenseQty')
  dp('packageDispenseOnlyQtyNeeded', v => bool(v as boolean))
  dp('formularyStatus'); dp('priceSchedule'); dp('awpFactor')
  dp('defaultParDoses'); dp('maxParQty')

  // Clinical
  const cl = (f: keyof ClinicalInfo, fmt?: (v: unknown) => string) =>
    add(f as string, i => fmt ? fmt(i.clinical?.[f]) : String(i.clinical?.[f] ?? ''))
  cl('genericFormulationCode'); cl('drugFormulationCode')
  cl('suppressMultumAlerts', v => bool(v as boolean))
  cl('therapeuticClass'); cl('dcInteractionDays'); cl('dcDisplayDays'); cl('orderAlert1')

  // Identifiers
  const id = (f: keyof Identifiers, fmt?: (v: unknown) => string) =>
    add(f as string, i => fmt ? fmt(i.identifiers?.[f]) : String(i.identifiers?.[f] ?? ''))
  id('brandName'); id('isBrandPrimary', v => bool(v as boolean))
  id('brandName2'); id('isBrand2Primary', v => bool(v as boolean))
  id('brandName3'); id('isBrand3Primary', v => bool(v as boolean))
  id('chargeNumber'); id('labelDescription'); id('genericName')
  id('hcpcsCode'); id('mnemonic'); id('pyxisId'); id('groupRxMnemonic')

  // Inventory
  const inv = (f: keyof InventoryInfo, fmt?: (v: unknown) => string) =>
    add(f as string, i => fmt ? fmt(i.inventory?.[f]) : String(i.inventory?.[f] ?? ''))
  inv('dispenseFrom'); inv('isReusable', v => bool(v as boolean))
  inv('inventoryFactor'); inv('inventoryBasePackageUnit')
  add('facilities', i =>
    Object.entries(i.inventory?.facilities ?? {}).filter(([, v]) => v).map(([k]) => k).sort().join(', ')
  )

  // Supply
  add('ndcSet', i => i.supplyRecords?.map(r => r.ndc).sort().join(', ') ?? '')

  return map
}
