import { createClient, type Client, type Row } from '@libsql/client'
import type {
  FormularyItem,
  OeDefaults,
  DispenseInfo,
  ClinicalInfo,
  InventoryInfo,
  Identifiers,
  SupplyRecord,
} from './types'

const AUTO_FETCH_MAX = 500

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
  colFilters?: Record<string, { text?: string; vals?: string[] }>
}

// Maps SearchModal column IDs to their DB column names for server-side filtering.
// "strength" selected values → dosage_form; text → searches both strength fields + dosage_form.
const COL_DB: Record<string, string> = {
  description: 'description',
  generic:     'generic_name',
  mnemonic:    'mnemonic',
  charge:      'charge_number',
  pyxis:       'pyxis_id',
  brand:       'brand_name',
}

export async function searchFormulary({
  q,
  limit,
  region,
  environment,
  showInactive,
  facilities,
  colFilters,
  onCount,
}: SearchParams & { onCount?: (n: number) => void }): Promise<{ results: SearchResult[]; total: number }> {
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

  if (colFilters) {
    for (const [colId, filter] of Object.entries(colFilters)) {
      if (colId === 'strength') {
        if (filter.text) {
          const like = `%${filter.text}%`
          conditions.push('(strength LIKE ? OR strength_unit LIKE ? OR dosage_form LIKE ?)')
          sqlArgs.push(like, like, like)
        }
        if (filter.vals && filter.vals.length > 0) {
          conditions.push(`dosage_form IN (${filter.vals.map(() => '?').join(',')})`)
          sqlArgs.push(...filter.vals)
        }
      } else {
        const dbField = COL_DB[colId]
        if (!dbField) continue
        if (filter.text) {
          conditions.push(`${dbField} LIKE ?`)
          sqlArgs.push(`%${filter.text}%`)
        }
        if (filter.vals && filter.vals.length > 0) {
          conditions.push(`${dbField} IN (${filter.vals.map(() => '?').join(',')})`)
          sqlArgs.push(...filter.vals)
        }
      }
    }
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
      // Prefix match
      const sub = `${q}%`
      conditions.push(
        '(description LIKE ? OR generic_name LIKE ? OR mnemonic LIKE ? OR ' +
        'charge_number LIKE ? OR brand_name LIKE ? OR brand_name2 LIKE ? OR ' +
        'brand_name3 LIKE ? OR pyxis_id LIKE ?)'
      )
      for (let i = 0; i < 8; i++) sqlArgs.push(sub)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Fast path: no facility filter — batch COUNT + SELECT in one round-trip
  if (!facilities) {
    const [{ rows: countRows }, { rows }] = await db.batch([
      { sql: `SELECT COUNT(*) AS cnt FROM formulary_groups ${where}`, args: sqlArgs },
      { sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                     dosage_form, mnemonic, status, charge_number, brand_name,
                     formulary_status, pyxis_id, oe_defaults_json, inventory_json, region, environment
              FROM formulary_groups ${where} LIMIT ?`,
        args: [...sqlArgs, AUTO_FETCH_MAX] },
    ], 'read')
    const count = Number(countRows[0].cnt)
    onCount?.(count)
    const finalRows = count > AUTO_FETCH_MAX ? rows.slice(0, limit) : rows
    const results: SearchResult[] = finalRows.map(mapRow)
    return { results, total: count }
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
    return { ...mapRow(row), _allFacilities: inv.allFacilities }
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
  onCount?.(total)
  const results: SearchResult[] = (total > AUTO_FETCH_MAX ? mapped.slice(0, limit) : mapped)
    .map(({ _allFacilities, ...item }) => item)

  return { results, total }
}

// Shared row-mapping helper used by both searchFormulary and searchByField
function mapRow(row: Row): SearchResult {
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
}

export interface FieldSearchParams {
  field: 'description' | 'generic_name' | 'mnemonic' | 'charge_number' | 'pyxis_id' | 'brand_name' | 'ndc'
  q: string
  region?: string
  environment?: string
  showInactive: boolean
  limit: number
}

export async function searchByField(params: FieldSearchParams): Promise<SearchResult[]> {
  const client = getDb()
  const conditions: string[] = []
  const sqlArgs: (string | number)[] = []

  if (params.field === 'ndc') {
    const ndcConditions: string[] = [`sr.ndc LIKE ?`]
    const ndcArgs: (string | number)[] = [`${params.q}%`]
    if (!params.showInactive) ndcConditions.push("fg.status = 'Active'")
    if (params.region)      { ndcConditions.push('fg.region = ?');      ndcArgs.push(params.region) }
    if (params.environment) { ndcConditions.push('fg.environment = ?'); ndcArgs.push(params.environment) }
    ndcArgs.push(params.limit)
    const { rows } = await client.execute({
      sql: `SELECT DISTINCT fg.group_id, fg.description, fg.generic_name, fg.strength,
                   fg.strength_unit, fg.dosage_form, fg.mnemonic, fg.status,
                   fg.charge_number, fg.brand_name, fg.formulary_status,
                   fg.pyxis_id, fg.oe_defaults_json, fg.inventory_json, fg.region, fg.environment
            FROM supply_records sr
            JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
            WHERE ${ndcConditions.join(' AND ')}
            LIMIT ?`,
      args: ndcArgs,
    })
    return rows.map(mapRow)
  }

  if (!params.showInactive) conditions.push("status = 'Active'")
  if (params.region)      { conditions.push('region = ?');      sqlArgs.push(params.region) }
  if (params.environment) { conditions.push('environment = ?'); sqlArgs.push(params.environment) }

  if (params.field === 'brand_name') {
    conditions.push('(brand_name LIKE ? OR brand_name2 LIKE ? OR brand_name3 LIKE ?)')
    const prefix = `${params.q}%`
    sqlArgs.push(prefix, prefix, prefix)
  } else {
    conditions.push(`${params.field} LIKE ?`)
    sqlArgs.push(`${params.q}%`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const { rows } = await client.execute({
    sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                 dosage_form, mnemonic, status, charge_number, brand_name,
                 formulary_status, pyxis_id, oe_defaults_json, inventory_json, region, environment
          FROM formulary_groups ${where} LIMIT ?`,
    args: [...sqlArgs, params.limit],
  })
  return rows.map(mapRow)
}

// Multi-field search: runs all simple fields as a single UNION ALL (one Turso round-trip),
// plus a separate query for NDC (which requires a JOIN). Avoids the serialization penalty
// of multiple execute() calls on the singleton connection.
const VALID_FIELDS = new Set<string>(['description', 'generic_name', 'mnemonic', 'charge_number', 'pyxis_id', 'brand_name', 'ndc'])

export async function searchByFields(
  fields: FieldSearchParams['field'][],
  q: string,
  region: string | undefined,
  environment: string | undefined,
  showInactive: boolean,
  limit: number,
): Promise<Record<string, SearchResult[]>> {
  const db = getDb()
  const safeFields = fields.filter(f => VALID_FIELDS.has(f))
  const simpleFields = safeFields.filter(f => f !== 'ndc')
  const hasNdc = safeFields.includes('ndc')

  const result: Record<string, SearchResult[]> = {}

  if (simpleFields.length > 0) {
    const parts: string[] = []
    const args: (string | number)[] = []

    for (const field of simpleFields) {
      const conds: string[] = []
      const fieldArgs: (string | number)[] = []

      if (!showInactive) conds.push("status = 'Active'")
      if (region)      { conds.push('region = ?');      fieldArgs.push(region) }
      if (environment) { conds.push('environment = ?'); fieldArgs.push(environment) }

      if (field === 'brand_name') {
        conds.push('(brand_name LIKE ? OR brand_name2 LIKE ? OR brand_name3 LIKE ?)')
        const prefix = `${q}%`
        fieldArgs.push(prefix, prefix, prefix)
      } else {
        conds.push(`${field} LIKE ?`)
        fieldArgs.push(`${q}%`)
      }

      const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
      // Embed field name as SQL string literal (field is validated against VALID_FIELDS above)
      parts.push(
        `SELECT * FROM (SELECT '${field}' AS _field, group_id, description, generic_name, strength, ` +
        `strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, ` +
        `formulary_status, pyxis_id, oe_defaults_json, inventory_json, region, environment ` +
        `FROM formulary_groups ${where} LIMIT ${limit})`
      )
      args.push(...fieldArgs)
    }

    const { rows } = await db.execute({ sql: parts.join('\nUNION ALL\n'), args })
    for (const f of simpleFields) result[f] = []
    for (const row of rows) {
      const f = row._field as string
      result[f].push(mapRow(row))
    }
  }

  if (hasNdc) {
    const ndcConds: string[] = ['sr.ndc LIKE ?']
    const ndcArgs: (string | number)[] = [`${q}%`]
    if (!showInactive) ndcConds.push("fg.status = 'Active'")
    if (region)      { ndcConds.push('fg.region = ?');      ndcArgs.push(region) }
    if (environment) { ndcConds.push('fg.environment = ?'); ndcArgs.push(environment) }
    ndcArgs.push(limit)
    const { rows } = await db.execute({
      sql: `SELECT DISTINCT fg.group_id, fg.description, fg.generic_name, fg.strength,
                   fg.strength_unit, fg.dosage_form, fg.mnemonic, fg.status,
                   fg.charge_number, fg.brand_name, fg.formulary_status,
                   fg.pyxis_id, fg.oe_defaults_json, fg.inventory_json, fg.region, fg.environment
            FROM supply_records sr
            JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
            WHERE ${ndcConds.join(' AND ')}
            LIMIT ?`,
      args: ndcArgs,
    })
    result['ndc'] = rows.map(mapRow)
  }

  return result
}

export async function fetchInventoryByGroupIds(
  groupIds: string[],
  region?: string,
  environment?: string,
): Promise<Record<string, {
  activeFacilities: string[]
  searchMedication: boolean
  searchContinuous: boolean
  searchIntermittent: boolean
}>> {
  if (groupIds.length === 0) return {}
  const db = getDb()
  const placeholders = groupIds.map(() => '?').join(',')
  const conditions = [`group_id IN (${placeholders})`]
  const args: (string | number)[] = [...groupIds]
  if (region)      { conditions.push('region = ?');      args.push(region) }
  if (environment) { conditions.push('environment = ?'); args.push(environment) }

  const { rows } = await db.execute({
    sql: `SELECT group_id, inventory_json, oe_defaults_json
          FROM formulary_groups WHERE ${conditions.join(' AND ')}`,
    args,
  })
  const result: Record<string, { activeFacilities: string[]; searchMedication: boolean; searchContinuous: boolean; searchIntermittent: boolean }> = {}
  for (const row of rows) {
    const gid = row.group_id as string
    if (result[gid]) continue  // first match wins (handles multi-domain case)
    const inv = JSON.parse((row.inventory_json as string) || '{}') as { allFacilities: boolean; facilities: Record<string, boolean> }
    const oe  = JSON.parse((row.oe_defaults_json as string) || '{}') as { searchMedication?: boolean; searchContinuous?: boolean; searchIntermittent?: boolean }
    result[gid] = {
      activeFacilities: Object.keys(inv.facilities ?? {}).filter(k => inv.facilities[k]),
      searchMedication:   oe.searchMedication   ?? false,
      searchContinuous:   oe.searchContinuous   ?? false,
      searchIntermittent: oe.searchIntermittent ?? false,
    }
  }
  return result
}

export async function getDistinctFacilities(): Promise<string[]> {
  const db = getDb()
  const { rows } = await db.execute(`
    SELECT DISTINCT je.key AS facility
    FROM formulary_groups, json_each(json_extract(inventory_json, '$.facilities')) AS je
    WHERE je.value = 1
    ORDER BY je.key
  `)
  return rows.map(r => r.facility as string)
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
