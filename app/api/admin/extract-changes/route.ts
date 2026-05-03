import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { loadCategories, categoriesForDrug, type DrugFacts } from '@/lib/category-matcher'

// GET /api/admin/extract-changes?run_id=<id>
// If run_id omitted, returns the latest run.
//
// Response shape:
//   {
//     run: { id, ran_at, prev_run_id, summary: {...} },
//     prev_runs: [{id, ran_at}, ...],   // for a run-picker UI later
//     changes: [
//       { id, change_type, domain, group_id, description, field_diffs: [{field,old,new}] }
//     ]
//   }
//
// Returns 404 with an empty payload if no extract_runs exist yet.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const runIdParam = searchParams.get('run_id')

  const db = getDb()

  // Resolve target run. Tables may not exist yet (pre-bootstrap on a fresh
  // DB) — treat that the same as "no runs recorded" and return 404 with
  // empty payload, which the page renders as a friendly "not yet" state.
  let runRow: Record<string, unknown> | null = null
  try {
    if (runIdParam) {
      const r = await db.execute({ sql: `SELECT id, ran_at, prev_run_id, summary_json FROM extract_runs WHERE id = ?`, args: [runIdParam] })
      runRow = (r.rows[0] as unknown as Record<string, unknown>) ?? null
    } else {
      const r = await db.execute(`SELECT id, ran_at, prev_run_id, summary_json FROM extract_runs ORDER BY ran_at DESC LIMIT 1`)
      runRow = (r.rows[0] as unknown as Record<string, unknown>) ?? null
    }
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      return NextResponse.json({ run: null, prev_runs: [], changes: [] }, { status: 404 })
    }
    throw err
  }

  if (!runRow) {
    return NextResponse.json({ run: null, prev_runs: [], changes: [] }, { status: 404 })
  }

  const runId = runRow.id as string
  const summary = JSON.parse((runRow.summary_json as string) ?? '{}')

  // LEFT JOIN to formulary_groups so each change row carries the admin-
  // recognizable identifiers (CDM/charge_number, pyxis_id) and the context
  // fields the category matcher needs (therapeutic_class, dispense_category,
  // route, status, etc). Removed-drug rows won't join — LEFT JOIN handles
  // that with NULLs we coalesce to ''.
  const [prevRuns, changes, categories] = await Promise.all([
    db.execute(`SELECT id, ran_at FROM extract_runs ORDER BY ran_at DESC LIMIT 20`),
    db.execute({
      sql: `SELECT
              ec.id, ec.change_type, ec.event_type, ec.domain, ec.group_id,
              ec.description, ec.field_diffs_json,
              COALESCE(fg.charge_number, '')      AS charge_number,
              COALESCE(fg.pyxis_id, '')           AS pyxis_id,
              COALESCE(fg.generic_name, '')       AS generic_name,
              COALESCE(fg.mnemonic, '')           AS mnemonic,
              COALESCE(fg.brand_name, '')         AS brand_name,
              COALESCE(fg.strength, '')           AS strength,
              COALESCE(fg.strength_unit, '')      AS strength_unit,
              COALESCE(fg.dosage_form, '')        AS dosage_form,
              COALESCE(fg.therapeutic_class, '')  AS therapeutic_class,
              COALESCE(fg.dispense_category, '')  AS dispense_category,
              COALESCE(fg.route, '')              AS route,
              COALESCE(fg.status, '')             AS status,
              COALESCE(fg.legal_status, '')       AS legal_status
            FROM extract_changes ec
            LEFT JOIN formulary_groups fg
              ON fg.domain = ec.domain AND fg.group_id = ec.group_id
            WHERE ec.run_id = ?
            ORDER BY ec.description, ec.domain, ec.event_type`,
      args: [runId],
    }),
    loadCategories(db),
  ])

  // Cache aggressively at the Vercel CDN. The data only changes when a new
  // extract is deployed (every few months) AND deploy-db.sh runs the compute
  // step at the end. s-maxage=600 → CDN caches for 10 min; stale-while-
  // revalidate=60 → serves stale up to 1 min while refetching in the
  // background. Direct-to-Turso queries are slow on serverless (~28s for
  // this 2.6MB response), so the cache hit is a ~280x speedup.
  return NextResponse.json({
    run: {
      id: runId,
      ran_at: runRow.ran_at,
      prev_run_id: runRow.prev_run_id,
      summary,
    },
    prev_runs: prevRuns.rows,
    changes: changes.rows.map(r => {
      const drugFacts: DrugFacts = {
        description: String(r.description ?? ''),
        generic_name: String(r.generic_name ?? ''),
        mnemonic: String(r.mnemonic ?? ''),
        dosage_form: String(r.dosage_form ?? ''),
        strength: String(r.strength ?? ''),
        strength_unit: String(r.strength_unit ?? ''),
        brand_name: String(r.brand_name ?? ''),
        charge_number: String(r.charge_number ?? ''),
        pyxis_id: String(r.pyxis_id ?? ''),
        therapeutic_class: String(r.therapeutic_class ?? ''),
        dispense_category: String(r.dispense_category ?? ''),
        route: String(r.route ?? ''),
        status: String(r.status ?? ''),
        legal_status: String(r.legal_status ?? ''),
      }
      const matchedCats = categoriesForDrug(categories, drugFacts, [String(r.group_id)], drugFacts.pyxis_id)
        .map(c => ({ id: c.id, name: c.name, color: c.color }))
      return {
        id: r.id,
        change_type: r.change_type,
        event_type: r.event_type ?? 'other_modified',
        domain: r.domain,
        group_id: r.group_id,
        description: r.description,
        charge_number: r.charge_number,
        pyxis_id: r.pyxis_id,
        generic_name: r.generic_name,
        strength: r.strength,
        strength_unit: r.strength_unit,
        dosage_form: r.dosage_form,
        field_diffs: JSON.parse((r.field_diffs_json as string) ?? '[]'),
        categories: matchedCats,
      }
    }),
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=60' },
  })
}
