import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { SearchFilterGroup } from './types'
import type { Row } from '@libsql/client'

async function ensureTable() {
  const db = getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS search_filter_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      icon        TEXT NOT NULL DEFAULT '',
      field       TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `)
}

function rowToGroup(r: Row): SearchFilterGroup {
  return {
    id:        r.id as string,
    name:      r.name as string,
    icon:      (r.icon as string | null) ?? '',
    field:     r.field as SearchFilterGroup['field'],
    values:    JSON.parse((r.values_json as string | null) ?? '[]') as string[],
    sortOrder: (r.sort_order as number | null) ?? 0,
  }
}

export async function listFilterGroups(): Promise<SearchFilterGroup[]> {
  await ensureTable()
  const db = getDb()
  const { rows } = await db.execute(
    'SELECT * FROM search_filter_groups ORDER BY sort_order, name'
  )
  return rows.map(rowToGroup)
}

export async function createFilterGroup(data: {
  name: string
  icon: string
  field: SearchFilterGroup['field']
  values: string[]
  sortOrder?: number
}): Promise<SearchFilterGroup> {
  await ensureTable()
  const db = getDb()
  const id = randomUUID()
  const sortOrder = data.sortOrder ?? 0
  await db.execute({
    sql: `INSERT INTO search_filter_groups (id, name, icon, field, values_json, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, data.name, data.icon, data.field, JSON.stringify(data.values), sortOrder],
  })
  return { id, name: data.name, icon: data.icon, field: data.field, values: data.values, sortOrder }
}

export async function updateFilterGroup(
  id: string,
  data: Partial<Pick<SearchFilterGroup, 'name' | 'icon' | 'field' | 'values' | 'sortOrder'>>,
): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: (string | number)[] = []
  if (data.name      !== undefined) { sets.push('name = ?');        args.push(data.name) }
  if (data.icon      !== undefined) { sets.push('icon = ?');        args.push(data.icon) }
  if (data.field     !== undefined) { sets.push('field = ?');       args.push(data.field) }
  if (data.values    !== undefined) { sets.push('values_json = ?'); args.push(JSON.stringify(data.values)) }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?');  args.push(data.sortOrder) }
  if (sets.length === 0) return
  args.push(id)
  await db.execute({ sql: `UPDATE search_filter_groups SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function deleteFilterGroup(id: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM search_filter_groups WHERE id = ?', args: [id] })
}

const VALID_FIELDS = new Set(['dosage_form', 'route', 'dispense_category'])

export async function getDistinctFieldValues(
  field: SearchFilterGroup['field'],
): Promise<string[]> {
  if (!VALID_FIELDS.has(field)) return []
  const db = getDb()
  // field is validated against VALID_FIELDS above — safe to interpolate
  const { rows } = await db.execute(
    `SELECT DISTINCT ${field} AS val FROM formulary_groups WHERE ${field} != '' ORDER BY ${field}`
  )
  return rows.map(r => r.val as string)
}
