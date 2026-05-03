import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { loadCategories, categoriesForDrug, type DrugFacts } from '@/lib/category-matcher'

// Standardization backlog — for architect+ workflow.
//
// Sources from the LATEST extract_run. Lists drugs with `new_build` events
// whose prod coverage is incomplete (built in some prod regions, not others)
// — the work an architect needs to do to standardize the formulary across
// W/C/E prod environments.
//
// Each row carries:
//   - identifiers (description, CDM, Pyxis, generic_name, strength, form)
//   - prod regions where the drug currently exists
//   - total distinct facilities the drug is active at across prod domains
//     (used for impact-based prioritization — drugs at more sites should
//     usually be standardized first)
//   - is_onboarding_related: drug also has facility_onboarding events,
//     i.e. it was part of a recent go-live (Phase 2 etc).
//
// Returns nothing if no extract runs are recorded yet (404 with empty list).

interface BacklogRow {
  drug_key: string
  description: string
  charge_number: string
  pyxis_id: string
  generic_name: string
  strength: string
  strength_unit: string
  dosage_form: string
  group_ids: string[]
  prod_regions_built: string[]
  cert_regions_built: string[]
  prod_facility_count: number
  total_domain_count: number
  is_onboarding_related: boolean
  // Reference-status: the drug has at least one supply NDC that matches a
  // Multum reference row. Reference drugs are quick wins for backfill
  // because the build data is ready. Non-reference (custom) builds —
  // half-tabs, neonatal syringes, ADC oral liquids, one-liner Pyxis-only
  // products — require manual setup and are typically slower work.
  is_reference: boolean
  ref_ndc_count: number
  supply_count: number
  // Pattern-Manager-driven categorization. Empty array if no pattern matched.
  // See memory entry project_drug_categorization.md for the design.
  categories: { id: string; name: string; color: string }[]
}

