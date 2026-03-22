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

export async function getFormularyItemsForKey(key: {
  pyxisId?: string
  chargeNumber?: string
  groupId: string
}): Promise<Record<string, FormularyItem>> {
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

  const supplyResults = await Promise.all(
    rows.map(g =>
      db.execute({
        sql: 'SELECT * FROM supply_records WHERE group_id = ? AND domain = ?',
        args: [g.group_id as string, g.domain as string],
      })
    )
  )

  const out: Record<string, FormularyItem> = {}
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i]
    const domain = g.domain as string
    out[domain] = {
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
  }
  return out
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

  const supplyRecords: SupplyRecord[] = supplyRows.map(rowToSupplyRecord)

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
