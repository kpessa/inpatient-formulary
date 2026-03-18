import fs from "fs"
import path from "path"
import Papa from "papaparse"
import type {
  FormularyItem,
  OeDefaults,
  DispenseInfo,
  ClinicalInfo,
  InventoryInfo,
  SupplyRecord,
  Identifiers,
} from "./types"

type Row = Record<string, string>

let _cache: FormularyItem[] | null = null

export async function parseFormulary(): Promise<FormularyItem[]> {
  if (_cache) return _cache

  const buf = fs.readFileSync(
    path.join(process.cwd(), "data", "c152e_extract.csv")
  )
  const text = buf.toString("latin1")

  const { data } = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
  })

  // Group rows by GROUP_ID maintaining insertion order
  const groups = new Map<string, Row[]>()
  for (const row of data) {
    const gid = row["GROUP_ID"] ?? ""
    if (!gid) continue
    const existing = groups.get(gid)
    if (existing) {
      existing.push(row)
    } else {
      groups.set(gid, [row])
    }
  }

  _cache = Array.from(groups.entries()).map(([groupId, rows]) =>
    buildFormularyItem(groupId, rows)
  )
  return _cache
}

function str(row: Row, col: string): string {
  return row[col] ?? ""
}

function bool(row: Row, col: string): boolean {
  return row[col] === "1"
}

