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
  // RxBuilder reference tables — pharmacy-order-entry "most-common"
  // dose / route / frequency / duration per drug. Small dictionaries first
  // (referenced by the larger map tables via *_dictionary_id and the order
  // hub via *_id), then the order hub, then the per-(drug, order) maps.
  'mltm_rxb_order_category',
  'mltm_rxb_order_type',
  'mltm_rxb_dictionary',
  'mltm_rxb_order',
  'mltm_rxb_ord_dose_amount',
  'mltm_rxb_ord_clinical_rte_map',
  'mltm_rxb_order_frequency_map',
  'mltm_rxb_order_prn_map',
  'mltm_rxb_order_dispense_map',
  'mltm_rxb_order_duration_map',
  'mltm_rxb_order_instruction_map',
  // Denormalized one-row-per-NDC table — the read source-of-truth for the
  // app. Populated by seedMultumCombined() after the raw tables are loaded.
  // Keep last so it always has up-to-date raw data to draw from.
  'multum_ndc_combined',
  // Facility identity + contacts. Loaded by scripts/load_facilities.ts into
  // data/multum.db. Pushed via the same push_multum_to_turso.ts script
  // (use --tables= to push only this group when iterating).
  'facilities',
  'facility_cerner_codes',
  'facility_aliases',
  'pharmacy_contacts',
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

-- ============================================================================
-- RxBuilder (RXB) reference tables — Cerner Millennium pharmacy-order-entry
-- defaults. Each drug has one or more order definitions in mltm_rxb_order
-- (keyed by drug_identifier + order_id_nbr → MMDC). Per-order options for
-- dose, route, frequency, etc. live in the *_map tables; the row(s) flagged
-- most_common_ind = 1 are the Cerner-recommended defaults that pharmacy
-- typically wants to autofill into a CDM Request form.
--
-- Dictionary IDs in the *_map tables resolve through mltm_rxb_dictionary
-- (1,980 rows) for human-readable abbreviations + descriptions.
-- ============================================================================

-- 8-row enum (oral / IV / topical / inhalation / …) used by mltm_rxb_order.
CREATE TABLE IF NOT EXISTS mltm_rxb_order_category (
  order_category_id          INTEGER PRIMARY KEY,
  order_category_description TEXT
);

-- 3-row enum (Maintenance Dosing / once / …) used by mltm_rxb_order.
CREATE TABLE IF NOT EXISTS mltm_rxb_order_type (
  order_type_id          INTEGER PRIMARY KEY,
  order_type_description TEXT
);

-- Catch-all dictionary used by every *_map table for unit / route /
-- frequency / duration / instruction / prn descriptions.
CREATE TABLE IF NOT EXISTS mltm_rxb_dictionary (
  dictionary_id  INTEGER PRIMARY KEY,
  abbreviation   TEXT,
  description    TEXT
);

