/**
 * Stage 1 of the Multum loader: xlsx → local SQLite (data/multum.db).
 *
 * The previous version of this script wrote directly to Turso via @libsql/client,
 * which paid a network round-trip per 500-row batch and took ~65 minutes for the
 * full extract. This rewrite stages everything in a local SQLite file via
 * better-sqlite3 (synchronous, in-process, transaction-batched) — should
 * complete in well under a minute. Run scripts/push_multum_to_turso.ts as a
 * second step to push the staged DB up to Turso.
 *
 * Source workbook: one sheet per MLTM_* table (Cerner Millennium data model
 * export). The current loader reads 14 sheets:
 *   mltm_ndc_core_description    → mltm_ndc
 *   mltm_ndc_main_drug_code      → mltm_main_drug_code
 *   mltm_dose_form               → mltm_dose_form
 *   mltm_product_strength        → mltm_product_strength
 *   mltm_drug_id                 → mltm_drug_id
 *   mltm_drug_name               → mltm_drug_name
 *   mltm_ndc_cost                → mltm_ndc_cost
 *   mltm_order_sent              → mltm_order_sent
 *   MLTM_NDC_SOURCE              → mltm_ndc_source
 *   MLTM_SHAPE                   → mltm_shape                (pill-ID lookups)
 *   MLTM_COLOR                   → mltm_color
 *   MLTM_FLAVOR                  → mltm_flavor
 *   MLTM_ADDITIONAL_DOSEFORM     → mltm_additional_doseform
 *   MLTM_NDC_IMAGE               → mltm_ndc_image            (imprint + filename)
 *
 * Idempotent: each table is wiped + reloaded inside a single transaction.
 *
 * Usage:
 *   tsx scripts/load_multum_xlsx.ts                           # defaults: data/mltm.xlsx → data/multum.db
 *   tsx scripts/load_multum_xlsx.ts /path/to/dump.xlsx        # custom xlsx
 *   tsx scripts/load_multum_xlsx.ts --db=/tmp/mltm.db         # custom output DB
 *   tsx scripts/load_multum_xlsx.ts --tables=mltm_ndc,mltm_dose_form   # subset
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { MULTUM_DDL } from './lib/multum-tables'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx')

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const flagTables = args.find((a) => a.startsWith('--tables='))?.slice('--tables='.length)
const flagDb = args.find((a) => a.startsWith('--db='))?.slice('--db='.length)
const positional = args.find((a) => !a.startsWith('--'))

const XLSX_PATH = positional ? path.resolve(positional) : path.join(process.cwd(), 'data', 'mltm.xlsx')
const DB_PATH = flagDb ? path.resolve(flagDb) : path.join(process.cwd(), 'data', 'multum.db')
const ONLY = flagTables ? new Set(flagTables.split(',').map((s) => s.trim())) : null

// ---------------------------------------------------------------------------
// Type coercion helpers — xlsx returns strings/numbers/null/undefined, the
// shapes are not always consistent. These funnel everything to clean SQL types.
// ---------------------------------------------------------------------------
function asInt(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10)
  return Number.isFinite(n) ? n : null
}
function asReal(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim())
  return Number.isFinite(n) ? n : null
}
function asText(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
/** OBSOLETE_DATE / TIME_STAMP arrive like '  04/01/26' — keep as text, NULL when blank. */
function asDateText(v: unknown): string | null {
  return asText(v)
}

/**
 * NDC_LEFT_9 in the source data is zero-stripped (xlsx parsed `000370711` as
 * the integer 370711 → text "370711"). We need a fixed 9-char form for clean
 * joins to supply_records, so pad with leading zeros at load time.
 */
function asNdcLeft9(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(/[^0-9]/g, '')
  if (!s) return null
  if (s.length > 9) return s.slice(-9) // shouldn't happen, but defensively trim
  return s.padStart(9, '0')
}