function num(row: Row, col: string): number | null {
  const v = row[col]
  if (v === undefined || v === "") return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function buildFormularyItem(groupId: string, rows: Row[]): FormularyItem {
  // Use primary row (PRIMARY_IND === "1") for header fields, fall back to rows[0]
  const primaryRow = rows.find((r) => r["PRIMARY_IND"] === "1") ?? rows[0]

  const oeDefaults: OeDefaults = {
    dose: str(primaryRow, "DOSE"),
    referenceDose: str(primaryRow, "REF_DOSE"),
    route: str(primaryRow, "ROUTE"),
    frequency: str(primaryRow, "FREQUENCY"),
    infuseOver: str(primaryRow, "INFUSE_OVER"),
    infuseOverUnit: str(primaryRow, "INFUSE_OVER_UNIT"),
    rate: str(primaryRow, "RATE"),
    rateUnit: str(primaryRow, "RATE_UNIT"),
    normalizedRate: str(primaryRow, "NORMALIZED_RATE"),
    normalizedRateUnit: str(primaryRow, "NORMALIZED_RATE_UNIT"),
    freetextRate: str(primaryRow, "FREETEXT_RATE"),
    isPrn: bool(primaryRow, "PRN"),
    prnReason: str(primaryRow, "PRN_REASON"),
    duration: num(primaryRow, "DURATION"),
    durationUnit: str(primaryRow, "DURATION_UNIT"),
    stopType: str(primaryRow, "STOP_TYPE"),
    orderedAsSynonym: str(primaryRow, "ORDERED_AS_SYNONYM"),
    defaultFormat: str(primaryRow, "DEF_FORMAT"),
    searchMedication: bool(primaryRow, "SEARCH_MED"),
    searchContinuous: bool(primaryRow, "SEARCH_CONT"),
    searchIntermittent: bool(primaryRow, "SEARCH_INTERMIT"),
    notes1: str(primaryRow, "NOTES1"),
    notes1AppliesToFill: bool(primaryRow, "NOTES1_APPLIESTO_FILL"),
    notes1AppliesToLabel: bool(primaryRow, "NOTES1_APPLIESTO_LABEL"),
    notes1AppliesToMar: bool(primaryRow, "NOTES1_APPLIESTO_MAR"),
    notes2: str(primaryRow, "NOTES2"),
    notes2AppliesToFill: bool(primaryRow, "NOTES2_APPLIESTO_FILL"),
    notes2AppliesToLabel: bool(primaryRow, "NOTES2_APPLIESTO_LABEL"),
    notes2AppliesToMar: bool(primaryRow, "NOTES2_APPLIESTO_MAR"),
  }

  const dispense: DispenseInfo = {
    strength: num(primaryRow, "STRENGTH"),
    strengthUnit: str(primaryRow, "STRENGTH_UNIT"),
    volume: num(primaryRow, "VOLUME"),
    volumeUnit: str(primaryRow, "VOLUME_UNIT"),
    usedInTotalVolumeCalculation: bool(primaryRow, "USED_IN_TOTAL_VOLUME_CALCULATION"),
    dispenseQty: num(primaryRow, "DISPENSE_QTY"),
    dispenseQtyUnit: str(primaryRow, "DISPENSE_QTY_UNIT"),
    dispenseCategory: str(primaryRow, "DISPENSE_CATEGORY"),
    isDivisible: bool(primaryRow, "DIVISIBLE_IND"),
    isInfinitelyDivisible: bool(primaryRow, "INFINITE_DIV_IND"),
    minimumDoseQty: num(primaryRow, "MINIMUM_DOSE_QTY"),
    packageSize: num(primaryRow, "PKG_SIZE"),
    packageUnit: str(primaryRow, "PKG_UNIT"),
    outerPackageSize: num(primaryRow, "OUTER_PKG_SIZE"),
    outerPackageUnit: str(primaryRow, "OUTER_PKG_UNIT"),
    basePackageUnit: str(primaryRow, "BASE_PKG_UNIT"),
    packageDispenseQty: num(primaryRow, "PKG_DISP_QTY"),
    packageDispenseOnlyQtyNeeded: bool(primaryRow, "PKG_DISP_ONLY_QTY_NEED"),
    formularyStatus: str(primaryRow, "FORMULARY_STATUS"),
    priceSchedule: str(primaryRow, "PRICE_SCHEDULE"),
    awpFactor: num(primaryRow, "AWP_FACTOR"),
    defaultParDoses: num(primaryRow, "DEFAULT_PAR_DOSES"),
    maxParQty: num(primaryRow, "MAX_PAR_QTY"),
  }

  const clinical: ClinicalInfo = {
    genericFormulationCode: str(primaryRow, "GENERIC_FORMULATION_CODE"),
    drugFormulationCode: str(primaryRow, "DRUG_FORMULATION_CODE"),
    suppressMultumAlerts: bool(primaryRow, "SUPPRESS_MULTUM_IND"),
    therapeuticClass: str(primaryRow, "THERAPEUTIC_CLASS"),
    dcInteractionDays: num(primaryRow, "DC_INTER_DAYS"),
    dcDisplayDays: num(primaryRow, "DC_DISPLAY_DAYS"),
    orderAlert1: str(primaryRow, "ORDER_ALERT_1"),
  }

  const allFacKeys = Object.keys(primaryRow).filter((k) => k.startsWith("FAC:"))
  const facilities: Record<string, boolean> = Object.fromEntries(
    allFacKeys
      .filter((k) => primaryRow[k] === "1")
      .map((k) => [k.slice(4), true])
  )

  const inventory: InventoryInfo = {
    allFacilities: bool(primaryRow, "ALL_FAC"),
    facilities,
    dispenseFrom: str(primaryRow, "DISPENSE_FROM"),
    isReusable: bool(primaryRow, "REUSABLE_IND"),
    inventoryFactor: num(primaryRow, "INV_FACTOR"),
    inventoryBasePackageUnit: str(primaryRow, "INV_BASE_PKG_UNIT"),
  }

  const identifiers: Identifiers = {
    brandName: str(primaryRow, "BRAND_NAME"),
    isBrandPrimary: bool(primaryRow, "BRAND_PRIMARY_IND"),
    brandName2: str(primaryRow, "BRAND_NAME2"),
    isBrand2Primary: bool(primaryRow, "BRAND2_PRIMARY_IND"),
    brandName3: str(primaryRow, "BRAND_NAME3"),
    isBrand3Primary: bool(primaryRow, "BRAND3_PRIMARY_IND"),
    chargeNumber: str(primaryRow, "CHARGE_NBR"),
    labelDescription: str(primaryRow, "LABEL_DESC"),
    genericName: str(primaryRow, "GENERIC_NAME"),
    hcpcsCode: str(primaryRow, "HCPCS"),
    mnemonic: str(primaryRow, "MNEMONIC"),
    pyxisId: str(primaryRow, "PYXIS"),
    groupRxMnemonic: str(primaryRow, "GROUP_RX_MNEM"),
  }

  const supplyRecords: SupplyRecord[] = rows.map((row) => ({
    ndc: str(row, "NDC"),
    isNonReference: bool(row, "NON_REF_IND"),
    isActive: bool(row, "ACTIVE_IND"),
    manufacturer: str(row, "MANUFACTURER"),
    manufacturerBrandName: str(row, "MANF_BRAND"),
    manufacturerLabelDescription: str(row, "MANF_LABEL_DESC"),
    manufacturerGenericName: str(row, "MANF_GENERIC"),
    manufacturerMnemonic: str(row, "MANF_MNEMONIC"),
    manufacturerPyxisId: str(row, "MANF_PYXIS"),
    manufacturerUb92: str(row, "MANF_UB92"),
    manufacturerRxUniqueId: str(row, "MANF_RX_UNIQUEID"),
    isManufacturerActive: bool(row, "MANF_ACTIVE_IND"),
    manufacturerFormularyStatus: str(row, "MANF_FORMULARY_STATUS"),
    isPrimary: bool(row, "PRIMARY_IND"),
    isBiological: bool(row, "BIO_IND"),
    isBrand: row["BRAND_IND"] === "B",
    isUnitDose: bool(row, "UNIT_DOSE_IND"),
    awpCost: num(row, "COST:AWP"),
    cost1: num(row, "COST:COST1"),
    cost2: num(row, "COST:COST2"),
    rxDevices: [
      str(row, "RXDEVICE1"),
      str(row, "RXDEVICE2"),
      str(row, "RXDEVICE3"),
      str(row, "RXDEVICE4"),
      str(row, "RXDEVICE5"),
    ],
    rxMisc: [
      str(row, "RXMISC1"),
      str(row, "RXMISC2"),
      str(row, "RXMISC3"),
      str(row, "RXMISC4"),
      str(row, "RXMISC5"),
    ],
    rxUniqueId: str(row, "RX UNIQUEID"),
  }))

  return {
    groupId,
    description: str(primaryRow, "LABEL_DESC"),
    strength: str(primaryRow, "STRENGTH"),
    strengthUnit: str(primaryRow, "STRENGTH_UNIT"),
    status: primaryRow["ACTIVE_IND"] === "1" ? "Active" : "Inactive",
    genericName: str(primaryRow, "GENERIC_NAME"),
    dosageForm: str(primaryRow, "FORM"),
    legalStatus: str(primaryRow, "LEGAL_STATUS"),
    mnemonic: str(primaryRow, "MNEMONIC"),
    oeDefaults,
    dispense,
    clinical,
    inventory,
    identifiers,
    supplyRecords,
  }
}
