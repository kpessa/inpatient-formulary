import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { DrugCategory, CategoryRule, CategoryMember, CategoryExclusion } from './types'
import type { Row } from '@libsql/client'
import { tcDescendants } from './therapeutic-class-map'

function rowToCategory(r: Row, manualCount = 0, ruleCount = 0): DrugCategory {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? '',
    color: (r.color as string | null) ?? '#6B7280',
    manualCount,
    ruleCount,
    totalCount: manualCount,
  }
}

function rowToRule(r: Row): CategoryRule {
  return {
    id: r.id as string,
    categoryId: r.category_id as string,
    field: r.field as CategoryRule['field'],
    operator: r.operator as CategoryRule['operator'],
    value: r.value as string,
  }
}

function fieldToSqlExpression(field: string): string {
  switch (field) {
    case 'dispenseCategory': return "json_extract(dispense_json, '$.dispenseCategory')"
    case 'therapeuticClass': return "json_extract(clinical_json, '$.therapeuticClass')"
    case 'dosageForm':       return 'dosage_form'
    case 'status':           return 'status'
    case 'strength':         return 'strength'
    case 'description':      return 'description'
    case 'genericName':      return 'generic_name'
    case 'mnemonic':         return 'mnemonic'
    case 'brandName':        return 'brand_name'
    default:                 return 'NULL'
  }
}

function matchesRuleValue(field: string, operator: string, value: string, rawVal: string | null): boolean {
  if (rawVal === null) return false
  if (field === 'therapeuticClass' && operator === 'equals') {
    const codes = [value, ...tcDescendants(value)]
    return codes.includes(rawVal)
  }
  switch (operator) {
    case 'equals':         return rawVal === value
    case 'contains':       return rawVal.toLowerCase().includes(value.toLowerCase())
    case 'starts_with':    return rawVal.toLowerCase().startsWith(value.toLowerCase())
    case 'ends_with':      return rawVal.toLowerCase().endsWith(value.toLowerCase())
    case 'matches_regex': {
      // value is a wildcard pattern using * (converted to regex for in-memory matching)
      const regexStr = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      try { return new RegExp(regexStr, 'i').test(rawVal) } catch { return false }
    }
    case 'in': {
      const vals = value.split(',').map(v => v.trim().toLowerCase())
      return vals.includes(rawVal.toLowerCase())
    }
    default:               return rawVal === value
  }
}

