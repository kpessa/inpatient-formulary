/**
 * CDM Request payload → markdown for BrainSpace ticket inlining.
 *
 * Output exactly matches BrainSpace's `CDMFormDataParser` contract
 * (see `BrainSpace Mac/TicketAttachments.swift` lines 181-218):
 *
 *   ### <Drug Name>           ← preface (optional)
 *
 *   | Field | Value |          ← header row
 *   |-------|-------|          ← separator
 *   | <field> | <value> |      ← one row per CDM field
 *   ...
 *
 *   *<footnote>*               ← form revision + corporate-only note
 *
 * Missing values render as `**MISSING**` so BrainSpace's `isMissing` regex
 * (`\*\*\s*MISSING`) flags them with a warning tint in the ticket viewer.
 *
 * Field order = on-form left-to-right reading order (matches lib/cdm/cellMap.ts).
 */

import { CDM_CELL_MAP, getField, type CdmFieldPath } from './cellMap'
import type { CdmRequestPayload } from './types'

/**
 * Group definition for the markdown output. The form has 5 visible bands
 * (Requesting / Drug / Dispensing / Indicators / Billing); we render them
 * each as a separate table so the resulting markdown has a clean table per
 * section in the BrainSpace ticket.
 *
 * Actually — BrainSpace's parser collapses everything into a single
 * `[CDMFormRow]` block per `## CDM Form Data` section, so multi-table
 * output would look weird in the Mac renderer. We emit one big table to
 * match what the parser expects, but use blank "section header" rows
 * (`| Section | --- |`) to break it visually for human readers. The Mac
 * renderer just shows every row in a Grid; the section rows render as
 * regular rows but with a recognizable shape.
 *
 * Simplest approach for v1: one flat table, in form-reading order. Section
 * grouping is a nice-to-have we can add later if pharmacists want it.
 */

interface MarkdownOptions {
  /** Whether to include a `### <Drug Name>` preface line. Default true. */
  includeDrugHeading?: boolean
  /** Whether to include the trailing footnote (form rev). Default true. */
  includeFootnote?: boolean
  /** Wrap output in `## CDM Form Data` section header. Default false (caller
   * usually adds this when pasting into a ticket). */
  wrapSection?: boolean
}

export function payloadToMarkdown(
  payload: CdmRequestPayload,
  options: MarkdownOptions = {},
): string {
  const {
    includeDrugHeading = true,
    includeFootnote = true,
    wrapSection = false,
  } = options

  const lines: string[] = []

  if (wrapSection) lines.push('## CDM Form Data', '')
  if (includeDrugHeading) {
    lines.push(`### ${payload.drugNameHeading}`, '')
  }

  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  for (const entry of CDM_CELL_MAP) {
    const v = getField(payload, entry.path as CdmFieldPath)
    const headerLabel = headerForRow(entry.path as CdmFieldPath, entry.header)
    const cellValue = v.missing
      ? '**MISSING**'
      : escapePipe(v.value ?? '')
    lines.push(`| ${headerLabel} | ${cellValue} |`)
  }

  if (includeFootnote) {
    lines.push('')
    lines.push(
      `*Form revision ${payload.formRevision}. ` +
      `Corporate UHS USE ONLY fields (CDM code, charge description, proc / rev / GL / INS codes, etc.) ` +
      `are filled by Charge Services after submission and are intentionally omitted here.*`,
    )
  }

  return lines.join('\n')
}

/**
 * Pick a clean human-readable label for the markdown table's left column.
 * The cell-map's `header` field includes redundant "row3 / row4" framing
 * useful for spreadsheet alignment; for the markdown ticket we want the
 * shorter, more human-readable phrase.
 */
function headerForRow(path: CdmFieldPath, _fallback: string): string {
  const labels: Record<CdmFieldPath, string> = {
    'requesting.hospital':           'Hospital',
    'requesting.dopName':            'DOP Name',
    'requesting.dopApprovalDate':    'DOP Approval Date',
    'requesting.ptApprovalDate':     'P&T Approval Date',
    'drug.genericName':              'Generic Name',
    'drug.brandName':                'Brand Name',
    'drug.outerNdc':                 'Outer NDC',
    'drug.innerNdc':                 'Inner NDC',
    'drug.barcode':                  'Barcode',
    'drug.powerplan':                'Powerplan (N/R)',
    'drug.manufacturer':             'Manufacturer',
    'dispensing.defaultType':        'Default Type',
    'dispensing.dosageForm':         'Dosage Form',
    'dispensing.usualDose':          'Usual Dose',
    'dispensing.route':              'Route',
    'dispensing.usualFrequency':     'Usual Frequency',
    'dispensing.prnYN':              'PRN (Y/N)',
    'dispensing.prnIndication':      'PRN Indication',
    'dispensing.productNotes':       'Product Notes',
    'dispensing.formularyYN':        'Formulary (Y/N)',
    'indicators.controlled':         'Controlled Drug',
    'indicators.actualCostPerDose':  'Actual Cost / Dose',
    'indicators.awpPerDose':         'AWP / Dose',
    'indicators.singleUse':          'Single-Use Product',
    'billing.billingDescription':    'Billing Description',
  }
  return labels[path]
}

/** Escape pipe + newline characters that would break table rendering. */
function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}
