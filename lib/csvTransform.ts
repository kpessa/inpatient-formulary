export type Row = Record<string, string>

export interface GroupRow {
  domain: string
  region: string
  environment: string
  extracted_at: string
  group_id: string
  description: string
  generic_name: string
  mnemonic: string
  charge_number: string
  brand_name: string
  brand_name2: string
  brand_name3: string
  pyxis_id: string
  status: string
  formulary_status: string
  strength: string
  strength_unit: string
  dosage_form: string
  legal_status: string
  identifiers_json: string
  oe_defaults_json: string
  dispense_json: string
  clinical_json: string
  inventory_json: string
}

export interface SupplyRow {
  domain: string
  group_id: string
  ndc: string
  is_non_reference: number
  is_active: number
  manufacturer: string
  manufacturer_brand: string
  manufacturer_label_desc: string
  is_primary: number
  is_biological: number
  is_brand: number
  is_unit_dose: number
  awp_cost: number | null
  cost1: number | null
  cost2: number | null
  supply_json: string
}

export function str(row: Row, col: string): string {
  return row[col] ?? ''
}

export function bool(row: Row, col: string): boolean {
  return row[col] === '1'
}

export function num(row: Row, col: string): number | null {
  const v = row[col]
  if (v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function buildGroupRow(
  groupId: string,
  rows: Row[],
  domain: string,
  region: string,
  env: string,
  extractedAt: string
): GroupRow {
  const primaryRow = rows.find((r) => r['PRIMARY_IND'] === '1') ?? rows[0]

  const oeDefaults = {
    dose: str(primaryRow, 'DOSE'),
    referenceDose: str(primaryRow, 'REF_DOSE'),
    route: str(primaryRow, 'ROUTE'),
    frequency: str(primaryRow, 'FREQUENCY'),
    infuseOver: str(primaryRow, 'INFUSE_OVER'),
    infuseOverUnit: str(primaryRow, 'INFUSE_OVER_UNIT'),
    rate: str(primaryRow, 'RATE'),
    rateUnit: str(primaryRow, 'RATE_UNIT'),
    normalizedRate: str(primaryRow, 'NORMALIZED_RATE'),
    normalizedRateUnit: str(primaryRow, 'NORMALIZED_RATE_UNIT'),
    freetextRate: str(primaryRow, 'FREETEXT_RATE'),
    isPrn: bool(primaryRow, 'PRN'),
    prnReason: str(primaryRow, 'PRN_REASON'),
    duration: num(primaryRow, 'DURATION'),
    durationUnit: str(primaryRow, 'DURATION_UNIT'),
    stopType: str(primaryRow, 'STOP_TYPE'),
    orderedAsSynonym: str(primaryRow, 'ORDERED_AS_SYNONYM'),
    defaultFormat: str(primaryRow, 'DEF_FORMAT'),
    searchMedication: bool(primaryRow, 'SEARCH_MED'),
    searchContinuous: bool(primaryRow, 'SEARCH_CONT'),
    searchIntermittent: bool(primaryRow, 'SEARCH_INTERMIT'),
    notes1: str(primaryRow, 'NOTES1'),
    notes1AppliesToFill: bool(primaryRow, 'NOTES1_APPLIESTO_FILL'),
    notes1AppliesToLabel: bool(primaryRow, 'NOTES1_APPLIESTO_LABEL'),
    notes1AppliesToMar: bool(primaryRow, 'NOTES1_APPLIESTO_MAR'),
    notes2: str(primaryRow, 'NOTES2'),
    notes2AppliesToFill: bool(primaryRow, 'NOTES2_APPLIESTO_FILL'),
    notes2AppliesToLabel: bool(primaryRow, 'NOTES2_APPLIESTO_LABEL'),
    notes2AppliesToMar: bool(primaryRow, 'NOTES2_APPLIESTO_MAR'),
  }

  const dispense = {
    strength: num(primaryRow, 'STRENGTH'),
    strengthUnit: str(primaryRow, 'STRENGTH_UNIT'),
    volume: num(primaryRow, 'VOLUME'),
    volumeUnit: str(primaryRow, 'VOLUME_UNIT'),
    usedInTotalVolumeCalculation: bool(primaryRow, 'USED_IN_TOTAL_VOLUME_CALCULATION'),
    dispenseQty: num(primaryRow, 'DISPENSE_QTY'),
    dispenseQtyUnit: str(primaryRow, 'DISPENSE_QTY_UNIT'),
    dispenseCategory: str(primaryRow, 'DISPENSE_CATEGORY'),
    isDivisible: bool(primaryRow, 'DIVISIBLE_IND'),
    isInfinitelyDivisible: bool(primaryRow, 'INFINITE_DIV_IND'),
    minimumDoseQty: num(primaryRow, 'MINIMUM_DOSE_QTY'),
    packageSize: num(primaryRow, 'PKG_SIZE'),
    packageUnit: str(primaryRow, 'PKG_UNIT'),
    outerPackageSize: num(primaryRow, 'OUTER_PKG_SIZE'),
    outerPackageUnit: str(primaryRow, 'OUTER_PKG_UNIT'),
    basePackageUnit: str(primaryRow, 'BASE_PKG_UNIT'),
    packageDispenseQty: num(primaryRow, 'PKG_DISP_QTY'),
    packageDispenseOnlyQtyNeeded: bool(primaryRow, 'PKG_DISP_ONLY_QTY_NEED'),
    formularyStatus: str(primaryRow, 'FORMULARY_STATUS'),
    priceSchedule: str(primaryRow, 'PRICE_SCHEDULE'),
    awpFactor: num(primaryRow, 'AWP_FACTOR'),
    defaultParDoses: num(primaryRow, 'DEFAULT_PAR_DOSES'),
    maxParQty: num(primaryRow, 'MAX_PAR_QTY'),
  }

  const clinical = {
    genericFormulationCode: str(primaryRow, 'GENERIC_FORMULATION_CODE'),
    drugFormulationCode: str(primaryRow, 'DRUG_FORMULATION_CODE'),
    suppressMultumAlerts: bool(primaryRow, 'SUPPRESS_MULTUM_IND'),
    therapeuticClass: str(primaryRow, 'THERAPEUTIC_CLASS'),
    dcInteractionDays: num(primaryRow, 'DC_INTER_DAYS'),
    dcDisplayDays: num(primaryRow, 'DC_DISPLAY_DAYS'),
    orderAlert1: str(primaryRow, 'ORDER_ALERT_1'),
  }

  const allFacKeys = Object.keys(primaryRow).filter((k) => k.startsWith('FAC:'))
  const facilities: Record<string, boolean> = Object.fromEntries(
    allFacKeys.filter((k) => primaryRow[k] === '1').map((k) => [k.slice(4), true])
  )

  const inventory = {
    allFacilities: bool(primaryRow, 'ALL_FAC'),
    facilities,
    dispenseFrom: str(primaryRow, 'DISPENSE_FROM'),
    isReusable: bool(primaryRow, 'REUSABLE_IND'),
    inventoryFactor: num(primaryRow, 'INV_FACTOR'),
    inventoryBasePackageUnit: str(primaryRow, 'INV_BASE_PKG_UNIT'),
  }

  const identifiers = {
    brandName: str(primaryRow, 'BRAND_NAME'),
    isBrandPrimary: bool(primaryRow, 'BRAND_PRIMARY_IND'),
    brandName2: str(primaryRow, 'BRAND_NAME2'),
    isBrand2Primary: bool(primaryRow, 'BRAND2_PRIMARY_IND'),
    brandName3: str(primaryRow, 'BRAND_NAME3'),
    isBrand3Primary: bool(primaryRow, 'BRAND3_PRIMARY_IND'),
    chargeNumber: str(primaryRow, 'CHARGE_NBR'),
    labelDescription: str(primaryRow, 'LABEL_DESC'),
    genericName: str(primaryRow, 'GENERIC_NAME'),
    hcpcsCode: str(primaryRow, 'HCPCS'),
    mnemonic: str(primaryRow, 'MNEMONIC'),
    pyxisId: str(primaryRow, 'PYXIS'),
    groupRxMnemonic: str(primaryRow, 'GROUP_RX_MNEM'),
  }

  return {
    domain,
    region,
    environment: env,
    extracted_at: extractedAt,
    group_id: groupId,
    description: str(primaryRow, 'LABEL_DESC'),
    generic_name: str(primaryRow, 'GENERIC_NAME'),
    mnemonic: str(primaryRow, 'MNEMONIC'),
    charge_number: str(primaryRow, 'CHARGE_NBR'),
    brand_name: str(primaryRow, 'BRAND_NAME'),
    brand_name2: str(primaryRow, 'BRAND_NAME2'),
    brand_name3: str(primaryRow, 'BRAND_NAME3'),
    pyxis_id: str(primaryRow, 'PYXIS'),
    status: primaryRow['ACTIVE_IND'] === '1' ? 'Active' : 'Inactive',
    formulary_status: str(primaryRow, 'FORMULARY_STATUS'),
    strength: str(primaryRow, 'STRENGTH'),
    strength_unit: str(primaryRow, 'STRENGTH_UNIT'),
    dosage_form: str(primaryRow, 'FORM'),
    legal_status: str(primaryRow, 'LEGAL_STATUS'),
    identifiers_json: JSON.stringify(identifiers),
    oe_defaults_json: JSON.stringify(oeDefaults),
    dispense_json: JSON.stringify(dispense),
    clinical_json: JSON.stringify(clinical),
    inventory_json: JSON.stringify(inventory),
  }
}

export function buildSupplyRows(groupId: string, rows: Row[], domain: string): SupplyRow[] {
  return rows.map((row) => {
    const supplyExtra = {
      manufacturerGenericName: str(row, 'MANF_GENERIC'),
      manufacturerMnemonic: str(row, 'MANF_MNEMONIC'),
      manufacturerPyxisId: str(row, 'MANF_PYXIS'),
      manufacturerUb92: str(row, 'MANF_UB92'),
      manufacturerRxUniqueId: str(row, 'MANF_RX_UNIQUEID'),
      isManufacturerActive: bool(row, 'MANF_ACTIVE_IND'),
      manufacturerFormularyStatus: str(row, 'MANF_FORMULARY_STATUS'),
      rxDevices: [
        str(row, 'RXDEVICE1'),
        str(row, 'RXDEVICE2'),
        str(row, 'RXDEVICE3'),
        str(row, 'RXDEVICE4'),
        str(row, 'RXDEVICE5'),
      ],
      rxMisc: [
        str(row, 'RXMISC1'),
        str(row, 'RXMISC2'),
        str(row, 'RXMISC3'),
        str(row, 'RXMISC4'),
        str(row, 'RXMISC5'),
      ],
      rxUniqueId: str(row, 'RX UNIQUEID'),
    }

    return {
      domain,
      group_id: groupId,
      ndc: str(row, 'NDC'),
      is_non_reference: bool(row, 'NON_REF_IND') ? 1 : 0,
      is_active: bool(row, 'ACTIVE_IND') ? 1 : 0,
      manufacturer: str(row, 'MANUFACTURER'),
      manufacturer_brand: str(row, 'MANF_BRAND'),
      manufacturer_label_desc: str(row, 'MANF_LABEL_DESC'),
      is_primary: bool(row, 'PRIMARY_IND') ? 1 : 0,
      is_biological: bool(row, 'BIO_IND') ? 1 : 0,
      is_brand: row['BRAND_IND'] === 'B' ? 1 : 0,
      is_unit_dose: bool(row, 'UNIT_DOSE_IND') ? 1 : 0,
      awp_cost: num(row, 'COST:AWP'),
      cost1: num(row, 'COST:COST1'),
      cost2: num(row, 'COST:COST2'),
      supply_json: JSON.stringify(supplyExtra),
    }
  })
}