function buildRuleClause(
  field: string,
  operator: string,
  value: string,
): { clause: string; args: string[] } {
  if (field === 'therapeuticClass' && operator === 'equals') {
    const codes = [value, ...tcDescendants(value)]
    if (codes.length === 1) return { clause: '= ?', args: [value] }
    return { clause: `IN (${codes.map(() => '?').join(',')})`, args: codes }
  }
  switch (operator) {
    case 'equals':         return { clause: '= ?',    args: [value] }
    case 'contains':       return { clause: 'LIKE ?',  args: [`%${value}%`] }
    case 'starts_with':    return { clause: 'LIKE ?',  args: [`${value}%`] }
    case 'ends_with':      return { clause: 'LIKE ?',  args: [`%${value}`] }
    case 'matches_regex': {
      // value uses * wildcards → translate to SQL LIKE %
      const likeVal = value.replace(/[%_]/g, c => `\\${c}`).replace(/\*/g, '%')
      return { clause: 'LIKE ?', args: [likeVal] }
    }
    case 'in': {
      const vals = value.split(',').map(v => v.trim()).filter(Boolean)
      return { clause: `IN (${vals.map(() => '?').join(',')})`, args: vals }
    }
    default:               return { clause: '= ?',     args: [value] }
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<DrugCategory[]> {
  const db = getDb()
  const { rows } = await db.execute(`
    SELECT
      dc.id, dc.name, dc.description, dc.color, dc.created_at,
      COUNT(DISTINCT cm.group_id) AS manual_count,
      COUNT(DISTINCT cr.id) AS rule_count
    FROM drug_categories dc
    LEFT JOIN category_members cm ON cm.category_id = dc.id
    LEFT JOIN category_rules cr ON cr.category_id = dc.id
    GROUP BY dc.id
    ORDER BY dc.name
  `)
  return rows.map(r =>
    rowToCategory(r, Number(r.manual_count), Number(r.rule_count))
  )
}

export async function createCategory(
  name: string,
  description: string,
  color: string,
): Promise<DrugCategory> {
  const db = getDb()
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO drug_categories (id, name, description, color) VALUES (?, ?, ?, ?)`,
    args: [id, name, description, color],
  })
  return { id, name, description, color, manualCount: 0, ruleCount: 0, totalCount: 0 }
}

export async function updateCategory(
  id: string,
  fields: Partial<Pick<DrugCategory, 'name' | 'description' | 'color'>>,
): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []
  if (fields.name        !== undefined) { sets.push('name = ?');        args.push(fields.name) }
  if (fields.description !== undefined) { sets.push('description = ?'); args.push(fields.description) }
  if (fields.color       !== undefined) { sets.push('color = ?');       args.push(fields.color) }
  if (sets.length === 0) return
  args.push(id)
  await db.execute({ sql: `UPDATE drug_categories SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function deleteCategory(id: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM drug_categories WHERE id = ?', args: [id] })
}

export async function getCategoryWithRules(
  id: string,
): Promise<{ category: DrugCategory; rules: CategoryRule[] } | null> {
  const db = getDb()
  const [{ rows: catRows }, { rows: ruleRows }, { rows: cntRows }] = await db.batch([
    { sql: 'SELECT * FROM drug_categories WHERE id = ?', args: [id] },
    { sql: 'SELECT * FROM category_rules WHERE category_id = ? ORDER BY created_at', args: [id] },
    { sql: 'SELECT COUNT(DISTINCT group_id) AS cnt FROM category_members WHERE category_id = ?', args: [id] },
  ], 'read')
  if (catRows.length === 0) return null
  const manualCount = Number(cntRows[0].cnt)
  return {
    category: rowToCategory(catRows[0], manualCount, ruleRows.length),
    rules: ruleRows.map(rowToRule),
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function addManualMember(
  categoryId: string,
  groupId: string,
  drugDescription: string,
): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: `INSERT OR REPLACE INTO category_members (category_id, group_id, drug_description) VALUES (?, ?, ?)`,
    args: [categoryId, groupId, drugDescription],
  })
}

export async function removeManualMember(categoryId: string, groupId: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: 'DELETE FROM category_members WHERE category_id = ? AND group_id = ?',
    args: [categoryId, groupId],
  })
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

export async function listExclusions(categoryId: string): Promise<CategoryExclusion[]> {
  const db = getDb()
  const { rows } = await db.execute({
    sql: 'SELECT group_id, drug_description FROM category_exclusions WHERE category_id = ? ORDER BY added_at',
    args: [categoryId],
  })
  return rows.map(r => ({ groupId: r.group_id as string, drugDescription: (r.drug_description as string | null) ?? '' }))
}

export async function addExclusion(categoryId: string, groupId: string, drugDescription: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: 'INSERT OR REPLACE INTO category_exclusions (category_id, group_id, drug_description) VALUES (?, ?, ?)',
    args: [categoryId, groupId, drugDescription],
  })
}

export async function removeExclusion(categoryId: string, groupId: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: 'DELETE FROM category_exclusions WHERE category_id = ? AND group_id = ?',
    args: [categoryId, groupId],
  })
}

export async function clearExclusions(categoryId: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM category_exclusions WHERE category_id = ?', args: [categoryId] })
}

