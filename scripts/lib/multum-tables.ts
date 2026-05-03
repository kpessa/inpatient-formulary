/**
 * Shared metadata for the mltm_* tables (Cerner Millennium / Multum data model).
 *
 * Two consumers:
 *   - scripts/load_multum_xlsx.ts   (xlsx → local SQLite via better-sqlite3)
 *   - scripts/push_multum_to_turso.ts (local SQLite → Turso via @libsql/client)
 *
 * Source of truth for the schema is still lib/schema.sql; this module mirrors
 * the mltm_* portion so both scripts can apply DDL idempotently without
 * dragging in the entire app schema. Keep these two in sync when adding
 * columns. CREATE TABLE IF NOT EXISTS makes the apply step safe to re-run.
 */

/** Names of all mltm_* tables this loader covers, in dependency-friendly order. */
export const MULTUM_TABLE_NAMES = [
  'mltm_dose_form',
  'mltm_product_strength',
  'mltm_drug_id',
  'mltm_drug_name',
  'mltm_main_drug_code',
  'mltm_ndc',
  'mltm_ndc_cost',
  'mltm_order_sent',
  'mltm_ndc_source',
  // Pill identification — image filename + imprint markings + lookups for
  // shape / color / flavor / additional dose form. Loaded from the
  // MLTM_NDC_IMAGE sheet plus four small dictionary sheets.
  'mltm_shape',
  'mltm_color',
  'mltm_flavor',
  'mltm_additional_doseform',
  'mltm_ndc_image',
  // FDA Orange Book therapeutic-equivalence code dictionary (13 rows).
  // mltm_ndc.orange_book_id joins here for the AB rating + human description.
  'mltm_orange_book',
  // Denormalized one-row-per-NDC table — the read source-of-truth for the
  // app. Populated by seedMultumCombined() after the raw tables are loaded.
  // Keep last so it always has up-to-date raw data to draw from.
  'multum_ndc_combined',
] as const

export type MultumTableName = (typeof MULTUM_TABLE_NAMES)[number]

/**
 * Idempotent CREATE TABLE / CREATE INDEX statements for every mltm_* table.
 * Mirrors lib/schema.sql lines 184-281; keep aligned when columns change.
 */