export async function GET() {
  const db = getDb()

  let runRow: Record<string, unknown> | null = null
  try {
    const r = await db.execute(`SELECT id FROM extract_runs ORDER BY ran_at DESC LIMIT 1`)
    runRow = (r.rows[0] as unknown as Record<string, unknown>) ?? null
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      return NextResponse.json({ run_id: null, rows: [] }, { status: 404 })
    }
    throw err
  }
  if (!runRow) return NextResponse.json({ run_id: null, rows: [] }, { status: 404 })
  const runId = runRow.id as string

  // Load all categories + their membership criteria via the shared matcher
  // (used by both this API and the extract-changes API). Pattern Manager
  // is intentionally NOT consulted here — those are linter rules.
  const categories = await loadCategories(db)

  // Pull every (domain, group_id) pair that had a new_build event in this
  // run, joined to its current formulary_groups row. Also pull facility_
  // onboarding events so we can flag drugs that came along with a go-live.
  //
  // ref_ndc_count := count of supply NDCs that match a Multum reference row.
  // A drug with ≥1 ref NDC is "reference" — easier to backfill because the
  // build data already exists. Done as a correlated subquery so we get one
  // count per (domain, group_id) row and roll it up across the drug's domains
  // in JS below.
  const result = await db.execute({
    sql: `SELECT
            ec.event_type, ec.domain, ec.group_id,
            COALESCE(fg.description, '')   AS description,
            COALESCE(fg.charge_number, '') AS charge_number,
            COALESCE(fg.pyxis_id, '')      AS pyxis_id,
            COALESCE(fg.generic_name, '')  AS generic_name,
            COALESCE(fg.mnemonic, '')      AS mnemonic,
            COALESCE(fg.brand_name, '')    AS brand_name,
            COALESCE(fg.strength, '')      AS strength,
            COALESCE(fg.strength_unit, '') AS strength_unit,
            COALESCE(fg.dosage_form, '')        AS dosage_form,
            COALESCE(fg.therapeutic_class, '')  AS therapeutic_class,
            COALESCE(fg.dispense_category, '')  AS dispense_category,
            COALESCE(fg.route, '')              AS route,
            COALESCE(fg.status, '')             AS status,
            COALESCE(fg.legal_status, '')       AS legal_status,
            COALESCE(fg.inventory_json, '{}') AS inventory_json,
            (SELECT COUNT(*) FROM supply_records sr
              JOIN multum_ndcs mn ON mn.ndc_formatted = sr.ndc
              WHERE sr.domain = ec.domain AND sr.group_id = ec.group_id) AS ref_ndc_count,
            (SELECT COUNT(*) FROM supply_records sr
              WHERE sr.domain = ec.domain AND sr.group_id = ec.group_id) AS supply_count
          FROM extract_changes ec
          LEFT JOIN formulary_groups fg
            ON fg.domain = ec.domain AND fg.group_id = ec.group_id
          WHERE ec.run_id = ?
            AND ec.event_type IN ('new_build', 'facility_onboarding')`,
    args: [runId],
  })

  // Drug-key by CDM (admin-recognizable identifier), falling back to a
  // (description, strength, dosage_form) tuple for drugs without one.
  function keyOf(r: Record<string, unknown>): string {
    const cdm = String(r.charge_number ?? '')
    if (cdm) return `cdm:${cdm}`
    return `desc:${r.description}|${r.strength}|${r.strength_unit}|${r.dosage_form}`
  }

  type DrugAcc = {
    drug_key: string
    description: string
    charge_number: string
    pyxis_id: string
    generic_name: string
    mnemonic: string
    brand_name: string
    strength: string
    strength_unit: string
    dosage_form: string
    therapeutic_class: string
    dispense_category: string
    route: string
    status: string
    legal_status: string
    group_ids: Set<string>
    domains_seen: Set<string>
    prod_regions: Set<string>
    cert_regions: Set<string>
    prod_facilities: Set<string>
    has_new_build: boolean
    has_onboarding: boolean
    ref_ndc_count: number      // sum across all (domain, group_id) rows
    supply_count: number       // sum across all (domain, group_id) rows
  }

  const drugs = new Map<string, DrugAcc>()

  for (const row of result.rows as unknown as Record<string, unknown>[]) {
    const key = keyOf(row)
    let acc = drugs.get(key)
    if (!acc) {
      acc = {
        drug_key: key,
        description: String(row.description ?? ''),
        charge_number: String(row.charge_number ?? ''),
        pyxis_id: String(row.pyxis_id ?? ''),
        generic_name: String(row.generic_name ?? ''),
        mnemonic: String(row.mnemonic ?? ''),
        brand_name: String(row.brand_name ?? ''),
        strength: String(row.strength ?? ''),
        strength_unit: String(row.strength_unit ?? ''),
        dosage_form: String(row.dosage_form ?? ''),
        therapeutic_class: String(row.therapeutic_class ?? ''),
        dispense_category: String(row.dispense_category ?? ''),
        route: String(row.route ?? ''),
        status: String(row.status ?? ''),
        legal_status: String(row.legal_status ?? ''),
        group_ids: new Set(),
        domains_seen: new Set(),
        prod_regions: new Set(),
        cert_regions: new Set(),
        prod_facilities: new Set(),
        has_new_build: false,
        has_onboarding: false,
        ref_ndc_count: 0,
        supply_count: 0,
      }
      drugs.set(key, acc)
    }
    // Sum reference + supply NDC counts across all (domain, group_id) rows
    // for this drug. Note: there will be duplicate counting if the same NDC
    // exists across cert+prod (which it usually does), but for the boolean
    // is_reference signal we just need >0, so duplicates don't matter.
    acc.ref_ndc_count += Number(row.ref_ndc_count ?? 0)
    acc.supply_count  += Number(row.supply_count ?? 0)
    // Some drug rows may have empty fields if certain domains are missing
    // them — backfill from any non-empty row we encounter.
    if (!acc.description && row.description) acc.description = String(row.description)
    if (!acc.pyxis_id && row.pyxis_id) acc.pyxis_id = String(row.pyxis_id)
    if (!acc.generic_name && row.generic_name) acc.generic_name = String(row.generic_name)
    if (!acc.mnemonic && row.mnemonic) acc.mnemonic = String(row.mnemonic)
    if (!acc.brand_name && row.brand_name) acc.brand_name = String(row.brand_name)
    if (!acc.therapeutic_class && row.therapeutic_class) acc.therapeutic_class = String(row.therapeutic_class)
    if (!acc.dispense_category && row.dispense_category) acc.dispense_category = String(row.dispense_category)
    if (!acc.route && row.route) acc.route = String(row.route)
    if (!acc.status && row.status) acc.status = String(row.status)
    if (!acc.legal_status && row.legal_status) acc.legal_status = String(row.legal_status)

    acc.group_ids.add(String(row.group_id))
    acc.domains_seen.add(String(row.domain))
    const [region, env] = String(row.domain).split('_')
    if (env === 'prod') acc.prod_regions.add(region)
    if (env === 'cert') acc.cert_regions.add(region)

    if (row.event_type === 'new_build') acc.has_new_build = true
    if (row.event_type === 'facility_onboarding') acc.has_onboarding = true

    // Count distinct prod facilities the drug is active at, across all its
    // prod-domain inventory rows.
    if (env === 'prod') {
      try {
        const inv = JSON.parse(String(row.inventory_json ?? '{}'))
        const facs = inv.facilities ?? {}
        for (const [name, on] of Object.entries(facs)) if (on) acc.prod_facilities.add(name)
      } catch { /* unparseable inventory json — skip */ }
    }
  }

  const rows: BacklogRow[] = []
  for (const acc of drugs.values()) {
    if (!acc.has_new_build) continue            // worklist is keyed on new_build
    if (acc.prod_regions.size === 3) continue   // already at full prod coverage — out of scope

    // Evaluate categories against this drug.
    const drugFacts: DrugFacts = {
      description: acc.description,
      generic_name: acc.generic_name,
      mnemonic: acc.mnemonic,
      dosage_form: acc.dosage_form,
      strength: acc.strength,
      strength_unit: acc.strength_unit,
      brand_name: acc.brand_name,
      charge_number: acc.charge_number,
      pyxis_id: acc.pyxis_id,
      therapeutic_class: acc.therapeutic_class,
      dispense_category: acc.dispense_category,
      route: acc.route,
      status: acc.status,
      legal_status: acc.legal_status,
    }
    const matched = categoriesForDrug(categories, drugFacts, [...acc.group_ids], acc.pyxis_id)
      .map(c => ({ id: c.id, name: c.name, color: c.color }))

    rows.push({
      drug_key: acc.drug_key,
      description: acc.description,
      charge_number: acc.charge_number,
      pyxis_id: acc.pyxis_id,
      generic_name: acc.generic_name,
      strength: acc.strength,
      strength_unit: acc.strength_unit,
      dosage_form: acc.dosage_form,
      group_ids: [...acc.group_ids],
      prod_regions_built: [...acc.prod_regions].sort(),
      cert_regions_built: [...acc.cert_regions].sort(),
      prod_facility_count: acc.prod_facilities.size,
      total_domain_count: acc.domains_seen.size,
      is_onboarding_related: acc.has_onboarding,
      is_reference: acc.ref_ndc_count > 0,
      ref_ndc_count: acc.ref_ndc_count,
      supply_count: acc.supply_count,
      categories: matched,
    })
  }

  // Cache aggressively at the Vercel CDN. Same rationale as the
  // /api/admin/extract-changes route — data changes only when a new
  // extract is deployed; the SQL has correlated subqueries that take
  // ~20-30s direct-to-Turso. Cache hit is ~100ms.
  return NextResponse.json({ run_id: runId, rows }, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
  })
}