// ---------------------------------------------------------------------------
// Per-sheet table specs. Each spec lists (column-name → SQL field) and the
// transform. xlsx headers can have whitespace/case quirks, so we look up by
// exact uppercase header names.
// ---------------------------------------------------------------------------
interface Spec {
  table: string
  sheet: string
  /** Column name in the xlsx sheet header row → (sql column, coercion). */
  cols: Array<[string, string, (v: unknown) => unknown]>
  /** SQL columns in INSERT order. */
  insertCols: string[]
  /** Optional row filter — return false to skip a row (e.g. rows missing required FK). */
  filter?: (row: Record<string, unknown>) => boolean
}

const SPECS: Spec[] = [
  {
    table: 'mltm_ndc',
    sheet: 'mltm_ndc_core_description',
    cols: [
      ['NDC_FORMATTED',           'ndc_formatted',           asText],
      ['NDC_CODE',                'ndc_code',                asText],
      ['MAIN_MULTUM_DRUG_CODE',   'main_multum_drug_code',   asInt],
      ['BRAND_CODE',              'brand_code',              asInt],
      ['SOURCE_ID',               'source_id',               asInt],
      ['ORANGE_BOOK_ID',          'orange_book_id',          asInt],
      ['OTC_STATUS',              'otc_status',              asText],
      ['UNIT_DOSE_CODE',          'unit_dose_code',          asText],
      ['GBO',                     'gbo',                     asText],
      ['INNER_PACKAGE_SIZE',      'inner_package_size',      asReal],
      ['INNER_PACKAGE_DESC_CODE', 'inner_package_desc_code', asInt],
      ['OUTER_PACKAGE_SIZE',      'outer_package_size',      asReal],
      ['OBSOLETE_DATE',           'obsolete_date',           asDateText],
      ['REPACKAGED',              'repackaged',              asText],
    ],
    insertCols: [
      'ndc_formatted','ndc_code','main_multum_drug_code','brand_code','source_id','orange_book_id',
      'otc_status','unit_dose_code','gbo','inner_package_size','inner_package_desc_code',
      'outer_package_size','obsolete_date','repackaged',
    ],
    filter: (r) => r.NDC_FORMATTED != null && String(r.NDC_FORMATTED).trim() !== '',
  },
  {
    table: 'mltm_main_drug_code',
    sheet: 'mltm_ndc_main_drug_code',
    cols: [
      ['MAIN_MULTUM_DRUG_CODE', 'main_multum_drug_code', asInt],
      ['DOSE_FORM_CODE',        'dose_form_code',        asInt],
      ['PRODUCT_STRENGTH_CODE', 'product_strength_code', asInt],
      ['DRUG_IDENTIFIER',       'drug_identifier',       asText],
      ['PRINCIPAL_ROUTE_CODE',  'principal_route_code',  asInt],
      ['CSA_SCHEDULE',          'csa_schedule',          asText],
      ['J_CODE',                'j_code',                asText],
      ['J_CODE_DESCRIPTION',    'j_code_description',    asText],
    ],
    insertCols: [
      'main_multum_drug_code','dose_form_code','product_strength_code','drug_identifier',
      'principal_route_code','csa_schedule','j_code','j_code_description',
    ],
    filter: (r) => r.MAIN_MULTUM_DRUG_CODE != null,
  },
  {
    table: 'mltm_dose_form',
    sheet: 'mltm_dose_form',
    cols: [
      ['DOSE_FORM_CODE',        'dose_form_code',        asInt],
      ['DOSE_FORM_ABBR',        'dose_form_abbr',        asText],
      ['DOSE_FORM_DESCRIPTION', 'dose_form_description', asText],
    ],
    insertCols: ['dose_form_code','dose_form_abbr','dose_form_description'],
    filter: (r) => r.DOSE_FORM_CODE != null,
  },
  {
    table: 'mltm_product_strength',
    sheet: 'mltm_product_strength',
    cols: [
      ['PRODUCT_STRENGTH_CODE',        'product_strength_code',        asInt],
      ['PRODUCT_STRENGTH_DESCRIPTION', 'product_strength_description', asText],
    ],
    insertCols: ['product_strength_code','product_strength_description'],
    filter: (r) => r.PRODUCT_STRENGTH_CODE != null,
  },
  {
    table: 'mltm_drug_id',
    sheet: 'mltm_drug_id',
    cols: [
      ['DRUG_IDENTIFIER',             'drug_identifier',             asText],
      ['DRUG_SYNONYM_ID',             'drug_synonym_id',             asInt],
      ['PREGNANCY_ABBR',              'pregnancy_abbr',              asText],
      ['HALF_LIFE',                   'half_life',                   asReal],
      ['EMPIRICALLY',                 'empirically',                 asText],
      ['IS_SINGLE_INGREDIENT',        'is_single_ingredient',        asText],
      ['MAX_THERAPEUTIC_DUPLICATION', 'max_therapeutic_duplication', asInt],
    ],
    insertCols: [
      'drug_identifier','drug_synonym_id','pregnancy_abbr','half_life','empirically',
      'is_single_ingredient','max_therapeutic_duplication',
    ],
    filter: (r) => r.DRUG_IDENTIFIER != null && String(r.DRUG_IDENTIFIER).trim() !== '',
  },
  {
    table: 'mltm_drug_name',
    sheet: 'mltm_drug_name',
    cols: [
      ['DRUG_SYNONYM_ID', 'drug_synonym_id', asInt],
      ['DRUG_NAME',       'drug_name',       asText],
      ['IS_OBSOLETE',     'is_obsolete',     asText],
    ],
    insertCols: ['drug_synonym_id','drug_name','is_obsolete'],
    filter: (r) =>
      r.DRUG_SYNONYM_ID != null &&
      r.DRUG_NAME != null && String(r.DRUG_NAME).trim() !== '',
  },
  {
    table: 'mltm_ndc_cost',
    sheet: 'mltm_ndc_cost',
    cols: [
      ['NDC_CODE',       'ndc_code',       asText],
      ['INVENTORY_TYPE', 'inventory_type', asText],
      ['COST',           'cost',           asReal],
      ['TIME_STAMP',     'time_stamp',     asDateText],
    ],
    insertCols: ['ndc_code','inventory_type','cost','time_stamp'],
    filter: (r) =>
      r.NDC_CODE != null && String(r.NDC_CODE).trim() !== '' &&
      r.INVENTORY_TYPE != null && String(r.INVENTORY_TYPE).trim() !== '',
  },
  {
    table: 'mltm_order_sent',
    sheet: 'mltm_order_sent',
    cols: [
      ['EXTERNAL_IDENTIFIER',   'external_identifier',   asText],
      ['MAIN_MULTUM_DRUG_CODE', 'main_multum_drug_code', asInt],
      ['CATALOG_CKI',           'catalog_cki',           asText],
      ['CATALOG_CONCEPT_CKI',   'catalog_concept_cki',   asText],
      ['CATALOG_DESCRIPTION',   'catalog_description',   asText],
      ['MNEMONIC_KEY_CAP',      'mnemonic_key_cap',      asText],
      ['MNEMONIC_TYPE',         'mnemonic_type',         asText],
      ['ORDER_SENTENCE_ID',     'order_sentence_id',     asInt],
      ['RX_TYPE_MEAN',          'rx_type_mean',          asText],
      ['SENTENCE_SCRIPT',       'sentence_script',       asText],
      ['SYNONYM_CKI',           'synonym_cki',           asText],
      ['SYNONYM_CONCEPT_CKI',   'synonym_concept_cki',   asText],
      ['USAGE_FLAG',            'usage_flag',            asText],
    ],
    insertCols: [
      'external_identifier','main_multum_drug_code','catalog_cki','catalog_concept_cki',
      'catalog_description','mnemonic_key_cap','mnemonic_type','order_sentence_id',
      'rx_type_mean','sentence_script','synonym_cki','synonym_concept_cki','usage_flag',
    ],
    filter: (r) => r.EXTERNAL_IDENTIFIER != null && String(r.EXTERNAL_IDENTIFIER).trim() !== '',
  },
  {
    // Manufacturer / labeler dictionary. Joins to mltm_ndc.source_id.
    // Sheet name in the workbook is uppercase ('MLTM_NDC_SOURCE').
    // ZIP is coerced to TEXT — the source data mixes integer ('8807' = 08807)
    // and hyphenated extended-zip ('60073-0490') values.
    table: 'mltm_ndc_source',
    sheet: 'MLTM_NDC_SOURCE',
    cols: [
      ['SOURCE_ID',   'source_id',   asInt],
      ['SOURCE_DESC', 'source_desc', asText],
      ['ADDRESS1',    'address1',    asText],
      ['ADDRESS2',    'address2',    asText],
      ['CITY',        'city',        asText],
      ['STATE',       'state',       asText],
      ['PROVINCE',    'province',    asText],
      ['ZIP',         'zip',         asText],
      ['COUNTRY',     'country',     asText],
    ],
    insertCols: [
      'source_id','source_desc','address1','address2','city','state','province','zip','country',
    ],
    filter: (r) => r.SOURCE_ID != null,
  },
  // ---------------------------------------------------------------------------
  // Pill-identification lookups + image-metadata table.
  // ---------------------------------------------------------------------------
  {
    table: 'mltm_shape',
    sheet: 'MLTM_SHAPE',
    cols: [
      ['SHAPE_ID',          'shape_id',          asInt],
      ['SHAPE_DESCRIPTION', 'shape_description', asText],
    ],
    insertCols: ['shape_id', 'shape_description'],
    filter: (r) => r.SHAPE_ID != null,
  },
  {
    table: 'mltm_color',
    sheet: 'MLTM_COLOR',
    cols: [
      ['COLOR_ID',          'color_id',          asInt],
      ['COLOR_DESCRIPTION', 'color_description', asText],
    ],
    insertCols: ['color_id', 'color_description'],
    filter: (r) => r.COLOR_ID != null,
  },
  {
    table: 'mltm_flavor',
    sheet: 'MLTM_FLAVOR',
    cols: [
      ['FLAVOR_ID',          'flavor_id',          asInt],
      ['FLAVOR_DESCRIPTION', 'flavor_description', asText],
    ],
    insertCols: ['flavor_id', 'flavor_description'],
    filter: (r) => r.FLAVOR_ID != null,
  },
  {
    table: 'mltm_additional_doseform',
    sheet: 'MLTM_ADDITIONAL_DOSEFORM',
    cols: [
      ['ADDITIONAL_DOSEFORM_ID',   'additional_doseform_id',   asInt],
      ['ADDITIONAL_DOSEFORM_DESC', 'additional_doseform_desc', asText],
    ],
    insertCols: ['additional_doseform_id', 'additional_doseform_desc'],
    filter: (r) => r.ADDITIONAL_DOSEFORM_ID != null,
  },
  {
    // FDA Orange Book therapeutic-equivalence dictionary. ~13 rows mapping
    // the integer code on each mltm_ndc row to its AB rating ('A', 'B',
    // '1'-'10', 'O') and human description.
    table: 'mltm_orange_book',
    sheet: 'MLTM_NDC_ORANGE_BOOK',
    cols: [
      ['ORANGE_BOOK_ID',          'orange_book_id',          asInt],
      ['ORANGE_BOOK_DESC_AB',     'orange_book_desc_ab',     asText],
      ['ORANGE_BOOK_DESCRIPTION', 'orange_book_description', asText],
    ],
    insertCols: ['orange_book_id', 'orange_book_desc_ab', 'orange_book_description'],
    filter: (r) => r.ORANGE_BOOK_ID != null,
  },
  {
    // Pill image / imprint metadata — joined by ndc_left_9 (first 9 digits
    // of the packed NDC). image_filename references a Multum image archive
    // delivered separately; we surface filename + imprint markings so users
    // get useful pill-ID info even before the binary is wired up.
    table: 'mltm_ndc_image',
    sheet: 'MLTM_NDC_IMAGE',
    cols: [
      ['NDC_LEFT_9',             'ndc_left_9',             asNdcLeft9],
      ['SHAPE_ID',               'shape_id',               asInt],
      ['COLOR_ID',               'color_id',               asInt],
      ['FLAVOR_ID',              'flavor_id',              asInt],
      ['ADDITIONAL_DOSEFORM_ID', 'additional_doseform_id', asInt],
      ['SIDE_1_MARKING',         'side_1_marking',         asText],
      ['SIDE_2_MARKING',         'side_2_marking',         asText],
      ['SCORED_IND',             'scored_ind',             asInt],
      ['IMAGE',                  'image_filename',         asText],
    ],
    insertCols: [
      'ndc_left_9', 'shape_id', 'color_id', 'flavor_id', 'additional_doseform_id',
      'side_1_marking', 'side_2_marking', 'scored_ind', 'image_filename',
    ],
    filter: (r) => r.NDC_LEFT_9 != null && String(r.NDC_LEFT_9).trim() !== '',
  },
]

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
function loadSheet(db: Database.Database, wb: import('xlsx').WorkBook, spec: Spec) {
  const sheet = wb.Sheets[spec.sheet]
  if (!sheet) {
    console.warn(`  ⚠ sheet "${spec.sheet}" not found — skipping ${spec.table}`)
    return
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  })

  const filtered = spec.filter ? rawRows.filter(spec.filter) : rawRows
  const total = filtered.length
  if (total === 0) {
    console.log(`  ${spec.table}: 0 rows in sheet — skipping`)
    return
  }

  const placeholders = '(' + spec.insertCols.map(() => '?').join(',') + ')'
  const insertSql =
    `INSERT OR REPLACE INTO ${spec.table} (${spec.insertCols.join(',')}) VALUES ${placeholders}`

  console.log(`  ${spec.table}: ${total.toLocaleString()} rows → wiping + inserting`)
  const t0 = Date.now()

  db.prepare(`DELETE FROM ${spec.table}`).run()
  const stmt = db.prepare(insertSql)
  // better-sqlite3's transaction() returns a function that runs the body
  // inside a single transaction — by far the fastest way to bulk-insert.
  const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      stmt.run(spec.cols.map(([key, , coerce]) => coerce(row[key]) as unknown))
    }
  })
  insertMany(filtered)

  console.log(`    ${total.toLocaleString()} inserted in ${((Date.now() - t0) / 1000).toFixed(2)}s`)
}

