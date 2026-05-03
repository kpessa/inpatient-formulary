// Shared category matching for the standardization backlog + extract changes
// admin views. Both surfaces need to evaluate "which categories does this
// drug belong to?" — duplicating the logic was painful, so this lib owns
// the data model + matching function and both routes consume it.
//
// Categories are the user-facing groupings (Half-tab, CNS Stimulants, etc.)
// stored in `drug_categories`. Membership comes from three independent
// sources, in priority order:
//   1. Exclusion (category_exclusions) — overrides everything; drug is OUT
//   2. Explicit member (category_members.group_id) — drug is IN
//   3. Explicit Pyxis ID (category_pyxis_ids) — drug is IN if pyxis matches
//   4. Rule-based (category_rules) — drug is IN if it matches ALL rules
//
// Rules use camelCase field names (matching the FormularyItem object
// model and the CategoryRule TS type); this module translates them to the
// snake_case columns that come back from `formulary_groups` queries.

import type { Client } from '@libsql/client'

// ── Drug shape ─────────────────────────────────────────────────────────────
// Subset of formulary_groups columns rules can match on. Add fields here
// to expose them to the rule evaluator. Both `PATTERN_FIELD_TO_ROW_FIELD`
// (camelCase rule-field name → key here) and the lookup of column values
// reference this shape.
export interface DrugFacts {
  description: string
  generic_name: string
  mnemonic: string
  dosage_form: string
  strength: string
  strength_unit: string
  brand_name: string
  charge_number: string
  pyxis_id: string
  therapeutic_class: string
  dispense_category: string
  route: string
  status: string
  legal_status: string
}

const RULE_FIELD_TO_DRUG_KEY: Record<string, keyof DrugFacts> = {
  description: 'description',
  genericName: 'generic_name',
  mnemonic: 'mnemonic',
  dosageForm: 'dosage_form',
  strength: 'strength',
  strengthUnit: 'strength_unit',
  brandName: 'brand_name',
  chargeNumber: 'charge_number',
  pyxisId: 'pyxis_id',
  therapeuticClass: 'therapeutic_class',
  dispenseCategory: 'dispense_category',
  route: 'route',
  status: 'status',
  // legal_status carries values like "OTC", "Rx", controlled-substance
  // schedule codes, etc. Useful for OTC categorization rule.
  legalStatus: 'legal_status',
}

// ── Category model ─────────────────────────────────────────────────────────
export interface CategoryRule {
  field: string
  operator: string
  value: string
  negated: boolean
}

export interface CategoryDef {
  id: string
  name: string
  color: string
  description: string
  rules: CategoryRule[]
  members: Set<string>     // explicit group_ids
  pyxisIds: Set<string>    // explicit pyxis_ids
  exclusions: Set<string>  // group_ids explicitly excluded
}

// ── Loader ─────────────────────────────────────────────────────────────────
// Pulls every category with all its membership criteria. Returns [] (without
// throwing) if the tables don't exist yet — useful for fresh DBs.
export async function loadCategories(db: Client): Promise<CategoryDef[]> {
  try {
    const [cRows, rRows, mRows, pRows, xRows] = await Promise.all([
      db.execute(`SELECT id, name, color, COALESCE(description, '') AS description FROM drug_categories ORDER BY name`),
      db.execute(`SELECT category_id, field, operator, value, COALESCE(negated, 0) AS negated FROM category_rules`),
      db.execute(`SELECT category_id, group_id FROM category_members`),
      db.execute(`SELECT category_id, pyxis_id FROM category_pyxis_ids`),
      db.execute(`SELECT category_id, group_id FROM category_exclusions`),
    ])

    const rulesById = new Map<string, CategoryRule[]>()
    for (const r of rRows.rows) {
      const cid = String(r.category_id)
      const arr = rulesById.get(cid) ?? []
      arr.push({
        field: String(r.field),
        operator: String(r.operator),
        value: String(r.value ?? ''),
        negated: Number(r.negated) === 1,
      })
      rulesById.set(cid, arr)
    }
    const setIndex = (rows: { rows: unknown[] }) => {
      const m = new Map<string, Set<string>>()
      for (const r of (rows.rows as Record<string, unknown>[])) {
        const cid = String(r.category_id)
        const target = String(r.group_id ?? r.pyxis_id ?? '')
        let s = m.get(cid); if (!s) { s = new Set(); m.set(cid, s) }
        s.add(target)
      }
      return m
    }
    const membersById    = setIndex(mRows)
    const pyxisById      = setIndex(pRows)
    const exclusionsById = setIndex(xRows)

    return cRows.rows.map(c => {
      const id = String(c.id)
      return {
        id,
        name: String(c.name),
        color: String(c.color ?? '#6B7280'),
        description: String(c.description ?? ''),
        rules: rulesById.get(id) ?? [],
        members: membersById.get(id) ?? new Set(),
        pyxisIds: pyxisById.get(id) ?? new Set(),
        exclusions: exclusionsById.get(id) ?? new Set(),
      }
    })
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return []
    throw err
  }
}

// ── Rule + category matching (pure functions) ──────────────────────────────
function evaluateRule(rule: CategoryRule, drug: DrugFacts): boolean {
  const colKey = RULE_FIELD_TO_DRUG_KEY[rule.field]
  if (!colKey) return false
  const value = drug[colKey] ?? ''
  let result: boolean
  switch (rule.operator) {
    case 'equals':         result = value === rule.value; break
    case 'not_equals':     result = value !== rule.value; break
    case 'contains':       result = value.includes(rule.value); break
    case 'not_contains':   result = !value.includes(rule.value); break
    case 'starts_with':    result = value.startsWith(rule.value); break
    case 'ends_with':      result = value.endsWith(rule.value); break
    case 'not_empty':      result = value.length > 0; break
    case 'in':             result = rule.value.split(',').map(v => v.trim()).includes(value); break
    case 'matches_regex':
      try { result = new RegExp(rule.value).test(value) } catch { result = false }
      break
    default: result = false
  }
  return rule.negated ? !result : result
}

// Resolves whether `drug` (with associated `groupIds` across domains and a
// representative `pyxisId`) belongs to `cat`. Honors all four membership
// signals: exclusion (overrides), explicit members, explicit pyxis IDs,
// rule-based. Categories with NO criteria match nothing (defensive — would
// otherwise tag every drug).
export function matchesCategory(
  cat: CategoryDef,
  drug: DrugFacts,
  groupIds: string[],
  pyxisId: string,
): boolean {
  for (const gid of groupIds) if (cat.exclusions.has(gid)) return false
  for (const gid of groupIds) if (cat.members.has(gid)) return true
  if (pyxisId && cat.pyxisIds.has(pyxisId)) return true
  if (cat.rules.length > 0) {
    for (const r of cat.rules) if (!evaluateRule(r, drug)) return false
    return true
  }
  return false
}

// Convenience: returns the categories a drug matches, in their declaration
// order. Empty array if none matched.
export function categoriesForDrug(
  cats: CategoryDef[],
  drug: DrugFacts,
  groupIds: string[],
  pyxisId: string,
): CategoryDef[] {
  return cats.filter(c => matchesCategory(c, drug, groupIds, pyxisId))
}
