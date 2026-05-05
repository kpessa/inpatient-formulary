/**
 * NDC → CDM Request payload resolver.
 *
 * One database fan-out from a normalized NDC into:
 *   • mltm_ndc / mltm_main_drug_code / mltm_drug_id / mltm_drug_name
 *   • mltm_ndc_source (manufacturer)
 *   • mltm_dose_form / mltm_product_strength
 *   • mltm_ndc_cost (AWP, A-cost) and inner_package_size for per-dose calc
 *   • mltm_rxb_order + most-common dose / route / frequency / PRN
 *   • formulary_groups (is this NDC already on formulary?)
 *
 * Pure async function — no side effects. Caller decides what to do with
 * `**MISSING**` cells (BrainSpace ticket, xlsx download, in-app preview).
 * The resolver never throws on missing data; it emits CdmFieldValue objects
 * with `missing: true` and sensible defaults so renderers stay simple.
 */

import { getDb } from '@/lib/db'
import { buildBillingDescription } from './billingDescription'
import type { CdmFieldValue, CdmRequestPayload, CdmFieldSource } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function field(value: string | number | null | undefined, source: CdmFieldSource, note?: string): CdmFieldValue {
  if (value == null || value === '') {
    return { value: null, source: null, missing: true, note }
  }
  return { value: String(value), source, missing: false, note }
}

function missing(note?: string): CdmFieldValue {
  return { value: null, source: null, missing: true, note }
}

/** Pick a route (e.g. "PO" / "IV") from RxBuilder + principal-route, prefer most-common. */
function fmtRoute(rxbDesc: string | null, principalCode: number | null): string | null {
  if (rxbDesc) {
    // RxBuilder description is verbose ("orally", "intravenously"). Map common
    // verbose forms to abbreviations Cerner CDM forms typically use.
    const m: Record<string, string> = {
      'orally': 'PO',
      'intravenously': 'IV',
      'intramuscularly': 'IM',
      'subcutaneously': 'SubQ',
      'topically': 'Topical',
      'rectally': 'PR',
      'inhaled': 'INH',
      'sublingually': 'SL',
      'ophthalmically': 'OPH',
      'otically': 'OTI',
      'intranasally': 'NAS',
    }
    return m[rxbDesc.toLowerCase()] ?? rxbDesc
  }
  // Principal route code is a Multum dictionary ID; without the dictionary
  // table we can't translate it. Return null and let the cell be MISSING.
  return null
}

/** Format a dose like "10 mg" or "650 mg (2 tab(s))" from RxBuilder dose-amount + qty.
 * Topical / applicator products often have dose_amount=0 and no dose_unit; in
 * that case the qty ("1 app") is the meaningful field. */
function fmtDose(
  doseAmount: number | null,
  doseUnit: string | null,
  qtyAmount: number | null,
  qtyUnit: string | null,
): string | null {
  const hasDose = doseAmount != null && doseAmount > 0 && !!doseUnit
  const hasQty = qtyAmount != null && qtyAmount > 0 && !!qtyUnit
  if (hasDose && hasQty && qtyUnit !== doseUnit) {
    return `${doseAmount} ${doseUnit} (${qtyAmount} ${qtyUnit})`
  }
  if (hasDose) return `${doseAmount} ${doseUnit}`
  if (hasQty) return `${qtyAmount} ${qtyUnit}`
  return null
}

