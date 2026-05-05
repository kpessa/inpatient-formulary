/**
 * Frozen field → cell-address map for the UHS CDM Request Form (rev. 04-27-2018,
 * "UHS CDM_Request_Form_2024.xlsx"). Data row is row 5; row 1-4 are the
 * stacked color-band / sub-label headers. Pharmacy-fillable cells only —
 * Charge Services fills AD5..AR5 after submission, so they are not mapped here.
 *
 * Verified against `data/UHS CDM_Request_Form_2024.xlsx` shared-strings
 * dump: no <mergeCells> block in the actual XML (visual band effect comes
 * from borders + fills only), so each cell is its own write target.
 *
 * Used by lib/cdm/xlsx.ts to write the autofilled workbook.
 */

import type { CdmRequestPayload } from './types'

/**
 * Maps a dotted-path field key on CdmRequestPayload to the spreadsheet cell
 * that should receive its value. Order here is the on-form left-to-right
 * reading order so reviewers can scan the file alongside the spreadsheet.
 */
export const CDM_CELL_MAP: ReadonlyArray<{
  cell: string
  /** Dotted path into CdmRequestPayload (e.g. "drug.outerNdc"). */
  path: CdmFieldPath
  /** Optional one-line description of the form's printed header. */
  header: string
}> = [
  // Requesting band
  { cell: 'A5',  path: 'requesting.hospital',          header: 'Requesting / HOSP' },
  { cell: 'B5',  path: 'requesting.dopName',           header: 'DOP / Name' },
  { cell: 'C5',  path: 'requesting.dopApprovalDate',   header: 'DOP / Approval Date' },
  { cell: 'D5',  path: 'requesting.ptApprovalDate',    header: 'P&T approval / date' },

  // Drug band
  { cell: 'E5',  path: 'drug.genericName',  header: 'Drug / Name (Generic)' },
  { cell: 'F5',  path: 'drug.brandName',    header: 'Drug / Name (Brand)' },
  { cell: 'G5',  path: 'drug.outerNdc',     header: 'Outer NDC / Number' },
  { cell: 'H5',  path: 'drug.innerNdc',     header: 'Inner NDC / Number' },
  { cell: 'I5',  path: 'drug.barcode',      header: 'Barcode / scan' },
  { cell: 'J5',  path: 'drug.powerplan',    header: 'Powerplan (N)ew or (R)eplacement' },
  { cell: 'K5',  path: 'drug.manufacturer', header: 'Manufacturer' },

  // Dispensing Information band
  { cell: 'L5',  path: 'dispensing.defaultType',    header: 'Default type (IVPB/Cont/IM/PO)' },
  // M5..P5 — unlabeled on the form; nothing written.
  { cell: 'Q5',  path: 'dispensing.dosageForm',     header: 'Dosage / Form' },
  { cell: 'R5',  path: 'dispensing.usualDose',      header: 'Usual / dose' },
  { cell: 'S5',  path: 'dispensing.route',          header: 'Route' },
  { cell: 'T5',  path: 'dispensing.usualFrequency', header: 'usual / frequency' },
  { cell: 'U5',  path: 'dispensing.prnYN',          header: 'PRN / Y or N' },
  { cell: 'V5',  path: 'dispensing.prnIndication',  header: 'PRN / Indication' },
  { cell: 'W5',  path: 'dispensing.productNotes',   header: 'Product / Notes' },
  { cell: 'X5',  path: 'dispensing.formularyYN',    header: 'Formulary / Y or N' },

  // Indicators band
  { cell: 'Y5',  path: 'indicators.controlled',        header: 'Controlled Drug / Y or N' },
  { cell: 'Z5',  path: 'indicators.actualCostPerDose', header: 'Actual Cost per Dose (Cardinal)' },
  { cell: 'AA5', path: 'indicators.awpPerDose',        header: 'AWP / List per Dose' },
  { cell: 'AB5', path: 'indicators.singleUse',         header: 'Single use product? / Y or N' },

  // Billing Description (last pharmacy-fillable cell)
  { cell: 'AC5', path: 'billing.billingDescription',   header: 'Billing Description (≤27 chars)' },
] as const

/**
 * String-literal union of every dotted path that maps to a cell. Updating
 * this list keeps the cell map and the payload shape in lockstep at compile
 * time — adding a new field requires updating both or TypeScript yells.
 */
export type CdmFieldPath =
  | 'requesting.hospital'
  | 'requesting.dopName'
  | 'requesting.dopApprovalDate'
  | 'requesting.ptApprovalDate'
  | 'drug.genericName'
  | 'drug.brandName'
  | 'drug.outerNdc'
  | 'drug.innerNdc'
  | 'drug.barcode'
  | 'drug.powerplan'
  | 'drug.manufacturer'
  | 'dispensing.defaultType'
  | 'dispensing.dosageForm'
  | 'dispensing.usualDose'
  | 'dispensing.route'
  | 'dispensing.usualFrequency'
  | 'dispensing.prnYN'
  | 'dispensing.prnIndication'
  | 'dispensing.productNotes'
  | 'dispensing.formularyYN'
  | 'indicators.controlled'
  | 'indicators.actualCostPerDose'
  | 'indicators.awpPerDose'
  | 'indicators.singleUse'
  | 'billing.billingDescription'

/** Type-safe getter — walks a dotted path on a payload to retrieve a CdmFieldValue. */
export function getField(
  payload: CdmRequestPayload,
  path: CdmFieldPath,
): CdmRequestPayload['drug']['genericName'] {
  const [band, key] = path.split('.') as [keyof CdmRequestPayload, string]
  const group = payload[band] as Record<string, CdmRequestPayload['drug']['genericName']>
  return group[key]
}