-- Order hub — one row per (drug_identifier, order_id_nbr). MMDC carried here
-- so an MMDC → orders lookup is a single indexed query.
CREATE TABLE IF NOT EXISTS mltm_rxb_order (
  drug_identifier        TEXT NOT NULL,
  order_id_nbr           INTEGER NOT NULL,
  main_multum_drug_code  INTEGER,
  order_category_id      INTEGER,
  order_type_id          INTEGER,
  PRIMARY KEY (drug_identifier, order_id_nbr)
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_order_mmdc ON mltm_rxb_order(main_multum_drug_code);

-- Dose amount + dose-quantity option(s) per order. most_common_ind = 1 marks
-- the default(s) Cerner recommends. Multiple rows per (drug, order) — no PK.
CREATE TABLE IF NOT EXISTS mltm_rxb_ord_dose_amount (
  drug_identifier              TEXT NOT NULL,
  order_id_nbr                 INTEGER NOT NULL,
  dose_amount                  REAL,
  dose_unit_dictionary_id      INTEGER,
  dose_qty_amount              REAL,
  dose_qty_unit_dictionary_id  INTEGER,
  most_common_ind              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_dose_lookup
  ON mltm_rxb_ord_dose_amount(drug_identifier, order_id_nbr, most_common_ind);

-- Clinical route option(s) per order. alternate_admin_route_ind flags
-- secondary routes (e.g. NG/PEG vs PO).
CREATE TABLE IF NOT EXISTS mltm_rxb_ord_clinical_rte_map (
  drug_identifier               TEXT NOT NULL,
  order_id_nbr                  INTEGER NOT NULL,
  clinical_route_dictionary_id  INTEGER,
  most_common_ind               INTEGER NOT NULL DEFAULT 0,
  alternate_admin_route_ind     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_rte_lookup
  ON mltm_rxb_ord_clinical_rte_map(drug_identifier, order_id_nbr, most_common_ind);

CREATE TABLE IF NOT EXISTS mltm_rxb_order_frequency_map (
  drug_identifier         TEXT NOT NULL,
  order_id_nbr            INTEGER NOT NULL,
  frequency_dictionary_id INTEGER,
  most_common_ind         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_freq_lookup
  ON mltm_rxb_order_frequency_map(drug_identifier, order_id_nbr, most_common_ind);

-- PRN option(s) per order. Presence of any row signals PRN-eligible; the
-- prn_dictionary_id resolves to a phrase like "as needed for pain".
CREATE TABLE IF NOT EXISTS mltm_rxb_order_prn_map (
  drug_identifier   TEXT NOT NULL,
  order_id_nbr      INTEGER NOT NULL,
  prn_dictionary_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_prn_lookup
  ON mltm_rxb_order_prn_map(drug_identifier, order_id_nbr);

CREATE TABLE IF NOT EXISTS mltm_rxb_order_dispense_map (
  drug_identifier        TEXT NOT NULL,
  order_id_nbr           INTEGER NOT NULL,
  dispense_amount        REAL,
  dispense_dictionary_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_dispense_lookup
  ON mltm_rxb_order_dispense_map(drug_identifier, order_id_nbr);

CREATE TABLE IF NOT EXISTS mltm_rxb_order_duration_map (
  drug_identifier        TEXT NOT NULL,
  order_id_nbr           INTEGER NOT NULL,
  duration_amount        REAL,
  duration_dictionary_id INTEGER,
  most_common_ind        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_duration_lookup
  ON mltm_rxb_order_duration_map(drug_identifier, order_id_nbr, most_common_ind);

CREATE TABLE IF NOT EXISTS mltm_rxb_order_instruction_map (
  drug_identifier           TEXT NOT NULL,
  order_id_nbr              INTEGER NOT NULL,
  instruction_dictionary_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_instruction_lookup
  ON mltm_rxb_order_instruction_map(drug_identifier, order_id_nbr);

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

-- Facility identity + contacts (mirrors lib/schema.sql facility section).
-- Loaded locally by scripts/load_facilities.ts and pushed via
-- push_multum_to_turso.ts using the shared table list above.
CREATE TABLE IF NOT EXISTS facilities (
  mnemonic   TEXT PRIMARY KEY,
  long_name  TEXT NOT NULL,
  region     TEXT,
  is_acute   INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS facility_cerner_codes (
  mnemonic    TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  code_value  INTEGER NOT NULL,
  display     TEXT,
  description TEXT,
  active_ind  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (mnemonic, domain)
);
CREATE INDEX IF NOT EXISTS idx_facility_cerner_code_value
  ON facility_cerner_codes(domain, code_value);

CREATE TABLE IF NOT EXISTS facility_aliases (
  alias_lower TEXT PRIMARY KEY,
  mnemonic    TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_facility_aliases_mnemonic
  ON facility_aliases(mnemonic);

CREATE TABLE IF NOT EXISTS pharmacy_contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mnemonic     TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT,
  phone        TEXT,
  notes        TEXT,
  raw_value    TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  source_sheet TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (mnemonic, role, name)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_mnemonic
  ON pharmacy_contacts(mnemonic);
CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_role
  ON pharmacy_contacts(role);
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
