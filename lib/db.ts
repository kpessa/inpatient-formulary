import { createClient, type Client, type Row } from '@libsql/client'
import { randomUUID } from 'crypto'
import type {
  FormularyItem,
  OeDefaults,
  DispenseInfo,
  ClinicalInfo,
  InventoryInfo,
  Identifiers,
  SupplyRecord,
  FieldOverride,
} from './types'
import { applyOverrides } from './overlay'

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

export interface AdvancedFilters {
  dosageFormInclude?: string[]            // exact dosage_form values; OR'd with IN(...)
  dosageFormExclude?: string[]            // NOT IN(...)
  therapeuticClassCodes?: string[]        // [code, ...descendants]; IN(...)
  therapeuticClassExcludeCodes?: string[] // [code, ...descendants]; NOT IN(...)
  dispenseCategoryInclude?: string[]      // exact dispense_category values; IN(...)
  dispenseCategoryExclude?: string[]      // NOT IN(...)
  routeInclude?: string[]                 // exact route values; IN(...)
  routeExclude?: string[]                 // NOT IN(...)
}

export interface SearchParams {
  q: string
  limit: number
  region?: string
  environment?: string
  showInactive: boolean
  facilities?: string | null
  colFilters?: Record<string, { text?: string; vals?: string[] }>
  advancedFilters?: AdvancedFilters
  /** Restrict text search to a single DB column (e.g. 'description') instead of all 8 fields */
  field?: string
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

function buildAdvancedClauses(
  adv: AdvancedFilters,
  conditions: string[],
  sqlArgs: (string | number)[],
) {
  if (adv.dosageFormInclude?.length) {
    conditions.push(`dosage_form IN (${adv.dosageFormInclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.dosageFormInclude)
  }
  if (adv.dosageFormExclude?.length) {
    conditions.push(`dosage_form NOT IN (${adv.dosageFormExclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.dosageFormExclude)
  }
  if (adv.therapeuticClassCodes?.length) {
    conditions.push(`therapeutic_class IN (${adv.therapeuticClassCodes.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.therapeuticClassCodes)
  }
  if (adv.therapeuticClassExcludeCodes?.length) {
    conditions.push(`therapeutic_class NOT IN (${adv.therapeuticClassExcludeCodes.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.therapeuticClassExcludeCodes)
  }
  if (adv.dispenseCategoryInclude?.length) {
    conditions.push(`dispense_category IN (${adv.dispenseCategoryInclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.dispenseCategoryInclude)
  }
  if (adv.dispenseCategoryExclude?.length) {
    conditions.push(`dispense_category NOT IN (${adv.dispenseCategoryExclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.dispenseCategoryExclude)
  }
  if (adv.routeInclude?.length) {
    conditions.push(`route IN (${adv.routeInclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.routeInclude)
  }
  if (adv.routeExclude?.length) {
    conditions.push(`route NOT IN (${adv.routeExclude.map(() => '?').join(',')})`)
    sqlArgs.push(...adv.routeExclude)
  }
}

// Maps field alias → DB column name (or json_extract expression) for single-field search scoping
const FIELD_DB_COL: Record<string, string> = {
  description:      'description',
  generic:          'generic_name',
  genericName:      'generic_name',
  mnemonic:         'mnemonic',
  brand:            'brand_name',
  brandName:        'brand_name',
  charge:           'charge_number',
  chargeNumber:     'charge_number',
  pyxis:            'pyxis_id',
  pyxisId:          'pyxis_id',
  dosageForm:       'dosage_form',
  strength:         'strength',
  status:           'status',
  formularyStatus:  'formulary_status',
  dose:             "json_extract(oe_defaults_json, '$.dose')",
  route:            "json_extract(oe_defaults_json, '$.route')",
  frequency:        "json_extract(oe_defaults_json, '$.frequency')",
  stopType:         "json_extract(oe_defaults_json, '$.stopType')",
  notes1:           "json_extract(oe_defaults_json, '$.notes1')",
  notes2:           "json_extract(oe_defaults_json, '$.notes2')",
  prnReason:        "json_extract(oe_defaults_json, '$.prnReason')",
  dispenseCategory: "json_extract(dispense_json, '$.dispenseCategory')",
  therapeuticClass: "json_extract(clinical_json, '$.therapeuticClass')",
  orderAlert1:      "json_extract(clinical_json, '$.orderAlert1')",
}

export async function searchFormulary({
  q,
  limit,
  region,
  environment,
  showInactive,
  facilities,
  colFilters,
  advancedFilters,
  field,
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
    const inMatch = q.match(/^IN\(([^)]+)\)$/i)
    const scopedCol = field ? FIELD_DB_COL[field] : null
    if (inMatch && scopedCol) {
      // IN query: comma-separated values, case-insensitive
      const inVals = inMatch[1].split(',').map(v => v.trim()).filter(Boolean)
      conditions.push(`LOWER(${scopedCol}) IN (${inVals.map(() => '?').join(',')})`)
      sqlArgs.push(...inVals.map(v => v.toLowerCase()))
    } else {
      const isWildcard = q.includes('*')
      const likeQ = isWildcard ? q.replace(/\*/g, '%') : `${q}%`
      if (scopedCol) {
        // Single-field scoped search (case-insensitive)
        conditions.push(`LOWER(${scopedCol}) LIKE ?`)
        sqlArgs.push(likeQ)
      } else {
        // All-field search (default, case-insensitive)
        conditions.push(
          '(LOWER(description) LIKE ? OR LOWER(generic_name) LIKE ? OR LOWER(mnemonic) LIKE ? OR ' +
          'LOWER(charge_number) LIKE ? OR LOWER(brand_name) LIKE ? OR LOWER(brand_name2) LIKE ? OR ' +
          'LOWER(brand_name3) LIKE ? OR LOWER(pyxis_id) LIKE ?)'
        )
        for (let i = 0; i < 8; i++) sqlArgs.push(likeQ)
      }
    }
  }

  if (advancedFilters) buildAdvancedClauses(advancedFilters, conditions, sqlArgs)

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Fast path: no facility filter — batch COUNT + SELECT in one round-trip.
  // JSON blobs (oe_defaults_json, inventory_json) are omitted here; the client
  // fetches them via /api/formulary/inventory after displaying initial results.
  if (!facilities) {
    const [{ rows: countRows }, { rows }] = await db.batch([
      { sql: `SELECT COUNT(*) AS cnt FROM formulary_groups ${where}`, args: sqlArgs },
      { sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                     dosage_form, mnemonic, status, charge_number, brand_name,
                     formulary_status, pyxis_id, region, environment
              FROM formulary_groups ${where} LIMIT ?`,
        args: [...sqlArgs, AUTO_FETCH_MAX] },
    ], 'read')
    const count = Number(countRows[0].cnt)
    onCount?.(count)
    const finalRows = count > AUTO_FETCH_MAX ? rows.slice(0, limit) : rows
    const results: SearchResult[] = finalRows.map(mapRow)
    return { results, total: count }
  }

  // Slow path: facility filter active → fetch all rows, parse inventory_json, filter in JS.
  // inventory_json is needed here for filtering; activeFacilities is populated from it
  // so the facility column shows immediately (no secondary fetch needed for this path).
  const sql = `
    SELECT group_id, description, generic_name, strength, strength_unit,
           dosage_form, mnemonic, status, charge_number, brand_name,
           formulary_status, pyxis_id, inventory_json, region, environment
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
    const activeFacilities = Object.keys(inv.facilities ?? {}).filter(k => inv.facilities[k])
    return { ...mapRow(row), activeFacilities, _allFacilities: inv.allFacilities ?? false }
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

// Shared row-mapping helper — returns scalar fields only.
// activeFacilities and search flags are empty/false; the client fills them
// in via a secondary /api/formulary/inventory call.
function mapRow(row: Row): SearchResult {
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
    region: row.region as string,
    environment: row.environment as string,
    activeFacilities: [],
    searchMedication: false,
    searchContinuous: false,
    searchIntermittent: false,
  }
}

export async function searchByPyxisIds(
  pyxisIds: string[],
  region?: string,
  environment?: string,
): Promise<SearchResult[]> {
  if (pyxisIds.length === 0) return []
  const db = getDb()
  const placeholders = pyxisIds.map(() => '?').join(',')
  const conditions: string[] = [`pyxis_id IN (${placeholders})`]
  const args: (string | number)[] = [...pyxisIds]
  if (region)      { conditions.push('region = ?');      args.push(region) }
  if (environment) { conditions.push('environment = ?'); args.push(environment) }
  const { rows } = await db.execute({
    sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                 dosage_form, mnemonic, status, charge_number, brand_name,
                 formulary_status, pyxis_id, region, environment
          FROM formulary_groups
          WHERE ${conditions.join(' AND ')}
          ORDER BY description`,
    args,
  })
  return rows.map(mapRow)
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
    const ndcLo = params.q
    const ndcHi = nextPrefix(params.q)
    const ndcConditions: string[] = ['sr.ndc >= ? AND sr.ndc < ? AND sr.ndc LIKE ?']
    const ndcArgs: (string | number)[] = [ndcLo, ndcHi, `${params.q}%`]
    // status filter omitted — client filters via showInactive; avoids blocking idx_sr_ndc
    if (params.region)      { ndcConditions.push('fg.region = ?');      ndcArgs.push(params.region) }
    if (params.environment) { ndcConditions.push('fg.environment = ?'); ndcArgs.push(params.environment) }
    ndcArgs.push(params.limit)
    const { rows } = await client.execute({
      sql: `SELECT DISTINCT fg.group_id, fg.description, fg.generic_name, fg.strength,
                   fg.strength_unit, fg.dosage_form, fg.mnemonic, fg.status,
                   fg.charge_number, fg.brand_name, fg.formulary_status,
                   fg.pyxis_id, fg.region, fg.environment
            FROM supply_records sr
            JOIN formulary_groups fg ON fg.group_id = sr.group_id AND fg.domain = sr.domain
            WHERE ${ndcConditions.join(' AND ')}
            LIMIT ?`,
      args: ndcArgs,
    })
    return rows.map(mapRow)
  }

  // status filter omitted — client filters via showInactive; avoids blocking the field index
  if (params.region)      { conditions.push('region = ?');      sqlArgs.push(params.region) }
  if (params.environment) { conditions.push('environment = ?'); sqlArgs.push(params.environment) }

  const lo = params.q
  const hi = nextPrefix(params.q)
  const likeQ = `${params.q}%`
  const needsLower = params.field !== 'charge_number' && params.field !== 'pyxis_id'
  if (params.field === 'brand_name') {
    conditions.push(
      '((LOWER(brand_name) >= ? AND LOWER(brand_name) < ? AND brand_name LIKE ?)' +
      ' OR (LOWER(brand_name2) >= ? AND LOWER(brand_name2) < ? AND brand_name2 LIKE ?)' +
      ' OR (LOWER(brand_name3) >= ? AND LOWER(brand_name3) < ? AND brand_name3 LIKE ?))'
    )
    sqlArgs.push(lo, hi, likeQ, lo, hi, likeQ, lo, hi, likeQ)
  } else if (needsLower) {
    conditions.push(`LOWER(${params.field}) >= ? AND LOWER(${params.field}) < ? AND ${params.field} LIKE ?`)
    sqlArgs.push(lo, hi, likeQ)
  } else {
    conditions.push(`${params.field} >= ? AND ${params.field} < ? AND ${params.field} LIKE ?`)
    sqlArgs.push(lo, hi, likeQ)
  }

  const where = `WHERE ${conditions.join(' AND ')}`
  const { rows } = await client.execute({
    sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                 dosage_form, mnemonic, status, charge_number, brand_name,
                 formulary_status, pyxis_id, region, environment
          FROM formulary_groups ${where} LIMIT ?`,
    args: [...sqlArgs, params.limit],
  })
  return rows.map(mapRow)
}

// Returns the smallest string that is greater than every string with the given prefix.
// E.g. nextPrefix('abc') = 'abd'. Enables B-tree range scans alongside LIKE queries:
//   field >= q AND field < nextPrefix(q) AND field LIKE q%
// The range conditions let SQLite do a covering-index range scan; LIKE handles case filtering.
function nextPrefix(q: string): string {
  for (let i = q.length - 1; i >= 0; i--) {
    const code = q.charCodeAt(i)
    if (code < 0xffff) {
      return q.slice(0, i) + String.fromCharCode(code + 1)
    }
  }
  // All chars are 0xffff — return a string guaranteed to sort after any q-prefixed string
  return q + '\uffff'
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

      // status filter omitted — client filters via showInactive; avoids blocking the field index
      if (region)      { conds.push('region = ?');      fieldArgs.push(region) }
      if (environment) { conds.push('environment = ?'); fieldArgs.push(environment) }

      // Use LOWER(field) range bounds to force a case-insensitive B-tree range scan on the
      // LOWER(col) covering index. Without this, SQLite's case-insensitive LIKE prevents the
      // range optimization, falling back to a full index scan (~10s on Turso vs ~100ms).
      // charge_number and pyxis_id are alphanumeric — no LOWER() needed; use plain range.
      const lo = q   // already lowercased by the route handler
      const hi = nextPrefix(q)
      const likeQ = `${q}%`
      const needsLower = field !== 'charge_number' && field !== 'pyxis_id'
      if (field === 'brand_name') {
        conds.push(
          '((LOWER(brand_name) >= ? AND LOWER(brand_name) < ? AND brand_name LIKE ?)' +
          ' OR (LOWER(brand_name2) >= ? AND LOWER(brand_name2) < ? AND brand_name2 LIKE ?)' +
          ' OR (LOWER(brand_name3) >= ? AND LOWER(brand_name3) < ? AND brand_name3 LIKE ?))'
        )
        fieldArgs.push(lo, hi, likeQ, lo, hi, likeQ, lo, hi, likeQ)
      } else if (needsLower) {
        conds.push(`LOWER(${field}) >= ? AND LOWER(${field}) < ? AND ${field} LIKE ?`)
        fieldArgs.push(lo, hi, likeQ)
      } else {
        conds.push(`${field} >= ? AND ${field} < ? AND ${field} LIKE ?`)
        fieldArgs.push(lo, hi, likeQ)
      }

      const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
      // Embed field name as SQL string literal (field is validated against VALID_FIELDS above)
      parts.push(
        `SELECT * FROM (SELECT '${field}' AS _field, group_id, description, generic_name, strength, ` +
        `strength_unit, dosage_form, mnemonic, status, charge_number, brand_name, ` +
        `formulary_status, pyxis_id, region, environment ` +
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
    const ndcLo = q
    const ndcHi = nextPrefix(q)
    const ndcConds: string[] = ['sr.ndc >= ? AND sr.ndc < ? AND sr.ndc LIKE ?']
    const ndcArgs: (string | number)[] = [ndcLo, ndcHi, `${q}%`]
    // status filter omitted — client filters via showInactive; avoids blocking idx_sr_ndc
    if (region)      { ndcConds.push('fg.region = ?');      ndcArgs.push(region) }
    if (environment) { ndcConds.push('fg.environment = ?'); ndcArgs.push(environment) }
    ndcArgs.push(limit)
    const { rows } = await db.execute({
      sql: `SELECT DISTINCT fg.group_id, fg.description, fg.generic_name, fg.strength,
                   fg.strength_unit, fg.dosage_form, fg.mnemonic, fg.status,
                   fg.charge_number, fg.brand_name, fg.formulary_status,
                   fg.pyxis_id, fg.region, fg.environment
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

function rowToSupplyRecord(r: Row): SupplyRecord {
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
}

export async function getFormularyItemsForKey(
  key: { pyxisId?: string; chargeNumber?: string; groupId: string },
  showRawExtract = false,
): Promise<Record<string, FormularyItem>> {
  const db = getDb()

  let sql: string
  let arg: string
  if (key.pyxisId?.trim()) {
    sql = 'SELECT * FROM formulary_groups WHERE pyxis_id = ?'
    arg = key.pyxisId.trim()
  } else if (key.chargeNumber?.trim()) {
    sql = 'SELECT * FROM formulary_groups WHERE charge_number = ?'
    arg = key.chargeNumber.trim()
  } else {
    sql = 'SELECT * FROM formulary_groups WHERE group_id = ?'
    arg = key.groupId
  }

  const { rows } = await db.execute({ sql, args: [arg] })
  if (rows.length === 0) return {}

  const supplyResults = await db.batch(
    rows.map(g => ({
      sql: 'SELECT * FROM supply_records WHERE group_id = ? AND domain = ?',
      args: [g.group_id as string, g.domain as string],
    })),
    'read',
  )

  // Fetch overrides in one batch when overlay mode is active.
  // Silently skip if field_overrides table doesn't exist yet (pre-migration).
  let overrideResults: { rows: Row[] }[] = []
  if (!showRawExtract) {
    try {
      overrideResults = await db.batch(
        rows.map(g => ({
          sql: 'SELECT * FROM field_overrides WHERE domain = ? AND group_id = ?',
          args: [g.domain as string, g.group_id as string],
        })),
        'read',
      )
    } catch {
      // table doesn't exist yet — return raw extract data
    }
  }

  const out: Record<string, FormularyItem> = {}
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i]
    const domain = g.domain as string
    let item: FormularyItem = {
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
      supplyRecords: supplyResults[i].rows.map(rowToSupplyRecord),
    }
    if (!showRawExtract && overrideResults[i]?.rows.length) {
      const overrides = overrideResults[i].rows.map(r => ({
        id: r.id as string,
        domain: r.domain as string,
        groupId: r.group_id as string,
        fieldPath: r.field_path as string,
        overrideValue: r.override_value as string,
        taskId: r.task_id as string | undefined,
        appliedAt: r.applied_at as string,
        appliedBy: r.applied_by as string,
      } satisfies FieldOverride))
      item = applyOverrides(item, overrides)
    }
    out[domain] = item
  }
  return out
}

export async function getFormularyItem(
  groupId: string,
  domain?: string,
  showRawExtract = false,
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
  const resolvedDomain = g.domain as string

  const supplyArgs: string[] = [groupId]
  let supplySql = 'SELECT * FROM supply_records WHERE group_id = ?'
  if (domain) {
    supplySql += ' AND domain = ?'
    supplyArgs.push(domain)
  }

  const { rows: supplyRows } = await db.execute({ sql: supplySql, args: supplyArgs })

  let item: FormularyItem = {
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
    supplyRecords: supplyRows.map(rowToSupplyRecord),
  }

  if (!showRawExtract) {
    try {
      const { rows: overrideRows } = await db.execute({
        sql: 'SELECT * FROM field_overrides WHERE domain = ? AND group_id = ?',
        args: [resolvedDomain, item.groupId],
      })
      if (overrideRows.length > 0) {
        const overrides = overrideRows.map(r => ({
          id: r.id as string,
          domain: r.domain as string,
          groupId: r.group_id as string,
          fieldPath: r.field_path as string,
          overrideValue: r.override_value as string,
          taskId: r.task_id as string | undefined,
          appliedAt: r.applied_at as string,
          appliedBy: r.applied_by as string,
        } satisfies FieldOverride))
        item = applyOverrides(item, overrides)
      }
    } catch {
      // table doesn't exist yet — return raw extract data
    }
  }

  return item
}

// ---------------------------------------------------------------------------
// Non-Reference Item Creation
// ---------------------------------------------------------------------------

export interface NonReferenceFields {
  ndc: string
  manufacturer: string
  genericName: string
  mnemonic: string
  description: string
  brandName: string
  awpCost: number | null
  strength: string
  dosageForm: string
  packageSize: number | null
  packageUnit: string
  basePackageUnit: string
  outerPackageSize: number | null
  outerPackageUnit: string
  isBiological: boolean
  isUnitDose: boolean
  isBrand: boolean
  suppressClinicalAlerts: boolean
}

export async function createNonReferenceItem(
  fields: NonReferenceFields,
  domains: { region: string; environment: string; domain: string }[],
): Promise<{ groupId: string }> {
  if (domains.length === 0) throw new Error('At least one domain required')
  const db = getDb()
  const groupId = randomUUID()
  const now = new Date().toISOString()

  const identifiers_json = JSON.stringify({
    brandName: fields.brandName,
    isBrandPrimary: true,
    brandName2: '', isBrand2Primary: false,
    brandName3: '', isBrand3Primary: false,
    chargeNumber: '', labelDescription: '',
    genericName: fields.genericName,
    hcpcsCode: '', mnemonic: fields.mnemonic,
    pyxisId: '', groupRxMnemonic: '',
  })

  const oe_defaults_json = JSON.stringify({
    dose: '', referenceDose: '', route: '', frequency: '',
    infuseOver: '', infuseOverUnit: '', rate: '', rateUnit: '',
    normalizedRate: '', normalizedRateUnit: '', freetextRate: '',
    isPrn: false, prnReason: '', duration: null, durationUnit: '',
    stopType: '', orderedAsSynonym: '', defaultFormat: '',
    searchMedication: false, searchContinuous: false, searchIntermittent: false,
    notes1: '', notes1AppliesToFill: false, notes1AppliesToLabel: false, notes1AppliesToMar: false,
    notes2: '', notes2AppliesToFill: false, notes2AppliesToLabel: false, notes2AppliesToMar: false,
  })

  const dispense_json = JSON.stringify({
    strength: null, strengthUnit: '',
    volume: null, volumeUnit: '',
    usedInTotalVolumeCalculation: false,
    dispenseQty: null, dispenseQtyUnit: '',
    dispenseCategory: '',
    isDivisible: false, isInfinitelyDivisible: false,
    minimumDoseQty: null,
    packageSize: fields.packageSize, packageUnit: fields.packageUnit,
    outerPackageSize: fields.outerPackageSize, outerPackageUnit: fields.outerPackageUnit,
    basePackageUnit: fields.basePackageUnit,
    packageDispenseQty: null, packageDispenseOnlyQtyNeeded: false,
    formularyStatus: 'Non-Ref Build', priceSchedule: '',
    awpFactor: null, defaultParDoses: null, maxParQty: null,
  })

  const clinical_json = JSON.stringify({
    genericFormulationCode: '', drugFormulationCode: '',
    suppressMultumAlerts: fields.suppressClinicalAlerts,
    therapeuticClass: '', dcInteractionDays: null, dcDisplayDays: null, orderAlert1: '',
  })

  const inventory_json = JSON.stringify({
    allFacilities: false, facilities: {},
    dispenseFrom: '', isReusable: false,
    inventoryFactor: null, inventoryBasePackageUnit: '',
  })

  const supply_json = JSON.stringify({})

  const stmts = domains.flatMap(({ region, environment, domain }) => [
    {
      sql: `INSERT INTO formulary_groups (
              domain, region, environment, extracted_at,
              group_id, description, generic_name, mnemonic,
              charge_number, brand_name, brand_name2, brand_name3, pyxis_id,
              status, formulary_status, strength, strength_unit, dosage_form, legal_status,
              identifiers_json, oe_defaults_json, dispense_json, clinical_json, inventory_json,
              therapeutic_class
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        domain, region, environment, now,
        groupId, fields.description, fields.genericName, fields.mnemonic,
        '', fields.brandName, '', '', '',
        'Active', 'Non-Ref Build', fields.strength, '', fields.dosageForm,
        fields.isBrand ? 'B' : 'G',
        identifiers_json, oe_defaults_json, dispense_json, clinical_json, inventory_json,
        '',
      ],
    },
    {
      sql: `INSERT INTO supply_records (
              domain, group_id, ndc, is_non_reference, is_active,
              manufacturer, manufacturer_brand, manufacturer_label_desc,
              is_primary, is_biological, is_brand, is_unit_dose,
              awp_cost, cost1, cost2, supply_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        domain, groupId, fields.ndc, 1, 1,
        fields.manufacturer, '', '',
        1, fields.isBiological ? 1 : 0, fields.isBrand ? 1 : 0, fields.isUnitDose ? 1 : 0,
        fields.awpCost, null, null, supply_json,
      ],
    },
  ])

  await db.batch(stmts, 'write')
  return { groupId }
}

// ---------------------------------------------------------------------------
// NDC Lookup for Non-Reference Build Pre-population
// ---------------------------------------------------------------------------

export interface NdcLookupResult {
  source: 'formulary' | 'multum_csv'
  description: string
  genericName: string
  strength: string
  strengthUnit: string
  dosageForm: string
  mnemonic: string
  brandName: string
  manufacturer: string
  awpCost: number | null
  cost1: number | null
  packageSize: number | null
  packageUnit: string
  outerPackageSize: number | null
  isUnitDose: boolean
  isBrand: boolean
}

export async function lookupNdcForBuild(ndc: string): Promise<NdcLookupResult | null> {
  if (!ndc.trim()) return null
  const db = getDb()

  // Phase A: look up in existing formulary (supply_records JOIN formulary_groups)
  const { rows: fRows } = await db.execute({
    sql: `SELECT fg.description, fg.generic_name, fg.strength, fg.strength_unit,
                 fg.dosage_form, fg.mnemonic, fg.brand_name,
                 sr.manufacturer, sr.awp_cost, sr.cost1, sr.is_brand, sr.is_unit_dose,
                 fg.dispense_json
          FROM supply_records sr
          JOIN formulary_groups fg
            ON fg.group_id = sr.group_id AND fg.domain = sr.domain
          WHERE sr.ndc = ?
          LIMIT 1`,
    args: [ndc.trim()],
  })

  if (fRows.length > 0) {
    const r = fRows[0]
    let packageSize: number | null = null
    let packageUnit = ''
    let outerPackageSize: number | null = null
    try {
      const disp = JSON.parse((r.dispense_json as string) || '{}') as {
        packageSize?: number | null
        packageUnit?: string
        outerPackageSize?: number | null
      }
      packageSize = disp.packageSize ?? null
      packageUnit = disp.packageUnit ?? ''
      outerPackageSize = disp.outerPackageSize ?? null
    } catch { /* ignore */ }
    return {
      source: 'formulary',
      description:   (r.description as string) ?? '',
      genericName:   (r.generic_name as string) ?? '',
      strength:      (r.strength as string) ?? '',
      strengthUnit:  (r.strength_unit as string) ?? '',
      dosageForm:    (r.dosage_form as string) ?? '',
      mnemonic:      (r.mnemonic as string) ?? '',
      brandName:     (r.brand_name as string) ?? '',
      manufacturer:  (r.manufacturer as string) ?? '',
      awpCost:       (r.awp_cost as number | null),
      cost1:         (r.cost1 as number | null),
      packageSize,
      packageUnit,
      outerPackageSize,
      isUnitDose:    !!(r.is_unit_dose as number),
      isBrand:       !!(r.is_brand as number),
    }
  }

  // Phase B: fall back to Multum NDC CSV table
  try {
    const { rows: mRows } = await db.execute({
      sql: `SELECT awp, a_cost, inner_pkg_size, outer_pkg_size, unit_dose_code, gbo
            FROM multum_ndcs WHERE ndc_formatted = ?`,
      args: [ndc.trim()],
    })
    if (mRows.length > 0) {
      const m = mRows[0]
      return {
        source:        'multum_csv',
        description:   '',
        genericName:   '',
        strength:      '',
        strengthUnit:  '',
        dosageForm:    '',
        mnemonic:      '',
        brandName:     '',
        manufacturer:  '',
        awpCost:       (m.awp as number | null),
        cost1:         (m.a_cost as number | null),
        packageSize:   (m.inner_pkg_size as number | null),
        packageUnit:   '',
        outerPackageSize: (m.outer_pkg_size as number | null) || null,
        isUnitDose:    (m.unit_dose_code as string) === 'Y',
        isBrand:       (m.gbo as string) === 'B',
      }
    }
  } catch {
    // multum_ndcs table doesn't exist yet — just return null
  }

  return null
}
