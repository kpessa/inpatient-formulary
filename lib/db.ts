import { createClient, type Client, type Row } from '@libsql/client'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
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
let _proxiedClient: Client | null = null

/// Resolve the embedded-replica file path. Defaults to a per-user macOS
/// cache location so the file persists across launchd restarts but stays
/// out of the repo and out of iCloud Drive (which would corrupt it via
/// fsync games). Override via `LOCAL_REPLICA_PATH` env var if you want to
/// point it at a tmpfs / RAM disk for benchmarking, or at a different
/// volume. Created on first call.
function resolveReplicaPath(): string {
  const explicit = process.env.LOCAL_REPLICA_PATH
  if (explicit) return explicit
  const home = process.env.HOME ?? ''
  return `${home}/Library/Caches/inpatient-formulary/replica.db`
}

function buildClient(): Client {
  const dbUrl = process.env.DATABASE_URL
  const isRemote = !!dbUrl && (dbUrl.startsWith('libsql://') || dbUrl.startsWith('https://') || dbUrl.startsWith('wss://'))

  // Embedded-replica is the right choice for the long-running launchd-managed
  // dev server (persistent disk, replica file survives restarts, syncs in the
  // background, sub-ms reads). It's the WRONG choice for Vercel serverless:
  //   - Each function container is ephemeral → no persistent disk
  //   - First call would do a full ~50MB sync from Turso, blowing past the
  //     function timeout and memory budget
  //   - $HOME on Vercel doesn't point at a writable Mac-style cache dir
  // Detect serverless via the `VERCEL` env var that Vercel injects, and
  // fall back to a direct Turso connection there. Reads go over the wire
  // but Turso's edge replicas keep latency reasonable for serverless use.
  const isServerless = !!process.env.VERCEL

  if (isRemote && !isServerless) {
    // **Embedded replica path** (local dev / persistent server).
    //
    // The local file is the read substrate — every `db.execute()` /
    // `db.batch()` SELECT hits this file (sub-ms, no network). Writes
    // (INSERT/UPDATE/DELETE) go to `syncUrl` (the remote Turso DB) AND
    // update the local file in the same call so reads-your-writes is
    // preserved. `syncInterval: 60` triggers background sync every 60s.
    //
    // First-request cost: one full sync of the remote DB into the local
    // file (~50MB → seconds on a fast connection). Subsequent reads are
    // local-disk-fast. The local file persists across launchd restarts
    // since it lives in ~/Library/Caches.
    const replicaPath = resolveReplicaPath()
    const replicaDir = dirname(replicaPath)
    if (!existsSync(replicaDir)) {
      mkdirSync(replicaDir, { recursive: true })
    }
    return createClient({
      url: `file:${replicaPath}`,
      syncUrl: dbUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
      syncInterval: 60,
    })
  }

  if (isRemote) {
    // Direct Turso connection for serverless — no local replica.
    return createClient({
      url: dbUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
  }

  // Local-file fallback — dev without Turso configured. Reads + writes
  // both go to the local SQLite file directly (no replica machinery).
  return createClient({
    url: dbUrl ?? 'file:./data/formulary.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
}

function isStreamNotFoundError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  return /stream not found/i.test(msg)
}

export function getDb(): Client {
  if (_proxiedClient) return _proxiedClient
  _client = buildClient()

  // libsql can throw "stream not found" if Turso invalidates the persistent
  // Hrana stream id this client is bound to (idle timeout, peer migration,
  // long-running sync). Without this proxy the cached client poisons every
  // subsequent query until the process restarts. We rebuild + retry once,
  // only on `execute` / `batch` (the hot paths the error has been seen on).
  _proxiedClient = new Proxy<Client>(_client, {
    get(_target, prop) {
      const current = _client!
      const value = (current as unknown as Record<PropertyKey, unknown>)[prop as string]
      if (typeof value !== 'function') return value
      if (prop !== 'execute' && prop !== 'batch') {
        return (value as (...a: unknown[]) => unknown).bind(current)
      }
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(current, args)
        } catch (err) {
          if (!isStreamNotFoundError(err)) throw err
          console.warn(`[lib/db] Hrana stream invalidated; rebuilding libsql client and retrying ${String(prop)} once.`)
          _client = buildClient()
          const fn = (_client as unknown as Record<PropertyKey, unknown>)[prop] as (...a: unknown[]) => Promise<unknown>
          return fn.apply(_client, args)
        }
      }
    },
  })
  return _proxiedClient
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
  dispenseStrength: string
  dispenseStrengthUnit: string
  dispenseVolume: string
  dispenseVolumeUnit: string
  dispenseCategory: string
  cdmDescription?: string
  cdmProcCode?: string
}

export interface CdmUnbuiltResult {
  cdmCode: string
  description: string
  techDesc: string
  procCode: string
  revCode: string
  divisor: string
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

  // Fast path: no facility filter — COUNT + SELECT.
  // JSON blobs (oe_defaults_json, inventory_json) are omitted here; the client
  // fetches them via /api/formulary/inventory after displaying initial results.
  //
  // NOTE: do NOT use `db.batch(...)` here. On a syncing libsql client (the
  // embedded-replica setup `getDb()` builds), `batch()` round-trips to the
  // remote even for read-only stmts and runs ~500x slower than sequential
  // `db.execute()` calls against the local file (~60s vs ~100ms for this
  // query). Two execute calls hit the local replica directly.
  if (!facilities) {
    const { rows: countRows } = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM formulary_groups ${where}`,
      args: sqlArgs,
    })
    const { rows } = await db.execute({
      sql: `SELECT group_id, description, generic_name, strength, strength_unit,
                   dosage_form, mnemonic, status, charge_number, brand_name,
                   formulary_status, pyxis_id, region, environment,
                   dispense_strength, dispense_strength_unit, dispense_volume, dispense_volume_unit,
                   dispense_category
            FROM formulary_groups ${where} LIMIT ?`,
      args: [...sqlArgs, AUTO_FETCH_MAX],
    })
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
           formulary_status, pyxis_id, inventory_json, region, environment,
           dispense_category
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
    dispenseCategory: (row.dispense_category as string) ?? '',
    dispenseStrength: (row.dispense_strength as string) ?? '',
    dispenseStrengthUnit: (row.dispense_strength_unit as string) ?? '',
    dispenseVolume: (row.dispense_volume as string) ?? '',
    dispenseVolumeUnit: (row.dispense_volume_unit as string) ?? '',
    activeFacilities: [],
    searchMedication: false,
    searchContinuous: false,
    searchIntermittent: false,
    cdmDescription: undefined,
    cdmProcCode: undefined,
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
                 formulary_status, pyxis_id, region, environment,
                 dispense_category
          FROM formulary_groups
          WHERE ${conditions.join(' AND ')}
          ORDER BY description`,
    args,
  })
  return rows.map(mapRow)
}

