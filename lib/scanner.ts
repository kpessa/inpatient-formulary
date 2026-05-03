/**
 * Scanner orchestration — threads parseBarcode → lookupNdcForFacility →
 * diagnose so the API routes are one-liners.
 *
 * Kept separate from `lib/diagnosis.ts` so the classifier stays pure and
 * importable in non-Node test environments (no DB binding required to
 * exercise the decision tree).
 */

import { parseBarcode, type ParsedBarcode } from './barcode'
import { lookupNdcForFacility, type Environment, type FacilityNdcLookup } from './db'
import {
  diagnose,
  DIAGNOSIS_STATE_RANK,
  type Diagnosis,
  type DiagnosisState,
} from './diagnosis'

export interface ScanResult {
  /** Original input the caller passed (barcode, NDC, whatever). */
  input: string
  /** Output of `parseBarcode(input)` so the UI can show "Detected: GTIN-12". */
  parsed: ParsedBarcode
  /** The NDC candidate the diagnosis was computed against. Empty if no candidates parsed. */
  ndc: string
  /** Full lookup for the chosen candidate. `null` when no candidates parsed. */
  lookup: FacilityNdcLookup | null
  /** Diagnosis for the chosen candidate. `null` when no candidates parsed (caller should render "couldn't parse barcode"). */
  diagnosis: Diagnosis | null
  /**
   * When `parsed.candidates` had more than one entry (zero-pad ambiguity), the
   * other candidates' diagnoses for transparency. The chosen one is excluded.
   */
  alternateCandidates: Array<{ ndc: string; state: DiagnosisState; label: string }>
}

/**
 * End-to-end scanner: parse input → look up each candidate NDC → diagnose →
 * pick the most-resolved candidate. The chosen candidate goes into `ndc`,
 * `lookup`, and `diagnosis`; the others are summarized in `alternateCandidates`.
 *
 * Lookups for all candidates run in parallel — typically ≤3 candidates, each
 * indexed, so total wall-clock is one-query latency on the embedded replica.
 *
 * `facilities` is a multi-select: empty array → "all facilities" / no scope;
 * one element → single-facility scope (legacy behavior); 2+ → flex matches
 * any-of-selected, scope is the union of their domains. See
 * `lookupNdcForFacility` for the full semantics.
 */
export async function scanInput(
  input: string,
  facilities: string[],
  opts: { environment?: Environment } = {},
): Promise<ScanResult> {
  const parsed = parseBarcode(input)
  if (parsed.candidates.length === 0) {
    return { input, parsed, ndc: '', lookup: null, diagnosis: null, alternateCandidates: [] }
  }

  const evaluated = await Promise.all(
    parsed.candidates.map(async (cand) => {
      const lookup = await lookupNdcForFacility(cand, facilities, opts)
      const diagnosis = diagnose(lookup)
      return { ndc: cand, lookup, diagnosis }
    }),
  )

  evaluated.sort(
    (a, b) => DIAGNOSIS_STATE_RANK[a.diagnosis.state] - DIAGNOSIS_STATE_RANK[b.diagnosis.state],
  )
  const [chosen, ...rest] = evaluated
  return {
    input,
    parsed,
    ndc: chosen.ndc,
    lookup: chosen.lookup,
    diagnosis: chosen.diagnosis,
    alternateCandidates: rest.map((r) => ({
      ndc: r.ndc,
      state: r.diagnosis.state,
      label: r.diagnosis.label,
    })),
  }
}
