/**
 * CDM Request payload → tab-separated cell block.
 *
 * Output is one TSV row covering cells A5 through AC5 in their on-form
 * order, with empty placeholders for the unused M5..P5 columns. The user
 * pastes this into the template's A5 cell with `Cmd+V` and Excel fills all
 * 29 cells in one shot — saves the per-cell copy/paste loop.
 *
 * MISSING fields render as empty cells (not the literal "MISSING" string),
 * so the user sees the same blank-cell shape they'd see when manually
 * filling the form. This is intentional — pasting "MISSING" into a CDM
 * Request form is worse than leaving it blank.
 */

import { CDM_CELL_MAP, getField, type CdmFieldPath } from './cellMap'
import type { CdmRequestPayload } from './types'

/** Spreadsheet columns, A through AC (29 columns), in paste order. */
const COLUMN_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
  'M', 'N', 'O', 'P',
  'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  'AA', 'AB', 'AC',
] as const

export function payloadToTsv(payload: CdmRequestPayload): string {
  // Index the cell map by spreadsheet column letter for O(1) lookup.
  const byColumn = new Map<string, CdmFieldPath>()
  for (const entry of CDM_CELL_MAP) {
    const col = entry.cell.replace(/\d+$/, '')   // strip trailing row number
    byColumn.set(col, entry.path as CdmFieldPath)
  }

  const cells: string[] = []
  for (const col of COLUMN_LETTERS) {
    const path = byColumn.get(col)
    if (!path) {
      cells.push('')   // M5..P5 are unmapped on the form; leave blank
      continue
    }
    const v = getField(payload, path)
    if (v.missing || v.value == null) {
      cells.push('')
    } else {
      cells.push(escapeCell(v.value))
    }
  }
  return cells.join('\t')
}

/** Escape characters that would break TSV cell boundaries when pasted into
 *  Excel: tab → space (would split into a new cell), newline → space (would
 *  start a new row). Quotes are fine in TSV — Excel doesn't quote on paste. */
function escapeCell(s: string): string {
  return s.replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ').trim()
}