// Batch-enrich SearchResults with CDM data
export async function enrichWithCdm(results: SearchResult[]): Promise<void> {
  const charges = [...new Set(results.map(r => r.chargeNumber).filter(Boolean))]
  if (charges.length === 0) return
  const db = getDb()
  // Batch in chunks of 100
  for (let i = 0; i < charges.length; i += 100) {
    const chunk = charges.slice(i, i + 100)
    const ph = chunk.map(() => '?').join(',')
    const { rows } = await db.execute({
      sql: `SELECT cdm_code, tech_desc, proc_code FROM cdm_master WHERE cdm_code IN (${ph})`,
      args: chunk,
    })
    const map = new Map(rows.map(r => [r.cdm_code as string, { desc: r.tech_desc as string, proc: r.proc_code as string }]))
    for (const r of results) {
      const cdm = map.get(r.chargeNumber)
      if (cdm) { r.cdmDescription = cdm.desc; r.cdmProcCode = cdm.proc || undefined }
    }
  }
}

// Search CDM master for unbuilt entries (no matching formulary product)
export async function searchCdmUnbuilt(q: string, limit = 50): Promise<CdmUnbuiltResult[]> {
  if (!q || q === '*') return []
  const db = getDb()
  const lowerQ = q.toLowerCase()
  const isWildcard = lowerQ.includes('*')
  const likeQ = isWildcard ? lowerQ.replace(/\*/g, '%') : `%${lowerQ}%`

  const { rows } = await db.execute({
    sql: `SELECT cm.cdm_code, cm.description, cm.tech_desc, cm.proc_code, cm.rev_code, cm.divisor
          FROM cdm_master cm
          WHERE NOT EXISTS (SELECT 1 FROM formulary_groups fg WHERE fg.charge_number = cm.cdm_code)
            AND (LOWER(cm.description) LIKE ? OR cm.cdm_code LIKE ?)
          LIMIT ?`,
    args: [likeQ, likeQ, limit],
  })
  return rows.map(r => ({
    cdmCode: r.cdm_code as string,
    description: r.description as string,
    techDesc: r.tech_desc as string,
    procCode: r.proc_code as string,
    revCode: r.rev_code as string,
    divisor: r.divisor as string,
  }))
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
                   fg.pyxis_id, fg.region, fg.environment,
                   fg.dispense_strength, fg.dispense_strength_unit, fg.dispense_volume, fg.dispense_volume_unit,
                   fg.dispense_category
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
                 formulary_status, pyxis_id, region, environment,
                 dispense_category
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
        `formulary_status, pyxis_id, region, environment, ` +
        `dispense_strength, dispense_strength_unit, dispense_volume, dispense_volume_unit, ` +
        `dispense_category ` +
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
                   fg.pyxis_id, fg.region, fg.environment,
                   fg.dispense_strength, fg.dispense_strength_unit, fg.dispense_volume, fg.dispense_volume_unit,
                   fg.dispense_category
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

export async function getOldestProdExtractDate(): Promise<string | null> {
  const db = getDb()
  const { rows } = await db.execute(
    "SELECT MIN(extracted_at) as oldest_extract FROM formulary_groups WHERE environment = 'prod'"
  )
  if (!rows.length || !rows[0].oldest_extract) return null
  return rows[0].oldest_extract as string
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

// ---------------------------------------------------------------------------
// Facility-scoped NDC Lookup (Formulary Diagnosis Scanner — Phase 1)
//
// `lookupNdcForBuild` above tells you "is this NDC built anywhere at UHS?".
// The Diagnosis Scanner needs the per-facility variant: "is this NDC built
// AT THIS FACILITY's domain, and is it flexed to THIS FACILITY?". The result
// is shaped to feed the diagnosis classifier (see lib/diagnosis.ts), which
// emits one of states A / B / B′ / D / E. (State C — stacking — needs a
// similar-generic search and Multum Drug Formulation match; Phase 1.5.)
// ---------------------------------------------------------------------------

export interface SupplyRecordSibling {
  ndc: string
  /** True for inner-NDC / hospital-repackaged rows added under another NDC's properties. */
  isNonReference: boolean
  isPrimary: boolean
  isUnitDose: boolean
  isBrand: boolean
  isActive: boolean
  manufacturer: string
  manufacturerLabelDesc: string
  /**
   * True when this NDC is in Multum (either the legacy CSV cost table or the
   * full data-model extract). Drives the "this is clickable for Multum detail"
   * visual affordance on the row.
   */
  isReference: boolean
}

export interface FacilityBuild {
  /** Cerner domain the build lives in, e.g. `east_prod`, `central_cert`. */
  domain: string
  /** `formulary_groups.group_id`. */
  groupId: string
  /** Pyxis ID (= Med ID) for this build. */
  pyxisId: string
  description: string
  genericName: string
  strength: string
  strengthUnit: string
  dosageForm: string
  brandName: string
  /**
   * Whether ANY of the requested facilities appears in `inventory_json.facilities`
   * with value `true`. Singular naming kept for back-compat — the underlying
   * scanner now supports a multi-select facility scope, so the meaning of
   * "requested" is "any selected."
   */
  flexedAtRequestedFacility: boolean
  /** All facilities where this build is currently flexed (active in inventory_json). */
  flexedFacilities: string[]
  /** Cerner CDM / charge number from formulary_groups. */
  chargeNumber: string
  /**
   * Other NDCs stacked on the same (domain, group_id) — manufacturer
   * alternates, repackaged unit-doses, inner-NDC companions. Excludes the
   * looked-up NDC itself. Empty when this is the only NDC on the product.
   */
  siblingNdcs: SupplyRecordSibling[]
}

export interface MultumMasterPresence {
  present: boolean
  awp: number | null
  aCost: number | null
  innerPkgSize: number | null
  outerPkgSize: number | null
  unitDoseCode: string | null
  gbo: string | null
}

/**
 * Stacking-probe result. Three real outcomes plus a no-MMDC degenerate case.
 *
 * Wired into `FacilityNdcLookup.stackProbe` and run only when the scanned NDC
 * has no Cerner build anywhere (`builds.length === 0`) — i.e. when we'd
 * otherwise be heading toward State D or E. The probe queries the Multum
 * data-model tables (`mltm_ndc` etc.) loaded by scripts/load_multum_xlsx.ts.
 *
 *   match           — sibling NDCs sharing the scanned NDC's MMDC have ≥1
 *                     formulary_groups build in the requested facility's
 *                     Cerner domain. Stack candidate exists.
 *   no_match        — siblings exist in Multum but none have a build in the
 *                     facility's domain. Confirmed not stackable here.
 *   not_in_extract  — scanned NDC isn't in mltm_ndc at all. Probe inconclusive
 *                     (Multum lags new launches; some NDCs aren't catalogued).
 *   no_mmdc         — NDC is in mltm_ndc but its main_multum_drug_code is
 *                     NULL. Rare data quirk; treat like not_in_extract.
 *
 * Phase 1.5 (current): probe runs but doesn't change the diagnose() verdict.
 * The trace surfaces it. Verdict-changing logic flips after live validation.
 */
export type StackProbeStatus = 'match' | 'no_match' | 'not_in_extract' | 'no_mmdc'

export interface StackCandidate {
  /** Cerner domain of the candidate build (always equal to the requested facility's domain). */
  domain: string
  groupId: string
  /** Cerner CDM / charge number from formulary_groups.charge_number. */
  chargeNumber: string
  /**
   * Pyxis ID (= Cerner's "Med ID" field). Used as the dispenser identifier on
   * the build ticket regardless of whether the site runs Pyxis or Omnicell —
   * Cerner stacking is initiated against this single ID; the Omnicell/Pyxis
   * propagation is handled downstream of the Cerner build.
   */
  pyxisId: string
  description: string
  /** Whether the candidate build is currently flexed to the requested facility (informational). */
  flexedAtFacility: boolean
  /** Sibling NDCs in this group that share the scanned NDC's MMDC. */
  matchedSiblingNdcs: string[]
}

export interface StackProbeResult {
  status: StackProbeStatus
  /** Multum's MMDC for the scanned NDC, when known. */
  mmdc: number | null
  /** From mltm_drug_id.is_single_ingredient. False/null = combo product; probe should be lower-confidence. */
  isSingleIngredient: boolean | null
  /** Human-readable formulation, e.g. "FLUoxetine 40 mg capsule". Best-effort from drug_name + strength + dose_form. */
  formulationName: string | null
  /** Drug identifier from Multum (e.g. "d00236"). Used for cross-referencing into the order-sentence side. */
  formulationDrugId: string | null
  /** Active sibling NDCs sharing the MMDC, excluding the scanned one. */
  siblingCount: number
  /** Distinct candidate groups (CDMs) in the facility's domain. */
  candidates: StackCandidate[]
}

export interface FacilityNdcLookup {
  ndc: string
  /**
   * The selected facilities the lookup was scoped to. Empty = "all facilities"
   * (no scope). Replaces the old singular `facility` field; kept under a new
   * name so the type change is explicit at every call site.
   */
  facilities: string[]
  /**
   * Back-compat alias: when `facilities.length === 1`, this is that facility;
   * when 0 or 2+, this is `''`. Old code that read `lookup.facility` keeps
   * working in the single-facility case (which is what every legacy caller used).
   */
  facility: string
  /**
   * Resolved Cerner domain when the selected facilities all map to one domain
   * (or exactly one was selected). `null` when no facility is selected, when
   * the selected facilities span multiple domains, or when none of them are
   * recognized in the inventory map.
   */
  facilityDomain: string | null
  /**
   * Distinct Cerner domains the selected facilities resolve to. Empty when no
   * facility is selected or none are recognized. Single-element array when all
   * resolve to the same domain. Multi-element when the user picked across
   * domains (e.g. east_prod + central_prod). The diagnosis classifier uses
   * this set as the "in-scope" filter for builds.
   */
  facilityDomains: string[]
  /**
   * Best-effort product identity. Source priority:
   *   `formulary`           — pulled from a real Cerner build (highest fidelity)
   *   `multum_data_model`   — generic/strength/form joined from mltm_* tables
   *   `multum_csv`          — pre-existing CSV import (cost/pkg only, no name)
   *   `unknown`             — nothing matched
   *
   * `multum_csv` and `multum_data_model` are merged when both are present —
   * the data-model side fills the name/strength/form, the CSV side fills
   * the AWP/cost/package metadata. The source field reports the dominant
   * one (the side that actually produced a name).
   */
  identity: {
    source: 'formulary' | 'multum_data_model' | 'multum_csv' | 'unknown'
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
  /** Every (domain, group_id) where this NDC is built. Empty = no Cerner build anywhere. */
  builds: FacilityBuild[]
  /** Whether the NDC is in the Multum master CDM extract. */
  multumMaster: MultumMasterPresence
  /**
   * Result of the MMDC-based stacking probe. Populated only when `builds.length === 0`
   * (otherwise stacking is moot — A/B/B' already won). `null` means the probe
   * wasn't run; check `builds` to see why.
   */
  stackProbe: StackProbeResult | null
}

export type Environment = 'prod' | 'cert'

/**
 * Process-level cache mapping facility → domain.
 *
 * The query that builds the map is a full scan over `formulary_groups` plus
 * `json_each` over the per-row `inventory_json.facilities` blob. Against the
 * embedded local replica that's fast (sub-second on a 50MB DB); against the
 * remote Turso pipeline it can be 15+ seconds. We pay it once per process
 * lifetime per environment and serve subsequent calls from the in-memory map.
 *
 * Invalidate manually with `invalidateFacilityDomainCache()` if data changes
 * mid-process (e.g. after running a re-import script in dev).
 *
 * Future work (per wiki § Risks): materialize this into an explicit
 * `facility_domains` table so cold-start cost goes to zero. Wiring is
 * unchanged — `getFacilityDomain` would read from the table instead of the
 * scan + memo.
 */
const _facilityDomainCache = new Map<Environment, Map<string, string>>()

async function loadFacilityDomainMap(environment: Environment): Promise<Map<string, string>> {
  const cached = _facilityDomainCache.get(environment)
  if (cached) return cached
  const db = getDb()
  const { rows } = await db.execute({
    sql: `SELECT je.key AS facility, fg.domain, COUNT(*) AS n
          FROM formulary_groups fg, json_each(json_extract(fg.inventory_json, '$.facilities')) AS je
          WHERE je.value = 1 AND fg.environment = ?
          GROUP BY je.key, fg.domain
          ORDER BY n DESC`,
    args: [environment],
  })
  // For facilities present in multiple domains (rare — go-live transition
  // states), the ORDER BY n DESC means the domain with the most rows wins.
  const map = new Map<string, string>()
  for (const r of rows) {
    const facility = r.facility as string
    if (!map.has(facility)) {
      map.set(facility, r.domain as string)
    }
  }
  _facilityDomainCache.set(environment, map)
  return map
}

/** Resolve a facility name to its Cerner domain. Defaults to `prod`. */
export async function getFacilityDomain(
  facility: string,
  opts: { environment?: Environment } = {},
): Promise<string | null> {
  const env = opts.environment ?? 'prod'
  const map = await loadFacilityDomainMap(env)
  return map.get(facility) ?? null
}

/** Force a reload of the facility→domain map on next call. Use after data imports. */
export function invalidateFacilityDomainCache(): void {
  _facilityDomainCache.clear()
}

/**
 * Look up an NDC scoped to a specific facility. Returns the substrate the
 * diagnosis classifier needs to decide one of states A / B / B′ / D / E.
 *
 * State decisions (made by the classifier on top of this output):
 *   A  — `builds` contains a row where `domain === facilityDomain && flexedAtRequestedFacility`
 *   B  — `builds` contains a row where `domain === facilityDomain && !flexedAtRequestedFacility`
 *   B′ — `builds` is non-empty but no row has `domain === facilityDomain`
 *   D  — `builds` is empty AND `multumMaster.present`
 *   E  — `builds` is empty AND `!multumMaster.present` AND no similar-generic hit (Phase 1.5)
 *
 * The NDC is queried against `supply_records.ndc` literally — pass the
 * formatted form (`56151-1625-01`) since that's how the import pipeline stores
 * it. Use `parseBarcode().candidates` from `lib/barcode.ts` to get the right
 * formatted shape from a barcode or 10-digit input.
 */
export async function lookupNdcForFacility(
  ndc: string,
  facilities: string[],
  opts: { environment?: Environment } = {},
): Promise<FacilityNdcLookup> {
  const env = opts.environment ?? 'prod'
  const trimmedNdc = ndc.trim()
  // De-dup, drop empties, preserve order. An empty array (or all-empty input)
  // means "all facilities" / no-scope mode.
  const trimmedFacilities = Array.from(
    new Set(facilities.map((f) => f.trim()).filter(Boolean)),
  )

  // Resolve each selected facility to its Cerner domain. Unknown facilities
  // simply contribute no domain — they fall out of the in-scope filter rather
  // than poisoning the diagnosis. (When *all* are unknown, scope collapses to
  // empty and the diagnosis runs in no-scope mode, same as picking "All".)
  const domainResults = await Promise.all(
    trimmedFacilities.map((f) => getFacilityDomain(f, { environment: env })),
  )
  const facilityDomains = Array.from(
    new Set(domainResults.filter((d): d is string => !!d)),
  )
  // Singular `facilityDomain` is set only when there's exactly one domain in
  // play — the legacy semantics. Multi-domain or no-scope → null. The
  // diagnosis classifier uses `facilityDomains` for the actual scope decisions.
  const facilityDomain = facilityDomains.length === 1 ? facilityDomains[0] : null
  // Set of selected facilities for fast lookup when computing per-build flex.
  const facilitySet = new Set(trimmedFacilities)

  // Phase A: every build that references this NDC, joined to its formulary_groups row.
  // Filter by environment so cert hits don't pollute a prod diagnosis.
  const buildResult = await getDb().execute({
    sql: `SELECT fg.domain, fg.group_id, fg.pyxis_id,
                 fg.description, fg.generic_name, fg.strength, fg.strength_unit,
                 fg.dosage_form, fg.brand_name, fg.charge_number,
                 fg.mnemonic, fg.inventory_json,
                 sr.manufacturer, sr.awp_cost, sr.cost1,
                 sr.is_brand, sr.is_unit_dose,
                 fg.dispense_json
          FROM supply_records sr
          JOIN formulary_groups fg
            ON fg.group_id = sr.group_id AND fg.domain = sr.domain
          WHERE sr.ndc = ? AND fg.environment = ?
          ORDER BY fg.domain`,
    args: [trimmedNdc, env],
  })

  const builds: FacilityBuild[] = []
  let identity: FacilityNdcLookup['identity'] = {
    source: 'unknown',
    description: '',
    genericName: '',
    strength: '',
    strengthUnit: '',
    dosageForm: '',
    mnemonic: '',
    brandName: '',
    manufacturer: '',
    awpCost: null,
    cost1: null,
    packageSize: null,
    packageUnit: '',
    outerPackageSize: null,
    isUnitDose: false,
    isBrand: false,
  }

  // De-duplicate (domain, group_id): a NDC can appear in multiple supply_records
  // rows (primary + non-reference) for the same group. We want one FacilityBuild per group.
  const seen = new Set<string>()
  for (const r of buildResult.rows) {
    const key = `${r.domain as string}::${r.group_id as string}`
    if (seen.has(key)) continue
    seen.add(key)

    let flexedFacilities: string[] = []
    let flexedAtRequestedFacility = false
    try {
      const inv = JSON.parse((r.inventory_json as string) || '{}') as {
        facilities?: Record<string, boolean>
      }
      const facMap = inv.facilities ?? {}
      flexedFacilities = Object.entries(facMap)
        .filter(([, v]) => v === true)
        .map(([k]) => k)
        .sort()
      // Multi-facility scope: a build counts as "flexed at the requested
      // facility" if it's flexed at ANY of the selected facilities. This
      // mirrors the product-search behavior where picking RSM + IVM matches
      // products flexed to either.
      flexedAtRequestedFacility = trimmedFacilities.some(
        (f) => facMap[f] === true,
      )
      // facilitySet kept for symmetry with future per-facility breakdowns;
      // currently unused at this seam but we want the local to exist so the
      // intent is documented.
      void facilitySet
    } catch { /* fall through with empty list */ }

    builds.push({
      domain: r.domain as string,
      groupId: r.group_id as string,
      pyxisId: (r.pyxis_id as string) ?? '',
      description: (r.description as string) ?? '',
      genericName: (r.generic_name as string) ?? '',
      strength: (r.strength as string) ?? '',
      strengthUnit: (r.strength_unit as string) ?? '',
      dosageForm: (r.dosage_form as string) ?? '',
      brandName: (r.brand_name as string) ?? '',
      chargeNumber: (r.charge_number as string) ?? '',
      flexedAtRequestedFacility,
      flexedFacilities,
      siblingNdcs: [],
    })

    // First formulary hit wins for identity. Prefer a build in any of the
    // selected facilities' domains when available; otherwise any hit beats
    // unknown. (Multi-facility: if the user picked across domains, identity
    // comes from the first matching scope hit — good enough since identity
    // fields like generic name / dosage form rarely diverge across domains.)
    const inScopeDomain = facilityDomains.includes(r.domain as string)
    if (
      identity.source === 'unknown' ||
      (identity.source === 'formulary' && inScopeDomain)
    ) {
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
      identity = {
        source: 'formulary',
        description: (r.description as string) ?? '',
        genericName: (r.generic_name as string) ?? '',
        strength: (r.strength as string) ?? '',
        strengthUnit: (r.strength_unit as string) ?? '',
        dosageForm: (r.dosage_form as string) ?? '',
        mnemonic: (r.mnemonic as string) ?? '',
        brandName: (r.brand_name as string) ?? '',
        manufacturer: (r.manufacturer as string) ?? '',
        awpCost: r.awp_cost as number | null,
        cost1: r.cost1 as number | null,
        packageSize,
        packageUnit,
        outerPackageSize,
        isUnitDose: !!(r.is_unit_dose as number),
        isBrand: !!(r.is_brand as number),
      }
    }
  }

  // Phase A': sibling NDC discovery. For every build the looked-up NDC sits
  // on, fetch the OTHER NDCs stacked on the same (domain, group_id). These
  // surface manufacturer alternates, repackaged unit-doses, and inner-NDC
  // companions on the same product. Single batched query — typical build
  // count is 1–3 so the OR-chained predicate stays small.
  if (builds.length > 0) {
    const predicate = builds
      .map(() => '(domain = ? AND group_id = ?)')
      .join(' OR ')
    const sibArgs: (string | number)[] = []
    for (const b of builds) sibArgs.push(b.domain, b.groupId)
    sibArgs.push(trimmedNdc)
    // LEFT JOIN both Multum tables so we know per-sibling whether the NDC has
    // Multum reference info (drives the row's clickable "view Multum detail"
    // affordance). Either table counts as "in Multum" — they have different
    // load paths and partial overlap.
    const { rows: sibRows } = await getDb().execute({
      sql: `SELECT sr.domain, sr.group_id, sr.ndc, sr.is_non_reference, sr.is_primary,
                   sr.is_unit_dose, sr.is_brand, sr.is_active,
                   sr.manufacturer, sr.manufacturer_label_desc,
                   (mn.ndc_formatted IS NOT NULL OR mltm.ndc_formatted IS NOT NULL) AS is_in_multum
            FROM supply_records sr
            LEFT JOIN multum_ndcs mn ON mn.ndc_formatted = sr.ndc
            LEFT JOIN mltm_ndc mltm ON mltm.ndc_formatted = sr.ndc
            WHERE (${predicate}) AND sr.ndc != ? AND sr.ndc != ''
            ORDER BY sr.domain, sr.group_id, sr.is_primary DESC, sr.is_active DESC, sr.ndc`,
      args: sibArgs,
    })
    const byKey = new Map<string, SupplyRecordSibling[]>()
    for (const r of sibRows) {
      const key = `${r.domain as string}::${r.group_id as string}`
      const list = byKey.get(key) ?? []
      list.push({
        ndc: (r.ndc as string) ?? '',
        isNonReference: !!(r.is_non_reference as number),
        isPrimary: !!(r.is_primary as number),
        isUnitDose: !!(r.is_unit_dose as number),
        isBrand: !!(r.is_brand as number),
        isActive: !!(r.is_active as number),
        manufacturer: (r.manufacturer as string) ?? '',
        manufacturerLabelDesc: (r.manufacturer_label_desc as string) ?? '',
        isReference: !!(r.is_in_multum as number),
      })
      byKey.set(key, list)
    }
    for (const b of builds) {
      b.siblingNdcs = byKey.get(`${b.domain}::${b.groupId}`) ?? []
    }
  }

  // Phase B: Multum master CDM presence (always queried — feeds states D and E).
  let multumMaster: MultumMasterPresence = {
    present: false,
    awp: null,
    aCost: null,
    innerPkgSize: null,
    outerPkgSize: null,
    unitDoseCode: null,
    gbo: null,
  }
  try {
    const { rows: mRows } = await getDb().execute({
      sql: `SELECT awp, a_cost, inner_pkg_size, outer_pkg_size, unit_dose_code, gbo
            FROM multum_ndcs WHERE ndc_formatted = ?`,
      args: [trimmedNdc],
    })
    if (mRows.length > 0) {
      const m = mRows[0]
      multumMaster = {
        present: true,
        awp: m.awp as number | null,
        aCost: m.a_cost as number | null,
        innerPkgSize: m.inner_pkg_size as number | null,
        outerPkgSize: m.outer_pkg_size as number | null,
        unitDoseCode: m.unit_dose_code as string | null,
        gbo: m.gbo as string | null,
      }
      // Fall back to multum for identity if no formulary build was found.
      if (identity.source === 'unknown') {
        identity = {
          ...identity,
          source: 'multum_csv',
          awpCost: multumMaster.awp,
          cost1: multumMaster.aCost,
          packageSize: multumMaster.innerPkgSize,
          outerPackageSize: multumMaster.outerPkgSize,
          isUnitDose: multumMaster.unitDoseCode === 'Y',
          isBrand: multumMaster.gbo === 'B',
        }
      }
    }
  } catch {
    // multum_ndcs table doesn't exist — leave multumMaster.present = false.
  }

  // Phase B': mltm_* data-model identity. Independent of multum_csv — this
  // table set carries the actual generic name, strength description, and
  // dose form, which the older CSV never had. Run when we still don't have
  // a name (identity.source === 'unknown' or 'multum_csv' with blank generic).
  if (identity.genericName === '' && identity.source !== 'formulary') {
    try {
      const { rows: idRows } = await getDb().execute({
        sql: `SELECT (SELECT dn.drug_name FROM mltm_drug_name dn
                     WHERE dn.drug_synonym_id = di.drug_synonym_id
                       AND dn.is_obsolete = 'F'
                     ORDER BY dn.drug_name LIMIT 1) AS generic_name,
                     ps.product_strength_description AS strength_desc,
                     df.dose_form_description AS dose_form_desc
              FROM mltm_ndc n
              LEFT JOIN mltm_main_drug_code mc
                ON mc.main_multum_drug_code = n.main_multum_drug_code
              LEFT JOIN mltm_drug_id di ON di.drug_identifier = mc.drug_identifier
              LEFT JOIN mltm_product_strength ps
                ON ps.product_strength_code = mc.product_strength_code
              LEFT JOIN mltm_dose_form df ON df.dose_form_code = mc.dose_form_code
              WHERE n.ndc_formatted = ?
              LIMIT 1`,
        args: [trimmedNdc],
      })
      if (idRows.length > 0) {
        const m = idRows[0]
        const genericName = (m.generic_name as string | null) ?? ''
        const strengthDesc = (m.strength_desc as string | null) ?? ''
        const formDesc = (m.dose_form_desc as string | null) ?? ''
        // strength_desc from Multum is a single string like "40 mg" or "20 mg/5 mL".
        // We don't try to split into number+unit here — the formulary path stores
        // those separately, but for display the combined string is fine.
        if (genericName) {
          identity = {
            ...identity,
            // Keep multum_csv-derived numeric fields (awpCost, packageSize, …)
            // but flip the source to advertise the new data.
            source: 'multum_data_model',
            description: identity.description ||
              [genericName, strengthDesc, formDesc].filter(Boolean).join(' '),
            genericName,
            strength: strengthDesc,
            strengthUnit: '',
            dosageForm: formDesc,
          }
        }
      }
    } catch {
      // mltm_* tables not loaded — leave identity as-is.
    }
  }

  // Phase C: stacking probe. Runs only when no Cerner build anywhere — i.e.
  // we'd otherwise emit D or E. When builds exist, A/B/B' have already won
  // and stacking is moot.
  //
  // Multi-facility note: the probe's SQL is scoped to a single Cerner domain.
  // For a cross-domain selection we'd need to run the probe per-domain and
  // merge candidates. V1 keeps it simple — only run when exactly one domain
  // is in scope (which covers the common case: a site user picking their
  // own facility, or two facilities in the same domain). Cross-domain
  // selections fall through to D/E with `unverifiedStateC=true` flagging the
  // residual uncertainty.
  let stackProbe: StackProbeResult | null = null
  if (builds.length === 0 && facilityDomain) {
    try {
      // Pass the first selected facility for the per-build `flexedAtFacility`
      // breakdown on each candidate. With a single domain in scope, picking
      // any one selected facility is fine — the candidates that come back
      // are already filtered to this domain.
      stackProbe = await findStackCandidates(
        trimmedNdc,
        trimmedFacilities[0] ?? '',
        facilityDomain,
        env,
      )
    } catch {
      // mltm_* tables not loaded yet — leave stackProbe null. Loader hasn't run.
      stackProbe = null
    }
  }

  return {
    ndc: trimmedNdc,
    facilities: trimmedFacilities,
    // Back-compat: legacy callers / UI code reads `lookup.facility`.
    facility: trimmedFacilities.length === 1 ? trimmedFacilities[0] : '',
    facilityDomain,
    facilityDomains,
    identity,
    builds,
    multumMaster,
    stackProbe,
  }
}

/**
 * MMDC-based stacking probe.
 *
 * Conceptually:
 *   1. Look up the scanned NDC's main_multum_drug_code (MMDC) in mltm_ndc.
 *   2. Find all *active* sibling NDCs sharing that MMDC (excluding the scanned NDC).
 *   3. Find which of those siblings have a build (supply_records → formulary_groups)
 *      in the requested facility's Cerner domain.
 *   4. Coalesce by group — multiple sibling NDCs can map to the same CDM.
 *
 * Returns a `StackProbeResult` describing what was found. Caller decides what
 * to do with it (today: surface in trace; later: emit State C).
 *
 * Throws iff the mltm_* tables aren't present yet — caller should catch and
 * treat as "probe not available".
 */

/**
 * Lightweight Multum detail lookup for a single NDC. Used by the "click an NDC
 * to see Multum info" popover surfaced in the scanner sibling table and in the
 * SupplyTab. No facility scope, no diagnosis pipeline — just the raw Multum
 * fields a clinician would want to see at a glance: cost, package, identity.
 *
 * Returns null when neither Multum table has the NDC.
 */
export interface MultumNdcDetail {
  ndc: string
  /**
   * Main Multum Drug Code — Cerner's canonical stacking key. Two NDCs share an
   * MMDC iff Multum considers them the same formulation (same active
   * ingredient + route + dose form + strength).
   */
  mmdc: number | null
  awp: number | null
  aCost: number | null
  innerPkgSize: number | null
  outerPkgSize: number | null
  isUnitDose: boolean
  /** 'B' brand / 'G' generic / 'N' neither (OTC etc.). */
  gbo: string | null
  /** 'T' / 'F' from mltm_ndc.repackaged. */
  repackaged: string | null
  genericName: string | null
  strengthDescription: string | null
  doseFormDescription: string | null
  /** Manufacturer name from mltm_ndc_source. */
  manufacturerName: string | null
  /** OTC vs Rx status. */
  otcStatus: string | null
  /** Date this NDC was discontinued, when known. NULL = active. */
  obsoleteDate: string | null
  /** Controlled substance schedule (0/I-V) from mltm_main_drug_code. */
  csaSchedule: string | null
  /** AB rating from mltm_orange_book ('A', 'B', '1'..'10', 'O'). 'O' = Not Rated. */
  orangeBookRating: string | null
  /** Human description like "Therapeutically Equivalent". */
  orangeBookDescription: string | null
  /**
   * Multum pill-identification — imprint markings, color, shape, image
   * filename. `null` when the NDC isn't in the image table (~70% of NDCs).
   */
  imprint: MultumImprint | null
}

export interface MultumImprint {
  /** Imprint text on side 1 of the dosage form (e.g. "ZESTRIL 10"). */
  side1Marking: string | null
  /** Imprint text on side 2 (e.g. "131"). */
  side2Marking: string | null
  /** Whether the dosage form is scored. */
  scored: boolean
  /** Pill shape — "round", "oval", "capsule", etc. From `mltm_shape`. */
  shape: string | null
  /** Pill color — "pink/red", "blue/purple", etc. From `mltm_color`. */
  color: string | null
  /** Flavor for liquids/chewables — "cinnamon", "lemon", etc. From `mltm_flavor`. */
  flavor: string | null
  /** Additional dose form — "film coated", "sugar free", "alcohol free". */
  additionalDoseForm: string | null
  /**
   * Filename in Multum's image archive (`Zestril 10 mg.jpg`). The binary is
   * not in the xlsx — surfacing the filename alone is useful for users who
   * have access to the archive separately. Caller may render it differently
   * once an image-serving endpoint is wired up.
   */
  imageFilename: string | null
}

export async function lookupMultumForNdc(ndc: string): Promise<MultumNdcDetail | null> {
  const trimmed = ndc.trim()
  if (!trimmed) return null
  const db = getDb()

  // Single PK lookup against the denormalized table seeded by
  // scripts/load_multum_xlsx.ts (seedMultumCombined). One row per NDC with
  // identity, package, cost, manufacturer, orange-book rating, and the
  // pill-identification fields all pre-joined — replaces the previous
  // 3-query approach against multum_ndcs / mltm_ndc / mltm_ndc_image.
  try {
    const { rows } = await db.execute({
      sql: `SELECT ndc_formatted, mmdc,
                   awp, acquisition_cost, inner_package_size, outer_package_size,
                   is_unit_dose, gbo, repackaged,
                   generic_name, strength_description, dose_form_description,
                   manufacturer_name, otc_status, obsolete_date, csa_schedule,
                   orange_book_rating, orange_book_description,
                   imprint_side_1, imprint_side_2, is_scored,
                   pill_shape, pill_color, pill_flavor, additional_dose_form,
                   image_filename
            FROM multum_ndc_combined
            WHERE ndc_formatted = ?`,
      args: [trimmed],
    })
    if (rows.length === 0) return null
    const r = rows[0]
    const hasImprint =
      r.imprint_side_1 != null ||
      r.imprint_side_2 != null ||
      r.pill_shape != null ||
      r.pill_color != null ||
      r.pill_flavor != null ||
      r.additional_dose_form != null ||
      r.image_filename != null
    return {
      ndc: r.ndc_formatted as string,
      mmdc: r.mmdc as number | null,
      awp: r.awp as number | null,
      aCost: r.acquisition_cost as number | null,
      innerPkgSize: r.inner_package_size as number | null,
      outerPkgSize: r.outer_package_size as number | null,
      isUnitDose: (r.is_unit_dose as number | null) === 1,
      gbo: r.gbo as string | null,
      repackaged: r.repackaged === 1 ? 'T' : r.repackaged === 0 ? 'F' : null,
      genericName: r.generic_name as string | null,
      strengthDescription: r.strength_description as string | null,
      doseFormDescription: r.dose_form_description as string | null,
      manufacturerName: r.manufacturer_name as string | null,
      otcStatus: r.otc_status as string | null,
      obsoleteDate: r.obsolete_date as string | null,
      csaSchedule: r.csa_schedule as string | null,
      orangeBookRating: r.orange_book_rating as string | null,
      orangeBookDescription: r.orange_book_description as string | null,
      imprint: hasImprint
        ? {
            side1Marking: r.imprint_side_1 as string | null,
            side2Marking: r.imprint_side_2 as string | null,
            scored: (r.is_scored as number | null) === 1,
            shape: r.pill_shape as string | null,
            color: r.pill_color as string | null,
            flavor: r.pill_flavor as string | null,
            additionalDoseForm: r.additional_dose_form as string | null,
            imageFilename: r.image_filename as string | null,
          }
        : null,
    }
  } catch {
    // multum_ndc_combined not loaded yet — caller treats as "not in Multum".
    return null
  }
}

export async function findStackCandidates(
  ndc: string,
  facility: string,
  facilityDomain: string,
  environment: Environment,
): Promise<StackProbeResult> {
  const db = getDb()

  // Step 1 — scanned NDC's MMDC + formulation metadata for display.
  const { rows: scannedRows } = await db.execute({
    sql: `SELECT n.main_multum_drug_code AS mmdc,
                 mc.drug_identifier      AS drug_id,
                 di.is_single_ingredient AS single_ingredient,
                 ps.product_strength_description AS strength_desc,
                 df.dose_form_description AS form_desc,
                 (
                   SELECT dn.drug_name FROM mltm_drug_name dn
                   WHERE dn.drug_synonym_id = di.drug_synonym_id
                     AND dn.is_obsolete = 'F'
                   ORDER BY dn.drug_name
                   LIMIT 1
                 )                       AS drug_name
          FROM mltm_ndc n
          LEFT JOIN mltm_main_drug_code mc ON mc.main_multum_drug_code = n.main_multum_drug_code
          LEFT JOIN mltm_drug_id di ON di.drug_identifier = mc.drug_identifier
          LEFT JOIN mltm_product_strength ps ON ps.product_strength_code = mc.product_strength_code
          LEFT JOIN mltm_dose_form df ON df.dose_form_code = mc.dose_form_code
          WHERE n.ndc_formatted = ?
          LIMIT 1`,
    args: [ndc],
  })

  if (scannedRows.length === 0) {
    return {
      status: 'not_in_extract',
      mmdc: null,
      isSingleIngredient: null,
      formulationName: null,
      formulationDrugId: null,
      siblingCount: 0,
      candidates: [],
    }
  }

  const s = scannedRows[0]
  const mmdc = s.mmdc as number | null
  const drugName = (s.drug_name as string | null) ?? null
  const strengthDesc = (s.strength_desc as string | null) ?? null
  const formDesc = (s.form_desc as string | null) ?? null
  const formulationName = drugName
    ? [drugName, strengthDesc, formDesc].filter(Boolean).join(' ')
    : null
  const drugId = (s.drug_id as string | null) ?? null
  const singleFlag = s.single_ingredient as string | null
  const isSingleIngredient =
    singleFlag === 'T' ? true : singleFlag === 'F' ? false : null

  if (mmdc == null) {
    return {
      status: 'no_mmdc',
      mmdc: null,
      isSingleIngredient,
      formulationName,
      formulationDrugId: drugId,
      siblingCount: 0,
      candidates: [],
    }
  }

  // Step 2 — sibling count (active only, excluding the scanned NDC itself).
  const { rows: countRows } = await db.execute({
    sql: `SELECT COUNT(*) AS n
          FROM mltm_ndc
          WHERE main_multum_drug_code = ?
            AND ndc_formatted != ?
            AND obsolete_date IS NULL`,
    args: [mmdc, ndc],
  })
  const siblingCount = Number(countRows[0]?.n ?? 0)

  if (siblingCount === 0) {
    return {
      status: 'no_match',
      mmdc,
      isSingleIngredient,
      formulationName,
      formulationDrugId: drugId,
      siblingCount: 0,
      candidates: [],
    }
  }

  // Step 3+4 — siblings that have a build in the requested facility's domain,
  // coalesced by (domain, group_id). One row per (sibling_ndc, group_id) pair.
  const { rows: candRows } = await db.execute({
    sql: `SELECT n.ndc_formatted   AS sibling_ndc,
                 fg.domain          AS domain,
                 fg.group_id        AS group_id,
                 fg.charge_number   AS charge_number,
                 fg.pyxis_id        AS pyxis_id,
                 fg.description     AS description,
                 fg.inventory_json  AS inventory_json
          FROM mltm_ndc n
          JOIN supply_records sr ON sr.ndc = n.ndc_formatted
          JOIN formulary_groups fg
            ON fg.group_id = sr.group_id AND fg.domain = sr.domain
          WHERE n.main_multum_drug_code = ?
            AND n.ndc_formatted != ?
            AND n.obsolete_date IS NULL
            AND fg.environment = ?
            AND fg.domain = ?
          ORDER BY fg.group_id`,
    args: [mmdc, ndc, environment, facilityDomain],
  })

  // Coalesce by (domain, group_id) — multiple sibling NDCs can belong to the same CDM.
  const byGroup = new Map<string, StackCandidate>()
  for (const r of candRows) {
    const key = `${r.domain as string}::${r.group_id as string}`
    const existing = byGroup.get(key)
    const sibling = r.sibling_ndc as string

    if (existing) {
      if (!existing.matchedSiblingNdcs.includes(sibling)) {
        existing.matchedSiblingNdcs.push(sibling)
      }
      continue
    }

    let flexedAtFacility = false
    try {
      const inv = JSON.parse((r.inventory_json as string) || '{}') as {
        facilities?: Record<string, boolean>
      }
      flexedAtFacility = inv.facilities?.[facility] === true
    } catch { /* ignore */ }

    byGroup.set(key, {
      domain: r.domain as string,
      groupId: r.group_id as string,
      chargeNumber: (r.charge_number as string) ?? '',
      pyxisId: (r.pyxis_id as string) ?? '',
      description: (r.description as string) ?? '',
      flexedAtFacility,
      matchedSiblingNdcs: [sibling],
    })
  }

  const candidates = Array.from(byGroup.values())

  return {
    status: candidates.length > 0 ? 'match' : 'no_match',
    mmdc,
    isSingleIngredient,
    formulationName,
    formulationDrugId: drugId,
    siblingCount,
    candidates,
  }
}
