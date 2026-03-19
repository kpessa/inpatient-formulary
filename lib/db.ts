import { createClient, type Client } from '@libsql/client'
import type {
  FormularyItem,
  OeDefaults,
  DispenseInfo,
  ClinicalInfo,
  InventoryInfo,
  Identifiers,
  SupplyRecord,
} from './types'

let _client: Client | null = null

export function getDb(): Client {
  if (!_client) {
    _client = createClient({
      url: process.env.DATABASE_URL ?? 'file:./data/formulary.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
  }
  return _client
}

export interface SearchResult {
  groupId: string
  description: string
  genericName: string
  strength: string
  strengthUnit: string
  dosageForm: string
  mnemonic: string
  status: 'Active' | 'Inactive'
  chargeNumber: string
  brandName: string
  formularyStatus: string
  pyxisId: string
  activeFacilities: string[]
  region: string
  environment: string
  searchMedication: boolean
  searchContinuous: boolean
  searchIntermittent: boolean
}

export interface SearchParams {
  q: string
  limit: number
  region?: string
  environment?: string
  showInactive: boolean
  facilities?: string | null
}

export async function searchFormulary({
  q,
  limit,
  region,
  environment,
  showInactive,
  facilities,
}: SearchParams): Promise<{ results: SearchResult[]; total: number }> {
  const db = getDb()
  const conditions: string[] = []
  const sqlArgs: (string | number)[] = []

  if (!showInactive) {
    conditions.push("status = 'Active'")
  }

  if (region) {
    conditions.push('region = ?')
    sqlArgs.push(region)
  }

  if (environment) {
    conditions.push('environment = ?')
    sqlArgs.push(environment)
  }

  if (q) {
    const isWildcard = q.includes('*')
    if (isWildcard) {
      // Translate * to SQL LIKE wildcard %
      const likeQ = q.replace(/\*/g, '%')
      conditions.push(
        '(description LIKE ? OR generic_name LIKE ? OR mnemonic LIKE ? OR ' +
        'charge_number LIKE ? OR brand_name LIKE ? OR brand_name2 LIKE ? OR ' +
        'brand_name3 LIKE ? OR pyxis_id LIKE ?)'
      )
      for (let i = 0; i < 8; i++) sqlArgs.push(likeQ)
    } else {
      // Substring match
      const sub = `%${q}%`
      conditions.push(
        '(description LIKE ? OR generic_name LIKE ? OR mnemonic LIKE ? OR ' +
        'charge_number LIKE ? OR brand_name LIKE ? OR brand_name2 LIKE ? OR ' +
        'brand_name3 LIKE ? OR pyxis_id LIKE ?)'
      )
      for (let i = 0; i < 8; i++) sqlArgs.push(sub)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Fast path: no facility filter → single SQL query with LIMIT
  if (!facilities) {
    const { rows } = await db.execute({
      sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                   dosage_form, mnemonic, status, charge_number, brand_name,
                   formulary_status, pyxis_id, oe_defaults_json, inventory_json, region, environment
            FROM formulary_groups ${where} LIMIT ?`,
      args: [...sqlArgs, limit],
    })
    const results: SearchResult[] = rows.map((row) => {
      const oe = JSON.parse((row.oe_defaults_json as string) || '{}') as {
        searchMedication?: boolean; searchContinuous?: boolean; searchIntermittent?: boolean
      }
      const inv = JSON.parse((row.inventory_json as string) || '{}') as {
        allFacilities: boolean
        facilities: Record<string, boolean>
      }
      const activeFacilities = Object.keys(inv.facilities ?? {}).filter(k => inv.facilities[k])
      return {
        groupId: row.group_id as string,
        description: row.description as string,
        genericName: row.generic_name as string,
        strength: row.strength as string,
        strengthUnit: row.strength_unit as string,
        dosageForm: row.dosage_form as string,
        mnemonic: row.mnemonic as string,
        status: row.status as 'Active' | 'Inactive',
        chargeNumber: row.charge_number as string,
        brandName: row.brand_name as string,
        formularyStatus: row.formulary_status as string,
        pyxisId: row.pyxis_id as string,
        activeFacilities,
        region: row.region as string,
        environment: row.environment as string,
        searchMedication: oe.searchMedication ?? false,
        searchContinuous: oe.searchContinuous ?? false,
        searchIntermittent: oe.searchIntermittent ?? false,
      }
    })
    // total = -1 signals "limit may have been hit" to the UI
    return { results, total: results.length === limit ? -1 : results.length }
  }

  // Slow path: facility filter active → fetch all rows, parse inventory_json, filter in JS
  const sql = `
    SELECT group_id, description, generic_name, strength, strength_unit,
           dosage_form, mnemonic, status, charge_number, brand_name,
           formulary_status, pyxis_id, oe_defaults_json, inventory_json, region, environment
    FROM formulary_groups
    ${where}
  `

  const { rows } = await db.execute({ sql, args: sqlArgs })

  type Mapped = SearchResult & { _allFacilities: boolean }
  let mapped: Mapped[] = rows.map((row) => {
    const inv = JSON.parse(row.inventory_json as string) as {
      allFacilities: boolean
      facilities: Record<string, boolean>
    }
    const oe = JSON.parse((row.oe_defaults_json as string) || '{}') as {
      searchMedication?: boolean; searchContinuous?: boolean; searchIntermittent?: boolean
    }
    const activeFacilities = Object.keys(inv.facilities).filter((k) => inv.facilities[k])
    return {
      groupId: row.group_id as string,
      description: row.description as string,
      genericName: row.generic_name as string,
      strength: row.strength as string,
      strengthUnit: row.strength_unit as string,
      dosageForm: row.dosage_form as string,
      mnemonic: row.mnemonic as string,
      status: row.status as 'Active' | 'Inactive',
      chargeNumber: row.charge_number as string,
      brandName: row.brand_name as string,
      formularyStatus: row.formulary_status as string,
      pyxisId: row.pyxis_id as string,
      activeFacilities,
      _allFacilities: inv.allFacilities,
      region: row.region as string,
      environment: row.environment as string,
      searchMedication: oe.searchMedication ?? false,
      searchContinuous: oe.searchContinuous ?? false,
      searchIntermittent: oe.searchIntermittent ?? false,
    }
  })

  const facs = facilities
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
  if (facs.length > 0) {
    mapped = mapped.filter(
      (item) => item._allFacilities || facs.some((f) => item.activeFacilities.includes(f))
    )
  }

  const total = mapped.length
  const results: SearchResult[] = mapped.slice(0, limit).map(({ _allFacilities, ...item }) => item)

  return { results, total }
}

export async function getAvailableDomains(): Promise<{ region: string; env: string; domain: string }[]> {
  const db = getDb()
  const { rows } = await db.execute(
    'SELECT DISTINCT region, environment, domain FROM formulary_groups ORDER BY region, environment'
  )
  return rows.map((r) => ({
    region: r.region as string,
    env: r.environment as string,
    domain: r.domain as string,
  }))
}

export async function getFormularyItem(
  groupId: string,
  domain?: string
): Promise<FormularyItem | null> {
  const db = getDb()

  const groupArgs: string[] = [groupId]
  let groupSql = 'SELECT * FROM formulary_groups WHERE group_id = ?'
  if (domain) {
    groupSql += ' AND domain = ?'
    groupArgs.push(domain)
  }
  groupSql += ' LIMIT 1'

  const { rows: groupRows } = await db.execute({ sql: groupSql, args: groupArgs })
  if (groupRows.length === 0) return null

  const g = groupRows[0]

  const supplyArgs: string[] = [groupId]
  let supplySql = 'SELECT * FROM supply_records WHERE group_id = ?'
  if (domain) {
    supplySql += ' AND domain = ?'
    supplyArgs.push(domain)
  }

  const { rows: supplyRows } = await db.execute({ sql: supplySql, args: supplyArgs })

  const supplyRecords: SupplyRecord[] = supplyRows.map((r) => {
    const extra = JSON.parse(r.supply_json as string)
    return {
      ndc: r.ndc as string,
      isNonReference: Boolean(r.is_non_reference),
      isActive: Boolean(r.is_active),
      manufacturer: r.manufacturer as string,
      manufacturerBrandName: r.manufacturer_brand as string,
      manufacturerLabelDescription: r.manufacturer_label_desc as string,
      manufacturerGenericName: extra.manufacturerGenericName ?? '',
      manufacturerMnemonic: extra.manufacturerMnemonic ?? '',
      manufacturerPyxisId: extra.manufacturerPyxisId ?? '',
      manufacturerUb92: extra.manufacturerUb92 ?? '',
      manufacturerRxUniqueId: extra.manufacturerRxUniqueId ?? '',
      isManufacturerActive: extra.isManufacturerActive ?? false,
      manufacturerFormularyStatus: extra.manufacturerFormularyStatus ?? '',
      isPrimary: Boolean(r.is_primary),
      isBiological: Boolean(r.is_biological),
      isBrand: Boolean(r.is_brand),
      isUnitDose: Boolean(r.is_unit_dose),
      awpCost: r.awp_cost as number | null,
      cost1: r.cost1 as number | null,
      cost2: r.cost2 as number | null,
      rxDevices: extra.rxDevices ?? [],
      rxMisc: extra.rxMisc ?? [],
      rxUniqueId: extra.rxUniqueId ?? '',
    }
  })

  return {
    groupId: g.group_id as string,
    description: g.description as string,
    strength: g.strength as string,
    strengthUnit: g.strength_unit as string,
    status: g.status as 'Active' | 'Inactive',
    genericName: g.generic_name as string,
    dosageForm: g.dosage_form as string,
    legalStatus: g.legal_status as string,
    mnemonic: g.mnemonic as string,
    oeDefaults: JSON.parse(g.oe_defaults_json as string) as OeDefaults,
    dispense: JSON.parse(g.dispense_json as string) as DispenseInfo,
    clinical: JSON.parse(g.clinical_json as string) as ClinicalInfo,
    inventory: JSON.parse(g.inventory_json as string) as InventoryInfo,
    identifiers: JSON.parse(g.identifiers_json as string) as Identifiers,
    supplyRecords,
  }
}
