/**
 * CDM Request payload types — the single canonical shape produced by the
 * resolver and consumed by every renderer (UI grid, markdown serializer,
 * xlsx writer, BrainSpace ticket inlining).
 *
 * The form has two halves:
 *   • Pharmacy fills A5..AC5 (Requesting / Drug / Dispensing / Indicators
 *     / Billing Description) — these are the cells the resolver populates.
 *   • Charge Services fills AD5..AR5 (CDM Code, charge description, tech
 *     description, proc/rev/GL/INS, etc.) AFTER receiving the request.
 *     These are intentionally NOT in the payload — the resolver does not
 *     emit values for cells the pharmacy doesn't own.
 *
 * Form revision 04-27-2018 (filename "UHS CDM_Request_Form_2024.xlsx"
 * carries the same internal revision string).
 */

/**
 * One field of the CDM Request form. `value` is the resolver's best guess;
 * `null` + `missing: true` means we couldn't resolve it and the renderer
 * should display "**MISSING**" so BrainSpace's `isMissing` regex matches.
 *
 * `source` records where the value came from so the UI can render a
 * provenance badge — useful when a pharmacist wants to audit autofill
 * decisions before submitting.
 */
export interface CdmFieldValue {
  value: string | null
  /** Where this value came from. `null` when the field is missing. */
  source: CdmFieldSource | null
  /** True when the field couldn't be resolved — render as "**MISSING**". */
  missing: boolean
  /** Optional confidence note shown as a hover tooltip. */
  note?: string
}

export type CdmFieldSource =
  | 'multum'           // Direct Multum table lookup (mltm_drug_name, mltm_main_drug_code, etc.)
  | 'rxbuilder'        // Cerner RxBuilder most_common_ind = 1 row (mltm_rxb_*)
  | 'extract'          // formulary_groups (the C152E extract — already on formulary)
  | 'cost'             // mltm_ndc_cost / multum_ndcs (AWP, A-cost)
  | 'derived'          // Computed from other fields (e.g. billing description)
  | 'user'             // Filled by user / preferences (DOP name, hospital)

/**
 * Full CDM Request form payload, pharmacy-fillable cells only (A5..AC5).
 * Grouped by the form's visible color bands to make the UI grid trivial.
 */
export interface CdmRequestPayload {
  /** Form revision string baked into the xlsx — useful for the markdown footer. */
  formRevision: '04-27-2018'

  /** "### Drug Name" line BrainSpace's CDMFormDataParser uses as the preface. */
  drugNameHeading: string

  /** The NDC the resolver was called with (normalized 5-4-2 hyphenated). */
  ndc: string

  /** Whether the resolver successfully found this NDC in Multum at all. */
  resolved: boolean

  /** Requesting band (cells A5..D5). */
  requesting: {
    hospital: CdmFieldValue        // A5
    dopName: CdmFieldValue         // B5 — DOP requestor name
    dopApprovalDate: CdmFieldValue // C5
    ptApprovalDate: CdmFieldValue  // D5
  }

  /** Drug band (cells E5..K5). */
  drug: {
    genericName: CdmFieldValue   // E5
    brandName: CdmFieldValue     // F5
    outerNdc: CdmFieldValue      // G5
    innerNdc: CdmFieldValue      // H5
    barcode: CdmFieldValue       // I5
    powerplan: CdmFieldValue     // J5 — 'N' or 'R'
    manufacturer: CdmFieldValue  // K5
  }

  /** Dispensing Information band (cells L5, Q5..X5; M5..P5 are blank on the form). */
  dispensing: {
    defaultType: CdmFieldValue     // L5 — IVPB / Cont / IM / PO / etc.
    dosageForm: CdmFieldValue      // Q5
    usualDose: CdmFieldValue       // R5 — RxBuilder most-common
    route: CdmFieldValue           // S5 — RxBuilder most-common
    usualFrequency: CdmFieldValue  // T5 — RxBuilder most-common
    prnYN: CdmFieldValue           // U5
    prnIndication: CdmFieldValue   // V5
    productNotes: CdmFieldValue    // W5
    formularyYN: CdmFieldValue     // X5 — derived: is this NDC on formulary?
  }

  /** Indicators band (cells Y5..AB5). */
  indicators: {
    controlled: CdmFieldValue        // Y5 — Y/N + schedule
    actualCostPerDose: CdmFieldValue // Z5
    awpPerDose: CdmFieldValue        // AA5
    singleUse: CdmFieldValue         // AB5
  }

  /** Billing Description (cell AC5) — last pharmacy-fillable field, ≤27 chars. */
  billing: {
    billingDescription: CdmFieldValue // AC5
  }
}