function run() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`File not found: ${XLSX_PATH}`)
    console.error(`Pass a path: tsx scripts/load_multum_xlsx.ts /path/to/file.xlsx`)
    process.exit(1)
  }

  // Ensure data/ exists (it always does in this project, but better-sqlite3
  // will throw if a custom --db= path's directory is missing).
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

  console.log(`Source: ${XLSX_PATH}`)
  console.log(`Target: ${DB_PATH} (local SQLite)`)

  const db = new Database(DB_PATH)
  // Bulk-load PRAGMAs: WAL + reduced fsync + larger cache. Safe for a one-shot
  // local staging file; the data is reproducible from the xlsx if anything
  // goes wrong.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -200000') // ~200 MB

  console.log('Applying mltm_* DDL (idempotent)…')
  db.exec(MULTUM_DDL)

  console.log(`Reading workbook…`)
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: false, cellNF: false })
  console.log(`  sheets: ${wb.SheetNames.length}`)

  const work = ONLY ? SPECS.filter((s) => ONLY.has(s.table)) : SPECS
  console.log(`Loading ${work.length} table(s)…`)

  const t0 = Date.now()
  for (const spec of work) {
    loadSheet(db, wb, spec)
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  // Build the denormalized read-side table from the raw tables we just loaded.
  // Skipped when --tables= filter excluded multum_ndc_combined; otherwise
  // always rebuild — it's fast against indexed local SQLite and ensures
  // the combined table reflects the latest raw data.
  if (!ONLY || ONLY.has('multum_ndc_combined')) {
    seedMultumCombined(db)
  }

  // Optional: ANALYZE so subsequent SELECTs (and the push step) plan well.
  console.log('Running ANALYZE…')
  db.exec('ANALYZE')

  db.close()
  console.log(`\nDone in ${elapsed}s. Next step: pnpm db:push:multum:turso`)
}

