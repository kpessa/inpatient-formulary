/**
 * Legacy formulary fields (Cerner / Discern / older VB-script imports) carry
 * verbatim escape tokens like `{VBCRLF}` instead of real whitespace. Decode
 * at render time — never mutate the stored value, so any export to a peer
 * system preserves the original encoding it expects.
 *
 * Tokens recognized (case-insensitive):
 *   {VBCRLF} {CRLF} {CR} {LF}  → "\n"
 *   {TAB}                       → "\t"
 */
export function decodeVbTokens(s: string | null | undefined): string {
  if (!s) return s ?? ""
  return s
    .replace(/\{(?:VBCRLF|CRLF|CR|LF)\}/gi, "\n")
    .replace(/\{TAB\}/gi, "\t")
}
