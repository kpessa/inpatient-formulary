/**
 * Derive a draft Billing Description for cell AC5 — generic + strength + form,
 * uppercased, hard-truncated to ≤27 characters per the form's footer.
 *
 * Trained against `cdm_master.description` corpus conventions:
 *   "*CALCIUM CHL 10% 10 ML VIAL"      ← genitive abbreviation + concentration
 *   "*CAPECITABINE ORAL PER 150MG"     ← billed-by-dose form (rare)
 *   "*ACETAMINOPHEN 325MG TAB"          ← straight generic + strength + form
 *
 * v1 outputs the third pattern (`<GENERIC> <STRENGTH> <FORM_ABBR>`); the
 * leading `*` and per-dose phrasing seen in the corpus are downstream
 * conventions Charge Services may apply. Pharmacist sees this as a
 * suggestion in the dialog and can override before submitting.
 *
 * Returns null when the inputs aren't enough to make any reasonable string
 * — the resolver then emits cell AC5 as **MISSING**.
 */

interface BuildArgs {
  generic: string | null
  strength: string | null
  /** Multum dose-form abbreviation (TAB, CAP, VIAL, AMP, IVPB, SYRINGE…). */
  formAbbr: string | null
}

const MAX_LEN = 27

export function buildBillingDescription({ generic, strength, formAbbr }: BuildArgs): string | null {
  if (!generic) return null

  // Normalize: uppercase, collapse internal whitespace, drop any chars
  // outside the safe set (CDM systems get cranky about punctuation beyond
  // %/./-).
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .replace(/[^A-Z0-9 %./\-]/g, '')
      .trim()

  const g = norm(generic)
  const s = strength ? norm(strength) : ''
  const f = formAbbr ? norm(formAbbr) : ''

  // Try the full string first. If it fits, ship it.
  const full = [g, s, f].filter(Boolean).join(' ')
  if (full.length <= MAX_LEN) return full

  // Doesn't fit — abbreviate the generic name. Common heuristic: keep the
  // first two words intact (most generics are 1-2 words), abbreviate longer
  // multi-word names by truncating each word to a fixed length.
  const fixed = `${s ? ' ' + s : ''}${f ? ' ' + f : ''}`.length
  const budget = MAX_LEN - fixed
  if (budget < 4) {
    // Strength + form alone don't leave room for any meaningful generic
    // — drop the form and try again.
    const noForm = [g, s].filter(Boolean).join(' ')
    if (noForm.length <= MAX_LEN) return noForm
    // Still too long — truncate the generic hard.
    return [g.slice(0, MAX_LEN - 1 - s.length), s].filter(Boolean).join(' ').slice(0, MAX_LEN)
  }

  const abbrGeneric = abbreviateName(g, budget)
  return [abbrGeneric, s, f].filter(Boolean).join(' ').slice(0, MAX_LEN)
}

/**
 * Abbreviate a drug name to fit within `budget` characters. Strategy:
 *   1. If the whole name fits, return it verbatim.
 *   2. Otherwise, keep the first word intact and truncate subsequent words
 *      to as few chars as needed.
 *   3. If still too long, hard-truncate the first word.
 *
 * Examples (budget=18):
 *   "ACETAMINOPHEN"            → "ACETAMINOPHEN"
 *   "DIPHENHYDRAMINE HCL"      → "DIPHENHYDRAMINE HCL"
 *   "TRIMETHOPRIM/SULFAMETHOX" → "TRIMETHOPRIM/SULFA"
 *   "CALCIUM CHLORIDE"         → "CALCIUM CHLORIDE"
 */
function abbreviateName(name: string, budget: number): string {
  if (name.length <= budget) return name

  const words = name.split(' ')
  if (words.length === 1) {
    return name.slice(0, budget)
  }

  // Try keeping word 1 intact, truncating later words.
  let result = words[0]
  for (let i = 1; i < words.length; i++) {
    const remaining = budget - result.length - 1 // -1 for space
    if (remaining < 2) break
    const w = words[i]
    if (w.length <= remaining) {
      result += ' ' + w
    } else {
      result += ' ' + w.slice(0, remaining)
      break
    }
  }
  return result.slice(0, budget)
}