export async function resolveCategoryMembers(categoryId: string): Promise<CategoryMember[]> {
  const db = getDb()

  const [{ rows: manualRows }, { rows: ruleRows }, { rows: exclusionRows }] = await db.batch([
    { sql: 'SELECT group_id, drug_description FROM category_members WHERE category_id = ?', args: [categoryId] },
    { sql: 'SELECT * FROM category_rules WHERE category_id = ?', args: [categoryId] },
    { sql: 'SELECT group_id, drug_description FROM category_exclusions WHERE category_id = ?', args: [categoryId] },
  ], 'read')

  const exclusionSet = new Set(exclusionRows.map(r => r.group_id as string))
  const seen = new Set<string>()
  const results: CategoryMember[] = []

  for (const r of manualRows) {
    const groupId = r.group_id as string
    if (exclusionSet.has(groupId)) continue  // manual member overridden by explicit exclusion
    seen.add(groupId)
    results.push({ groupId, drugDescription: (r.drug_description as string | null) ?? '', source: 'manual' })
  }

  for (const rule of ruleRows) {
    const fieldExpr = fieldToSqlExpression(rule.field as string)
    const { clause, args: ruleArgs } = buildRuleClause(rule.field as string, rule.operator as string, rule.value as string)
    const ruleId = rule.id as string

    const { rows } = await db.execute({
      sql: `SELECT DISTINCT group_id, description FROM formulary_groups WHERE ${fieldExpr} ${clause}`,
      args: [...ruleArgs],
    })
    for (const r of rows) {
      const groupId = r.group_id as string
      if (seen.has(groupId) || exclusionSet.has(groupId)) continue
      seen.add(groupId)
      results.push({ groupId, drugDescription: r.description as string, source: 'rule', ruleId })
    }
  }

  // Append exclusions at the end for display in CategoryManager
  for (const r of exclusionRows) {
    results.push({ groupId: r.group_id as string, drugDescription: (r.drug_description as string | null) ?? '', source: 'excluded' })
  }

  return results
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function addRule(
  categoryId: string,
  field: CategoryRule['field'],
  operator: CategoryRule['operator'],
  value: string,
): Promise<CategoryRule> {
  const db = getDb()
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO category_rules (id, category_id, field, operator, value) VALUES (?, ?, ?, ?, ?)`,
    args: [id, categoryId, field, operator, value],
  })
  return { id, categoryId, field, operator, value }
}

export async function removeRule(ruleId: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM category_rules WHERE id = ?', args: [ruleId] })
}

export async function clearRules(categoryId: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM category_rules WHERE category_id = ?', args: [categoryId] })
}

// ---------------------------------------------------------------------------
// Pyxis ID lists
// ---------------------------------------------------------------------------

export async function getCategoryPyxisIds(categoryId: string): Promise<string[]> {
  const db = getDb()
  const { rows } = await db.execute({
    sql: 'SELECT pyxis_id FROM category_pyxis_ids WHERE category_id = ? ORDER BY added_at',
    args: [categoryId],
  })
  return rows.map(r => r.pyxis_id as string)
}

export async function addCategoryPyxisId(categoryId: string, pyxisId: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: 'INSERT OR IGNORE INTO category_pyxis_ids (category_id, pyxis_id) VALUES (?, ?)',
    args: [categoryId, pyxisId.trim()],
  })
}

export async function removeCategoryPyxisId(categoryId: string, pyxisId: string): Promise<void> {
  const db = getDb()
  await db.execute({
    sql: 'DELETE FROM category_pyxis_ids WHERE category_id = ? AND pyxis_id = ?',
    args: [categoryId, pyxisId],
  })
}

// Resolve all rules for a category, look up pyxis_id for each matched group, and
// bulk-insert the results into category_pyxis_ids. Returns the count of newly added IDs.
export async function populatePyxisIdsFromRules(categoryId: string): Promise<number> {
  const db = getDb()
  const { rows: ruleRows } = await db.execute({
    sql: 'SELECT field, operator, value FROM category_rules WHERE category_id = ?',
    args: [categoryId],
  })
  if (ruleRows.length === 0) return 0

  const seen = new Set<string>()
  for (const rule of ruleRows) {
    const fieldExpr = fieldToSqlExpression(rule.field as string)
    const { clause, args: ruleArgs } = buildRuleClause(rule.field as string, rule.operator as string, rule.value as string)
    const { rows } = await db.execute({
      sql: `SELECT DISTINCT pyxis_id FROM formulary_groups WHERE pyxis_id != '' AND ${fieldExpr} ${clause}`,
      args: [...ruleArgs],
    })
    for (const r of rows) seen.add(r.pyxis_id as string)
  }

  if (seen.size === 0) return 0
  // Bulk-insert using individual INSERT OR IGNORE statements in a batch
  const stmts = [...seen].map(pid => ({
    sql: 'INSERT OR IGNORE INTO category_pyxis_ids (category_id, pyxis_id) VALUES (?, ?)',
    args: [categoryId, pid],
  }))
  await db.batch(stmts, 'write')
  return seen.size
}

export async function getGroupIdCategories(
  groupIds: string[]
): Promise<Record<string, { id: string; name: string; color: string }[]>> {
  if (groupIds.length === 0) return {}
  const db = getDb()
  const result: Record<string, { id: string; name: string; color: string }[]> = {}
  const placeholders = groupIds.map(() => '?').join(',')

  const addMatch = (groupId: string, cat: { id: string; name: string; color: string }) => {
    if (!result[groupId]) result[groupId] = []
    if (!result[groupId].some(c => c.id === cat.id)) result[groupId].push(cat)
  }

  // Manual membership
  const { rows: manualRows } = await db.execute({
    sql: `SELECT cm.group_id, dc.id AS category_id, dc.name, dc.color
          FROM category_members cm
          JOIN drug_categories dc ON dc.id = cm.category_id
          WHERE cm.group_id IN (${placeholders})`,
    args: groupIds,
  })
  for (const r of manualRows) {
    addMatch(r.group_id as string, {
      id: r.category_id as string,
      name: r.name as string,
      color: (r.color as string | null) ?? '#6B7280',
    })
  }

  // Rule-based membership — fetch all rules + all needed fields in 2 queries, match in memory
  const [{ rows: ruleRows }, { rows: fieldRows }] = await Promise.all([
    db.execute(`
      SELECT cr.field, cr.operator, cr.value,
             dc.id AS category_id, dc.name, dc.color
      FROM category_rules cr
      JOIN drug_categories dc ON dc.id = cr.category_id
    `),
    db.execute({
      sql: `SELECT group_id,
                   dosage_form,
                   status,
                   strength,
                   json_extract(dispense_json, '$.dispenseCategory') AS dispenseCategory,
                   json_extract(clinical_json, '$.therapeuticClass') AS therapeuticClass
            FROM formulary_groups
            WHERE group_id IN (${placeholders})
            GROUP BY group_id`,
      args: groupIds,
    }),
  ])
  const fieldMap = new Map<string, Record<string, string | null>>()
  for (const r of fieldRows) {
    fieldMap.set(r.group_id as string, {
      dosageForm:       r.dosage_form as string | null,
      status:           r.status as string | null,
      strength:         r.strength as string | null,
      dispenseCategory: r.dispenseCategory as string | null,
      therapeuticClass: r.therapeuticClass as string | null,
    })
  }
  for (const rule of ruleRows) {
    const field    = rule.field as string
    const operator = rule.operator as string
    const value    = rule.value as string
    const cat = {
      id:    rule.category_id as string,
      name:  rule.name as string,
      color: (rule.color as string | null) ?? '#6B7280',
    }
    for (const [groupId, fields] of fieldMap) {
      if (matchesRuleValue(field, operator, value, fields[field] ?? null)) {
        addMatch(groupId, cat)
      }
    }
  }

  return result
}
