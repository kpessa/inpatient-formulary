/**
 * CDM Request payload → autofilled .xlsx file.
 *
 * Reads `data/cdm_request_template.xlsx` (the canonical UHS CDM Request Form
 * rev. 04-27-2018 / "2024" working copy) and writes the resolved values
 * into row 5 cells A5..AC5 — leaving the template's existing styling
 * (borders, header bands, fonts, column widths) intact because we only
 * overwrite cell *values*, never delete and recreate cells.
 *
 * Returns a Buffer the API route can stream as an attachment.
 *
 * MISSING fields are written as empty strings so the form displays the
 * blank cell the user would otherwise have to clear manually. The Charge
 * Services band (AD5..AR5) is intentionally untouched — those cells are
 * filled by Charge Services after submission.
 */

import path from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { CDM_CELL_MAP, type CdmFieldPath, getField } from './cellMap'
import type { CdmRequestPayload } from './types'

// Living in public/ rather than data/ guarantees the file ships with every
// Vercel deploy without depending on outputFileTracingIncludes — Next.js
// includes public/ wholesale in the function bundle. Local dev reads from
// the same path, so behavior is consistent across environments.
const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'cdm_request_template.xlsx')

export function payloadToXlsx(payload: CdmRequestPayload): Buffer {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `CDM template not found at ${TEMPLATE_PATH} — copy from ` +
      `"~/Downloads/UHS CDM_Request_Form_2024.xlsx" if missing.`
    )
  }

  // Read via our own fs and parse as buffer — XLSX.readFile internally
  // checks `typeof fs !== 'undefined'`, but Turbopack's server-component
  // bundle strips that, making readFile throw "Cannot access file …".
  // XLSX.read(buf) bypasses the check entirely.
  const templateBuf = fs.readFileSync(TEMPLATE_PATH)
  const wb = XLSX.read(templateBuf, { cellStyles: true, type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`No sheet found in ${TEMPLATE_PATH}`)

  // Write each mapped value into its cell. We mutate ws[cellRef].v in place
  // so any pre-existing style metadata (s) and number-format (z) survive.
  for (const entry of CDM_CELL_MAP) {
    const v = getField(payload, entry.path as CdmFieldPath)
    const value = v.missing ? '' : (v.value ?? '')
    const cell = ws[entry.cell] as XLSX.CellObject | undefined
    if (cell) {
      cell.v = value
      cell.t = 's'                  // string type
      delete cell.w                 // formatted text — let Excel re-format
      delete (cell as { f?: string }).f   // any inherited formula
    } else {
      // Cell didn't exist in the template (rare; row 5 cells are likely
      // pre-rendered with bordered styling). Create a bare cell — loses the
      // template's styling for this address but the data still lands.
      ws[entry.cell] = { v: value, t: 's' }
      // Extend the sheet range to include this cell.
      const ref = ws['!ref'] ?? 'A1'
      const range = XLSX.utils.decode_range(ref)
      const addr = XLSX.utils.decode_cell(entry.cell)
      if (addr.r > range.e.r) range.e.r = addr.r
      if (addr.c > range.e.c) range.e.c = addr.c
      ws['!ref'] = XLSX.utils.encode_range(range)
    }
  }

  // Write to buffer. xlsx → binary, no compression (template is tiny so
  // this is fine; downloads complete in milliseconds either way).
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return buf as Buffer
}

/** Build a download-friendly filename like "CDM_Request_bacitracin_topical_2026-05-05.xlsx".
 *  Sanitizes the generic name so it's filesystem-safe across OSes. */
export function suggestedFilename(payload: CdmRequestPayload): string {
  const generic = payload.drug.genericName.value
  const safe = (generic ?? `NDC_${payload.ndc}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  const date = new Date().toISOString().slice(0, 10)
  return `CDM_Request_${safe}_${date}.xlsx`
}