/**
 * Rebuilds `multum_ndc_combined` from the raw mltm_* tables. One row per NDC
 * with all the columns the app actually reads (identity, package, cost,
 * manufacturer, pill ID).
 *
 * Picks where the joins are 1:N:
 *   - generic_name: first non-obsolete drug_name alphabetically
 *   - pill image:   first row by (filename present) DESC, (imprint present) DESC, id
 *   - cost:         AWP from inventory_type='A', acquisition (WAC) from 'W'.
 *                   Confirmed against this Multum extract — distribution shows
 *                   A=AWP (77K rows), W=WAC (60K rows), F=Federal, M=Medicare-ish.
 *                   Classic AWP/WAC ratio confirms the mapping
 *                   (e.g. NDC 00002-7510-01 has AWP $79.68 / WAC $66.40).
 */
function seedMultumCombined(db: Database.Database) {
  const t0 = Date.now()
  console.log('  multum_ndc_combined: rebuilding from raw tables…')
  // Drop + re-apply DDL so schema changes (new columns/indexes) take effect.
  // CREATE TABLE IF NOT EXISTS at the top of the loader is a no-op when the
  // table already exists with the old schema; explicit DROP guarantees the
  // current MULTUM_DDL shape. Other mltm_* tables aren't touched here —
  // re-exec'ing MULTUM_DDL is idempotent for them (all CREATE IF NOT EXISTS).
  db.exec('DROP TABLE IF EXISTS multum_ndc_combined')
  db.exec(MULTUM_DDL)
  const result = db.exec(`
    INSERT INTO multum_ndc_combined (
      ndc_formatted, ndc_left_9, mmdc, drug_identifier, source_id,
      generic_name, strength_description, dose_form_description, csa_schedule,
      manufacturer_name, manufacturer_city, manufacturer_state,
      inner_package_size, outer_package_size, is_unit_dose, gbo, repackaged,
      otc_status, obsolete_date,
      awp, acquisition_cost, orange_book_id, orange_book_rating, orange_book_description,
      imprint_side_1, imprint_side_2, is_scored, pill_shape, pill_color,
      pill_flavor, additional_dose_form, image_filename
    )
    SELECT
      n.ndc_formatted,
      SUBSTR(REPLACE(n.ndc_formatted, '-', ''), 1, 9) AS ndc_left_9,
      n.main_multum_drug_code AS mmdc,
      mc.drug_identifier,
      n.source_id,
      (SELECT dn.drug_name FROM mltm_drug_name dn
       WHERE dn.drug_synonym_id = di.drug_synonym_id
         AND dn.is_obsolete = 'F'
       ORDER BY dn.drug_name LIMIT 1) AS generic_name,
      ps.product_strength_description,
      df.dose_form_description,
      mc.csa_schedule,
      src.source_desc,
      src.city,
      src.state,
      n.inner_package_size,
      n.outer_package_size,
      CASE WHEN n.unit_dose_code IN ('Y','U') THEN 1 ELSE 0 END,
      n.gbo,
      CASE WHEN n.repackaged = 'T' THEN 1 ELSE 0 END,
      n.otc_status,
      n.obsolete_date,
      awp_cost.cost,
      acq_cost.cost,
      n.orange_book_id,
      ob.orange_book_desc_ab,
      ob.orange_book_description,
      img.side_1_marking,
      img.side_2_marking,
      CASE WHEN img.scored_ind = 1 THEN 1 ELSE 0 END,
      sh.shape_description,
      cl.color_description,
      fl.flavor_description,
      adf.additional_doseform_desc,
      img.image_filename
    FROM mltm_ndc n
    LEFT JOIN mltm_main_drug_code mc
           ON mc.main_multum_drug_code = n.main_multum_drug_code
    LEFT JOIN mltm_drug_id di
           ON di.drug_identifier = mc.drug_identifier
    LEFT JOIN mltm_product_strength ps
           ON ps.product_strength_code = mc.product_strength_code
    LEFT JOIN mltm_dose_form df
           ON df.dose_form_code = mc.dose_form_code
    LEFT JOIN mltm_ndc_source src
           ON src.source_id = n.source_id
    LEFT JOIN mltm_ndc_cost awp_cost
           ON awp_cost.ndc_code = n.ndc_code AND awp_cost.inventory_type = 'A'
    LEFT JOIN mltm_ndc_cost acq_cost
           ON acq_cost.ndc_code = n.ndc_code AND acq_cost.inventory_type = 'W'
    LEFT JOIN mltm_orange_book ob
           ON ob.orange_book_id = n.orange_book_id
    LEFT JOIN (
      SELECT i.*, ROW_NUMBER() OVER (
        PARTITION BY i.ndc_left_9
        ORDER BY (i.image_filename IS NOT NULL) DESC,
                 (i.side_1_marking IS NOT NULL) DESC,
                 i.id
      ) AS rn
      FROM mltm_ndc_image i
    ) img
      ON img.ndc_left_9 = SUBSTR(REPLACE(n.ndc_formatted, '-', ''), 1, 9)
     AND img.rn = 1
    LEFT JOIN mltm_shape sh              ON sh.shape_id = img.shape_id
    LEFT JOIN mltm_color cl              ON cl.color_id = img.color_id
    LEFT JOIN mltm_flavor fl             ON fl.flavor_id = img.flavor_id
    LEFT JOIN mltm_additional_doseform adf
           ON adf.additional_doseform_id = img.additional_doseform_id
    WHERE n.ndc_formatted IS NOT NULL
  `)
  // better-sqlite3's exec() doesn't return rowcount; query separately.
  const n = (db.prepare('SELECT COUNT(*) AS n FROM multum_ndc_combined').get() as { n: number }).n
  // Quick column-coverage telemetry — useful for verifying the seed
  // populated the columns you expect (e.g. 230K NDCs but only 50K with
  // generic_name signals a busted join).
  const coverage = db.prepare(`
    SELECT
      SUM(generic_name IS NOT NULL) AS w_generic,
      SUM(strength_description IS NOT NULL) AS w_strength,
      SUM(dose_form_description IS NOT NULL) AS w_form,
      SUM(manufacturer_name IS NOT NULL) AS w_mfr,
      SUM(awp IS NOT NULL) AS w_awp,
      SUM(acquisition_cost IS NOT NULL) AS w_acq,
      SUM(orange_book_rating IS NOT NULL AND orange_book_rating != 'O') AS w_ob_rated,
      SUM(imprint_side_1 IS NOT NULL) AS w_imprint,
      SUM(image_filename IS NOT NULL) AS w_image,
      SUM(obsolete_date IS NULL) AS w_active
    FROM multum_ndc_combined
  `).get() as Record<string, number>
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
  console.log(`    ${n.toLocaleString()} rows in ${elapsed}s`)
  console.log(`    coverage: generic=${coverage.w_generic.toLocaleString()} strength=${coverage.w_strength.toLocaleString()} form=${coverage.w_form.toLocaleString()} mfr=${coverage.w_mfr.toLocaleString()} awp=${coverage.w_awp.toLocaleString()} acq=${coverage.w_acq.toLocaleString()} ob_rated=${coverage.w_ob_rated.toLocaleString()} imprint=${coverage.w_imprint.toLocaleString()} image=${coverage.w_image.toLocaleString()} active=${coverage.w_active.toLocaleString()}`)
  // Suppress the lint warning about result being unused — exec() returns
  // the Database for chaining; we don't use it.
  void result
}

run()
