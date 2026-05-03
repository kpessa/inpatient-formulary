/**
 * Barcode → NDC normalization.
 *
 * Ported from `tools/drug_lookup.py` in the llm-vault, which itself was ported
 * from `~/code/parsing-rules/app.js` (the orphan repo this scanner project absorbs).
 * Keep this module pure (no I/O, no DB, no fetch) so it stays trivially testable
 * and can run on the edge or in the browser if needed.
 *
 * Length-to-slice rules (mirror the parsing-rules webapp):
 *   - 10 digits           → keep as-is (raw 10-digit body)
 *   - 11 digits           → already a packed NDC (5-4-2 minus hyphens)
 *   - 12 digits           → strip 1 leading + 1 trailing (GTIN-12 / UPC-A)
 *   - 13 digits           → strip 2 leading + 1 trailing (GTIN-13 / EAN-13)
 *   - 14/15 digits        → strip 3 leading + 1/2 trailing (GTIN-14, GS1 short forms)
 *   - 16/32/35/37 digits  → strip 5 leading (GS1 DataMatrix application identifiers)
 *
 * Once we have a 10-digit body, pad zeros three ways to produce candidate
 * 11-digit packed NDCs. The 10-digit form is ambiguous because the original
 * NDC might use 4-4-2, 5-3-2, or 5-4-1 zero placement — we emit all three so
 * downstream lookups can try each.
 */

export type BarcodeFormat =
  | 'NDC-11' // 11-digit packed NDC, treated as already normalized
  | 'NDC-10' // 10-digit raw NDC (zero-pad ambiguous)
  | 'GTIN-12' // UPC-A
  | 'GTIN-13' // EAN-13
  | 'GTIN-14' // GTIN-14 / SSCC-14
  | 'GS1-15' // 15-digit GS1 short
  | 'GS1-DataMatrix' // 16/32/35/37 — GS1 DataMatrix with application identifiers
  | 'unknown'

export interface ParsedBarcode {
  /** Original input with non-digits stripped. */
  digits: string
  /** Detected format, best-effort by length. `unknown` means we couldn't slice a 10-digit body. */
  format: BarcodeFormat
  /** Candidate packed 11-digit NDCs in 5-4-2 hyphenated form. Empty if format is `unknown`. */
  candidates: readonly string[]
}

/** Format a packed 11-digit NDC string as 5-4-2 (e.g. `"56151162501"` → `"56151-1625-01"`). */
export function readNdc(packed: string): string {
  return `${packed.slice(0, 5)}-${packed.slice(5, 9)}-${packed.slice(9, 11)}`
}

/** Strip hyphens (or any non-digit) from a formatted NDC to get the 11-digit packed form. */
export function packedNdc(formatted: string): string {
  return formatted.replace(/[^0-9]/g, '')
}

/**
 * Given a 10-digit string, return the 3 zero-pad candidate NDCs in 5-4-2 form.
 * Mirrors the parsing-rules `padZeros` exactly:
 *   - Pad before the labeler segment (4-4-2 → 5-4-2)
 *   - Pad before the product segment (5-3-2 → 5-4-2)
 *   - Pad before the package segment (5-4-1 → 5-4-2)
 */
function padZeros(ten: string): string[] {
  const a = '0' + ten
  const b = ten.slice(0, 5) + '0' + ten.slice(5, 10)
  const c = ten.slice(0, 9) + '0' + ten.slice(9, 10)
  return [readNdc(a), readNdc(b), readNdc(c)]
}

/** Detect the barcode format from its digit length. */
function detectFormat(n: number): BarcodeFormat {
  if (n === 11) return 'NDC-11'
  if (n === 10) return 'NDC-10'
  if (n === 12) return 'GTIN-12'
  if (n === 13) return 'GTIN-13'
  if (n === 14) return 'GTIN-14'
  if (n === 15) return 'GS1-15'
  if (n === 16 || n === 32 || n === 35 || n === 37) return 'GS1-DataMatrix'
  return 'unknown'
}

/**
 * Turn a barcode or NDC of any common length into candidate 5-4-2 NDCs.
 *
 * Returns an empty array for inputs we can't interpret (empty, or a length
 * that doesn't match any known format). For 11-digit input, returns a single
 * candidate. For everything else, returns three zero-pad candidates.
 */
export function normalizeToCandidateNdcs(raw: string): string[] {
  const s = raw.replace(/[^0-9]/g, '')
  const n = s.length
  if (n === 0) return []
  if (n === 11) return [readNdc(s)]

  // Slice down to a 10-digit body based on length.
  let body: string
  if (n === 10) {
    body = s
  } else if (n === 12) {
    body = s.slice(1, 11)
  } else if (n === 13) {
    body = s.slice(2, 12)
  } else if (n === 14 || n === 15) {
    body = s.slice(3, 13)
  } else if (n === 16 || n === 32 || n === 35 || n === 37) {
    body = s.slice(5, 15)
  } else {
    return []
  }

  if (body.length !== 10) return []
  return padZeros(body)
}

/**
 * High-level helper: parse a raw barcode/NDC input and return both the
 * detected format and the candidate NDCs. Intended for UI feedback (the
 * Lookup tab can render "Detected: GTIN-12" alongside the candidates).
 */
export function parseBarcode(raw: string): ParsedBarcode {
  const digits = raw.replace(/[^0-9]/g, '')
  const format = detectFormat(digits.length)
  const candidates = normalizeToCandidateNdcs(raw)
  return { digits, format, candidates }
}
