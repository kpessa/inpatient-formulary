import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { DesignPattern, PatternFieldRule, PatternOperator } from './types'
import type { Row } from '@libsql/client'

function rowToPattern(r: Row): Omit<DesignPattern, 'fieldRules'> {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? '',
    color: (r.color as string | null) ?? '#F97316',
    scopeType: (r.scope_type as DesignPattern['scopeType']) ?? 'all',
    scopeValue: (r.scope_value as string | null) ?? '',
  }
}

function rowToRule(r: Row): PatternFieldRule {
  return {
    id: r.id as string,
    patternId: r.pattern_id as string,
    field: r.field as string,
    operator: r.operator as PatternOperator,
    value: (r.value as string | null) ?? '',
    expectedDisplay: (r.expected_display as string | null) ?? '',
  }
}

export async function getAllPatternsWithRules(): Promise<DesignPattern[]> {
  const db = getDb()
  const [pResult, rResult] = await db.batch([
    { sql: 'SELECT * FROM design_patterns ORDER BY created_at', args: [] },
    { sql: 'SELECT * FROM pattern_field_rules ORDER BY created_at', args: [] },
  ], 'read')

  const rulesByPattern = new Map<string, PatternFieldRule[]>()
  for (const r of rResult.rows) {
    const rule = rowToRule(r)
    if (!rulesByPattern.has(rule.patternId)) rulesByPattern.set(rule.patternId, [])
    rulesByPattern.get(rule.patternId)!.push(rule)
  }

  return pResult.rows.map(r => ({
    ...rowToPattern(r),
    fieldRules: rulesByPattern.get(r.id as string) ?? [],
  }))
}

export async function createPattern(fields: {
  name: string
  description?: string
  color?: string
  scopeType?: DesignPattern['scopeType']
  scopeValue?: string
}): Promise<string> {
  const db = getDb()
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO design_patterns (id, name, description, color, scope_type, scope_value)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      fields.name,
      fields.description ?? '',
      fields.color ?? '#F97316',
      fields.scopeType ?? 'all',
      fields.scopeValue ?? '',
    ],
  })
  return id
}

export async function updatePattern(id: string, fields: {
  name?: string
  description?: string
  color?: string
  scopeType?: DesignPattern['scopeType']
  scopeValue?: string
}): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const args: unknown[] = []
  if (fields.name !== undefined)        { sets.push('name = ?');        args.push(fields.name) }
  if (fields.description !== undefined) { sets.push('description = ?'); args.push(fields.description) }
  if (fields.color !== undefined)       { sets.push('color = ?');       args.push(fields.color) }
  if (fields.scopeType !== undefined)   { sets.push('scope_type = ?');  args.push(fields.scopeType) }
  if (fields.scopeValue !== undefined)  { sets.push('scope_value = ?'); args.push(fields.scopeValue) }
  if (sets.length === 0) return
  args.push(id)
  await db.execute({ sql: `UPDATE design_patterns SET ${sets.join(', ')} WHERE id = ?`, args })
}

export async function deletePattern(id: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM design_patterns WHERE id = ?', args: [id] })
}

export async function addFieldRule(patternId: string, rule: {
  field: string
  operator: PatternOperator
  value?: string
  expectedDisplay?: string
}): Promise<string> {
  const db = getDb()
  const id = randomUUID()
  await db.execute({
    sql: `INSERT INTO pattern_field_rules (id, pattern_id, field, operator, value, expected_display)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, patternId, rule.field, rule.operator, rule.value ?? '', rule.expectedDisplay ?? ''],
  })
  return id
}

export async function deleteFieldRule(id: string): Promise<void> {
  const db = getDb()
  await db.execute({ sql: 'DELETE FROM pattern_field_rules WHERE id = ?', args: [id] })
}