export const MULTUM_DDL = `
CREATE TABLE IF NOT EXISTS mltm_ndc (
  ndc_formatted           TEXT PRIMARY KEY,
  ndc_code                TEXT NOT NULL,
  main_multum_drug_code   INTEGER,
  brand_code              INTEGER,
  source_id               INTEGER,
  orange_book_id          INTEGER,
  otc_status              TEXT,
  unit_dose_code          TEXT,
  gbo                     TEXT,
  inner_package_size      REAL,
  inner_package_desc_code INTEGER,
  outer_package_size      REAL,
  obsolete_date           TEXT,
  repackaged              TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_mmdc ON mltm_ndc(main_multum_drug_code);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_code ON mltm_ndc(ndc_code);

CREATE TABLE IF NOT EXISTS mltm_main_drug_code (
  main_multum_drug_code  INTEGER PRIMARY KEY,
  dose_form_code         INTEGER,
  product_strength_code  INTEGER,
  drug_identifier        TEXT,
  principal_route_code   INTEGER,
  csa_schedule           TEXT,
  j_code                 TEXT,
  j_code_description     TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_mdc_drug_id ON mltm_main_drug_code(drug_identifier);

CREATE TABLE IF NOT EXISTS mltm_dose_form (
  dose_form_code         INTEGER PRIMARY KEY,
  dose_form_abbr         TEXT,
  dose_form_description  TEXT
);

CREATE TABLE IF NOT EXISTS mltm_product_strength (
  product_strength_code         INTEGER PRIMARY KEY,
  product_strength_description  TEXT
);

CREATE TABLE IF NOT EXISTS mltm_drug_id (
  drug_identifier              TEXT PRIMARY KEY,
  drug_synonym_id              INTEGER,
  pregnancy_abbr               TEXT,
  half_life                    REAL,
  empirically                  TEXT,
  is_single_ingredient         TEXT,
  max_therapeutic_duplication  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mltm_drug_id_syn ON mltm_drug_id(drug_synonym_id);

CREATE TABLE IF NOT EXISTS mltm_drug_name (
  drug_synonym_id  INTEGER NOT NULL,
  drug_name        TEXT NOT NULL,
  is_obsolete      TEXT NOT NULL,
  PRIMARY KEY (drug_synonym_id, drug_name)
);
CREATE INDEX IF NOT EXISTS idx_mltm_drug_name_syn ON mltm_drug_name(drug_synonym_id);

CREATE TABLE IF NOT EXISTS mltm_ndc_cost (
  ndc_code        TEXT NOT NULL,
  inventory_type  TEXT NOT NULL,
  cost            REAL,
  time_stamp      TEXT,
  PRIMARY KEY (ndc_code, inventory_type)
);

CREATE TABLE IF NOT EXISTS mltm_order_sent (
  external_identifier      TEXT PRIMARY KEY,
  main_multum_drug_code    INTEGER,
  catalog_cki              TEXT,
  catalog_concept_cki      TEXT,
  catalog_description      TEXT,
  mnemonic_key_cap         TEXT,
  mnemonic_type            TEXT,
  order_sentence_id        INTEGER,
  rx_type_mean             TEXT,
  sentence_script          TEXT,
  synonym_cki              TEXT,
  synonym_concept_cki      TEXT,
  usage_flag               TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_os_mmdc ON mltm_order_sent(main_multum_drug_code);

CREATE TABLE IF NOT EXISTS mltm_ndc_source (
  source_id    INTEGER PRIMARY KEY,
  source_desc  TEXT,
  address1     TEXT,
  address2     TEXT,
  city         TEXT,
  state        TEXT,
  province     TEXT,
  zip          TEXT,
  country      TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_src_desc ON mltm_ndc_source(LOWER(source_desc));
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_source_id ON mltm_ndc(source_id);

-- Pill-identification lookups. SHAPE/COLOR/FLAVOR/ADDITIONAL_DOSEFORM IDs in
-- mltm_ndc_image join to these dictionaries to render human descriptions
-- ("round" / "pink/red" / "cinnamon" / "sugar free" / "film coated").
CREATE TABLE IF NOT EXISTS mltm_shape (
  shape_id          INTEGER PRIMARY KEY,
  shape_description TEXT
);

CREATE TABLE IF NOT EXISTS mltm_color (
  color_id          INTEGER PRIMARY KEY,
  color_description TEXT
);

CREATE TABLE IF NOT EXISTS mltm_flavor (
  flavor_id          INTEGER PRIMARY KEY,
  flavor_description TEXT
);

CREATE TABLE IF NOT EXISTS mltm_additional_doseform (
  additional_doseform_id   INTEGER PRIMARY KEY,
  additional_doseform_desc TEXT
);

-- One row per (drug-product, presentation). Keyed by NDC_LEFT_9 — the first
-- 9 digits of the packed NDC (5-digit labeler + 4-digit product, no
-- package). Joins to supply_records by SUBSTR(REPLACE(ndc, '-', ''), 1, 9).
-- Source data has zero-stripped NDC_LEFT_9 values; loader pads to 9 chars
-- so the join is straightforward. Multiple rows per ndc_left_9 are possible
-- (different presentations with different imprints) — synthetic id PK.
-- image_filename references a Multum image archive that lives outside this
-- xlsx; surfacing the filename is useful even before the binary is wired up.
CREATE TABLE IF NOT EXISTS mltm_ndc_image (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  ndc_left_9              TEXT NOT NULL,
  shape_id                INTEGER,
  color_id                INTEGER,
  flavor_id               INTEGER,
  additional_doseform_id  INTEGER,
  side_1_marking          TEXT,
  side_2_marking          TEXT,
  scored_ind              INTEGER,
  image_filename          TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_image_left9 ON mltm_ndc_image(ndc_left_9);

-- Orange Book therapeutic-equivalence dictionary. Maps the orange_book_id
-- integer on every NDC to its AB rating ('A', 'B', '1'..'10', 'O') and
-- human description. Code 7073 = 'O' = "Not Rated" dominates (~52% of NDCs);
-- code 7075 = 'A' covers the standard bioequivalent-generic case (~45%).
CREATE TABLE IF NOT EXISTS mltm_orange_book (
  orange_book_id          INTEGER PRIMARY KEY,
  orange_book_desc_ab     TEXT,
  orange_book_description TEXT
);

-- Denormalized one-row-per-NDC table — the app's read source of truth for
-- per-NDC reference data. Built from the raw mltm_* tables via the seed
-- query in scripts/load_multum_xlsx.ts (seedMultumCombined). Going forward,
-- a CCL query on the Cerner side can write directly here, sidestepping the
-- per-table xlsx export workflow.
CREATE TABLE IF NOT EXISTS multum_ndc_combined (
  ndc_formatted             TEXT PRIMARY KEY,
  ndc_left_9                TEXT NOT NULL,
  mmdc                      INTEGER,
  drug_identifier           TEXT,
  source_id                 INTEGER,
  generic_name              TEXT,
  strength_description      TEXT,
  dose_form_description     TEXT,
  csa_schedule              TEXT,
  manufacturer_name         TEXT,
  manufacturer_city         TEXT,
  manufacturer_state        TEXT,
  inner_package_size        REAL,
  outer_package_size        REAL,
  is_unit_dose              INTEGER NOT NULL DEFAULT 0,
  gbo                       TEXT,
  repackaged                INTEGER NOT NULL DEFAULT 0,
  otc_status                TEXT,
  obsolete_date             TEXT,
  awp                       REAL,
  acquisition_cost          REAL,
  orange_book_id            INTEGER,
  orange_book_rating        TEXT,                 -- 'A'/'B'/'1'..'10'/'O' from mltm_orange_book.orange_book_desc_ab
  orange_book_description   TEXT,                 -- "Therapeutically Equivalent" etc.
  imprint_side_1            TEXT,
  imprint_side_2            TEXT,
  is_scored                 INTEGER NOT NULL DEFAULT 0,
  pill_shape                TEXT,
  pill_color                TEXT,
  pill_flavor               TEXT,
  additional_dose_form      TEXT,
  image_filename            TEXT,
  loaded_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_multum_combined_mmdc      ON multum_ndc_combined(mmdc);
CREATE INDEX IF NOT EXISTS idx_multum_combined_left9     ON multum_ndc_combined(ndc_left_9);
CREATE INDEX IF NOT EXISTS idx_multum_combined_generic   ON multum_ndc_combined(LOWER(generic_name));
CREATE INDEX IF NOT EXISTS idx_multum_combined_obsolete  ON multum_ndc_combined(obsolete_date) WHERE obsolete_date IS NULL;
`

/**
 * Splits MULTUM_DDL into individual statements. Useful for clients (like
 * libsql's batch API) that don't accept multi-statement strings.
 *
 * Strips `--` line comments before splitting so semicolons in prose
 * comments ("zero-stripped values; loader pads") don't fragment the SQL.
 * Block comments (`/* * /`) are not supported here — none in the DDL.
 */
export function multumDdlStatements(): string[] {
  const stripped = MULTUM_DDL.replace(/--[^\n]*/g, '')
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