/** Per-dose cost = total cost ÷ inner package size (vials/tabs/etc per package). */
function perDose(total: number | null, innerPkgSize: number | null): string | null {
  if (total == null || innerPkgSize == null || innerPkgSize === 0) return null
  const v = total / innerPkgSize
  // 4 sig figs feels right for a CDM form — pharmacist will round per facility policy.
  return v < 1 ? v.toFixed(4) : v.toFixed(2)
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export async function resolveCdmRequest(rawNdc: string): Promise<CdmRequestPayload> {
  const ndc = rawNdc.trim()
  const db = getDb()

  // ─── 1. Core identity (mltm_ndc + main_drug_code + drug_id + drug_name + source) ───
  const { rows: idRows } = await db.execute({
    sql: `
      SELECT
        n.ndc_formatted,
        n.main_multum_drug_code              AS mmdc,
        n.unit_dose_code                     AS unit_dose_code,
        n.inner_package_size                 AS inner_pkg,
        n.outer_package_size                 AS outer_pkg,
        n.gbo                                AS gbo,
        n.obsolete_date                      AS obsolete_date,
        mc.drug_identifier                   AS drug_identifier,
        mc.csa_schedule                      AS csa_schedule,
        ps.product_strength_description      AS strength_desc,
        df.dose_form_description             AS dose_form_desc,
        df.dose_form_abbr                    AS dose_form_abbr,
        src.source_desc                      AS manufacturer_name,
        (SELECT dn.drug_name FROM mltm_drug_name dn
         JOIN mltm_drug_id di2 ON di2.drug_synonym_id = dn.drug_synonym_id
         WHERE di2.drug_identifier = mc.drug_identifier
           AND dn.is_obsolete = 'F'
         ORDER BY dn.drug_name LIMIT 1)      AS generic_name,
        (SELECT dn.drug_name FROM mltm_drug_name dn
         JOIN mltm_drug_id di3 ON di3.drug_synonym_id = dn.drug_synonym_id
         WHERE di3.drug_identifier = mc.drug_identifier
           AND dn.is_obsolete = 'F'
           AND dn.drug_name <> (SELECT MIN(drug_name) FROM mltm_drug_name dn2
                                JOIN mltm_drug_id di4 ON di4.drug_synonym_id = dn2.drug_synonym_id
                                WHERE di4.drug_identifier = mc.drug_identifier
                                  AND dn2.is_obsolete = 'F')
         ORDER BY dn.drug_name LIMIT 1)      AS brand_name
      FROM mltm_ndc n
      LEFT JOIN mltm_main_drug_code mc ON mc.main_multum_drug_code = n.main_multum_drug_code
      LEFT JOIN mltm_dose_form        df ON df.dose_form_code        = mc.dose_form_code
      LEFT JOIN mltm_product_strength ps ON ps.product_strength_code = mc.product_strength_code
      LEFT JOIN mltm_ndc_source       src ON src.source_id            = n.source_id
      WHERE n.ndc_formatted = ?
    `,
    args: [ndc],
  })
  const id = idRows[0] ?? null
  const resolved = id != null
  const mmdc = (id?.mmdc as number | null) ?? null

  // ─── 2. RxBuilder most-common dose / route / frequency for this MMDC ───
  // Picks the *first* order encountered for the MMDC (multiple orders =
  // multiple presentations: e.g. adult/pediatric/IV/PO). v1 takes the
  // first; tie-break heuristics (prefer order_category matching principal
  // route) is a follow-up.
  const rxb = mmdc != null ? await fetchRxBuilderDefaults(db, mmdc) : null

  // ─── 3. Cost (AWP + acquisition cost from mltm_ndc_cost) ───
  const cost = resolved ? await fetchCost(db, ndc) : null

  // ─── 4. Already on formulary? (formulary_groups.identifiers_json contains the NDC) ───
  // Match on supply_records.ndc, which carries the NDC for every reference NDC
  // attached to a built CDM. If we get a hit, X5 → "Y".
  const onFormulary = await isOnFormulary(db, ndc)

  // ─── 5. Build the payload ───
  const innerPkg = (id?.inner_pkg as number | null) ?? null
  const isUnitDose = id?.unit_dose_code === 'U' || id?.unit_dose_code === 'Y'
  const csa = (id?.csa_schedule as string | null) ?? null
  const genericName = (id?.generic_name as string | null) ?? null
  const brandName = (id?.brand_name as string | null) ?? null
  const strengthDesc = (id?.strength_desc as string | null) ?? null
  const doseFormDesc = (id?.dose_form_desc as string | null) ?? null
  const doseFormAbbr = (id?.dose_form_abbr as string | null) ?? null
  const manufacturer = (id?.manufacturer_name as string | null) ?? null

  const drugNameHeading = [
    genericName,
    strengthDesc,
    doseFormDesc,
  ].filter(Boolean).join(' ').trim() || `### NDC ${ndc}`

  const billingDesc = buildBillingDescription({
    generic: genericName,
    strength: strengthDesc,
    formAbbr: doseFormAbbr,
  })

  return {
    formRevision: '04-27-2018',
    drugNameHeading,
    ndc,
    resolved,

    requesting: {
      hospital:        missing('Filled by submitter — facility setting.'),
      dopName:         missing('Filled by submitter — DOP requestor name.'),
      dopApprovalDate: field(new Date().toISOString().slice(0, 10), 'derived', "Today's date."),
      ptApprovalDate:  missing('Filled by submitter — P&T meeting date.'),
    },

    drug: {
      genericName: field(genericName, 'multum'),
      brandName:   field(brandName, 'multum'),
      outerNdc:    field(resolved ? ndc : null, 'multum'),
      innerNdc:    field(resolved ? ndc : null, 'multum',
        'Inner NDC = scanned NDC; only differs when product is repackaged.'),
      barcode:     field(resolved ? ndc.replace(/-/g, '') : null, 'derived',
        'Bare 11-digit form for barcode field.'),
      powerplan:   missing('Filled by submitter — N (new) or R (replacement).'),
      manufacturer: field(manufacturer, 'multum'),
    },

    dispensing: {
      defaultType:    missing('Filled by submitter (IVPB / Cont / IM / PO / etc.).'),
      dosageForm:     field(doseFormDesc, 'multum'),
      usualDose:      rxb?.dose
        ? field(rxb.dose, 'rxbuilder', 'Cerner RxBuilder MOST_COMMON_IND = 1.')
        : missing(),
      route:          rxb?.route
        ? field(rxb.route, 'rxbuilder', 'Cerner RxBuilder MOST_COMMON_IND = 1.')
        : missing(),
      usualFrequency: rxb?.frequency
        ? field(rxb.frequency, 'rxbuilder', 'Cerner RxBuilder MOST_COMMON_IND = 1.')
        : missing(),
      prnYN: rxb?.prnEligible != null
        ? field(rxb.prnEligible ? 'Y' : 'N', 'rxbuilder',
            rxb.prnEligible ? 'Has PRN options in RxBuilder.' : 'No PRN options in RxBuilder.')
        : missing(),
      prnIndication:  missing('Filled by submitter when PRN = Y.'),
      productNotes:   missing('Filled by submitter — pharmacy notes.'),
      formularyYN:    field(onFormulary ? 'Y' : 'N', 'extract',
        onFormulary ? 'NDC found in formulary_groups.' : 'NDC not found in formulary_groups.'),
    },

    indicators: {
      controlled: csa
        ? field(csa === '0' ? 'N' : `Y (CIV-${csa})`.replace('CIV-0', 'N'), 'multum',
            csa === '0' ? 'Not a controlled substance.' : `Schedule ${csa}.`)
        : missing(),
      actualCostPerDose: cost?.aCost != null
        ? field(perDose(cost.aCost, innerPkg) ?? cost.aCost.toFixed(4), 'cost',
            innerPkg ? `Per dose = $${cost.aCost} ÷ ${innerPkg} units.` : 'Per-package cost (inner pkg size unknown).')
        : missing('Cardinal acquisition cost not in Multum.'),
      awpPerDose: cost?.awp != null
        ? field(perDose(cost.awp, innerPkg) ?? cost.awp.toFixed(4), 'cost',
            innerPkg ? `Per dose = $${cost.awp} ÷ ${innerPkg} units.` : 'Per-package AWP (inner pkg size unknown).')
        : missing('AWP not in Multum.'),
      singleUse: id != null
        ? field(isUnitDose ? 'Y' : 'N', 'multum',
            `Multum unit_dose_code = ${id.unit_dose_code ?? '∅'}.`)
        : missing(),
    },

    billing: {
      billingDescription: billingDesc
        ? field(billingDesc, 'derived',
            'Auto-generated from generic + strength + form. ≤27 chars, uppercase.')
        : missing(),
    },
  }
}

// ---------------------------------------------------------------------------
// Helper queries
// ---------------------------------------------------------------------------

interface RxBuilderDefaults {
  dose: string | null
  route: string | null
  frequency: string | null
  prnEligible: boolean | null
}

async function fetchRxBuilderDefaults(
  db: ReturnType<typeof getDb>,
  mmdc: number,
): Promise<RxBuilderDefaults | null> {
  // Pick the first order — multiple orders per MMDC = multiple presentations
  // (adult/pediatric, IV/PO). Tie-break improvement is a follow-up.
  const { rows: orderRows } = await db.execute({
    sql: `SELECT drug_identifier, order_id_nbr
          FROM mltm_rxb_order
          WHERE main_multum_drug_code = ?
          ORDER BY order_id_nbr LIMIT 1`,
    args: [mmdc],
  })
  if (orderRows.length === 0) return null
  const drugId = orderRows[0].drug_identifier as string
  const orderNbr = orderRows[0].order_id_nbr as number

  // Most-common dose
  const { rows: doseRows } = await db.execute({
    sql: `SELECT d.dose_amount, du.abbreviation AS dose_unit,
                 d.dose_qty_amount, dq.abbreviation AS qty_unit
          FROM mltm_rxb_ord_dose_amount d
          LEFT JOIN mltm_rxb_dictionary du ON du.dictionary_id = d.dose_unit_dictionary_id
          LEFT JOIN mltm_rxb_dictionary dq ON dq.dictionary_id = d.dose_qty_unit_dictionary_id
          WHERE d.drug_identifier = ? AND d.order_id_nbr = ? AND d.most_common_ind = 1
          LIMIT 1`,
    args: [drugId, orderNbr],
  })
  const doseRow = doseRows[0] ?? null
  const dose = doseRow ? fmtDose(
    doseRow.dose_amount as number | null,
    doseRow.dose_unit as string | null,
    doseRow.dose_qty_amount as number | null,
    doseRow.qty_unit as string | null,
  ) : null

  // Most-common route
  const { rows: rteRows } = await db.execute({
    sql: `SELECT dr.description AS route_desc, dr.abbreviation AS route_abbr
          FROM mltm_rxb_ord_clinical_rte_map r
          JOIN mltm_rxb_dictionary dr ON dr.dictionary_id = r.clinical_route_dictionary_id
          WHERE r.drug_identifier = ? AND r.order_id_nbr = ? AND r.most_common_ind = 1
          LIMIT 1`,
    args: [drugId, orderNbr],
  })
  const rteRow = rteRows[0] ?? null
  const route = rteRow
    ? fmtRoute(rteRow.route_desc as string | null, null) ?? (rteRow.route_abbr as string | null)
    : null

  // Most-common frequency — prefer abbreviation ("Q8H") over verbose ("every 8 hours")
  // since CDM forms are tight-column.
  const { rows: freqRows } = await db.execute({
    sql: `SELECT df.abbreviation AS freq_abbr, df.description AS freq_desc
          FROM mltm_rxb_order_frequency_map f
          JOIN mltm_rxb_dictionary df ON df.dictionary_id = f.frequency_dictionary_id
          WHERE f.drug_identifier = ? AND f.order_id_nbr = ? AND f.most_common_ind = 1
          LIMIT 1`,
    args: [drugId, orderNbr],
  })
  const freqRow = freqRows[0] ?? null
  const frequency = freqRow
    ? (freqRow.freq_abbr as string | null) ?? (freqRow.freq_desc as string | null)
    : null

  // PRN eligibility — presence of any prn_map row signals PRN-orderable.
  const { rows: prnRows } = await db.execute({
    sql: `SELECT 1 FROM mltm_rxb_order_prn_map
          WHERE drug_identifier = ? AND order_id_nbr = ? LIMIT 1`,
    args: [drugId, orderNbr],
  })
  const prnEligible = prnRows.length > 0

  return { dose, route, frequency, prnEligible }
}

interface CostLookup {
  awp: number | null
  aCost: number | null
}

async function fetchCost(db: ReturnType<typeof getDb>, ndcFormatted: string): Promise<CostLookup> {
  // mltm_ndc_cost is keyed on `ndc_code` (no hyphens), not ndc_formatted.
  const ndcCode = ndcFormatted.replace(/-/g, '')
  const { rows } = await db.execute({
    sql: `SELECT inventory_type, cost FROM mltm_ndc_cost WHERE ndc_code = ?`,
    args: [ndcCode],
  })
  let awp: number | null = null
  let aCost: number | null = null
  for (const r of rows) {
    const t = r.inventory_type as string
    const c = r.cost as number | null
    if (t === 'A') awp = c           // 'A' = AWP
    else if (t === 'W') aCost = c    // 'W' = WAC / acquisition cost (proxy for Cardinal)
  }
  return { awp, aCost }
}

async function isOnFormulary(db: ReturnType<typeof getDb>, ndcFormatted: string): Promise<boolean> {
  // supply_records carries the NDC for every reference + non-reference NDC
  // attached to a built CDM, across all domains.
  const { rows } = await db.execute({
    sql: `SELECT 1 FROM supply_records WHERE ndc = ? LIMIT 1`,
    args: [ndcFormatted],
  })
  return rows.length > 0
}
