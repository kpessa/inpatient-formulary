CREATE TABLE IF NOT EXISTS formulary_groups (
  id               INTEGER PRIMARY KEY,
  domain           TEXT NOT NULL,
  region           TEXT NOT NULL,
  environment      TEXT NOT NULL,
  extracted_at     TEXT NOT NULL,
  group_id         TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  generic_name     TEXT NOT NULL DEFAULT '',
  mnemonic         TEXT NOT NULL DEFAULT '',
  charge_number    TEXT NOT NULL DEFAULT '',
  brand_name       TEXT NOT NULL DEFAULT '',
  brand_name2      TEXT NOT NULL DEFAULT '',
  brand_name3      TEXT NOT NULL DEFAULT '',
  pyxis_id         TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'Active',
  formulary_status TEXT NOT NULL DEFAULT '',
  strength         TEXT NOT NULL DEFAULT '',
  strength_unit    TEXT NOT NULL DEFAULT '',
  dosage_form      TEXT NOT NULL DEFAULT '',
  legal_status     TEXT NOT NULL DEFAULT '',
  identifiers_json TEXT NOT NULL DEFAULT '{}',
  oe_defaults_json TEXT NOT NULL DEFAULT '{}',
  dispense_json    TEXT NOT NULL DEFAULT '{}',
  clinical_json    TEXT NOT NULL DEFAULT '{}',
  inventory_json   TEXT NOT NULL DEFAULT '{}',
  route                TEXT NOT NULL DEFAULT '',
  dispense_category    TEXT NOT NULL DEFAULT '',
  therapeutic_class    TEXT NOT NULL DEFAULT '',
  dispense_strength      TEXT NOT NULL DEFAULT '',
  dispense_strength_unit TEXT NOT NULL DEFAULT '',
  dispense_volume        TEXT NOT NULL DEFAULT '',
  dispense_volume_unit   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_fg_domain       ON formulary_groups(domain);
CREATE INDEX IF NOT EXISTS idx_fg_group_id     ON formulary_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_fg_region_env   ON formulary_groups(region, environment);
CREATE INDEX IF NOT EXISTS idx_fg_env_extract  ON formulary_groups(environment, extracted_at);

-- Covering indexes for the fast scalar search path.
-- Each index uses LOWER(column) as the leading key so SQLite can do a case-insensitive
-- B-tree range scan (WHERE LOWER(col) >= ? AND LOWER(col) < ?) without touching the
-- main table rows (which contain large JSON blobs).
-- Critical for Turso (remote SQLite): reduces ~17 table-page fetches per query
-- (~200ms each) to ~1-2 compact index-page fetches.
-- The original column is stored as the second key so the original-case value is
-- available for SELECT without a table lookup (fully covering).
CREATE INDEX IF NOT EXISTS idx_fg_cov_description ON formulary_groups(
  LOWER(description), description, group_id, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_generic_name ON formulary_groups(
  LOWER(generic_name), generic_name, group_id, description, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_mnemonic ON formulary_groups(
  LOWER(mnemonic), mnemonic, group_id, description, generic_name, strength, strength_unit, dosage_form,
  status, charge_number, brand_name, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_charge_number ON formulary_groups(
  charge_number, group_id, description, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, brand_name, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_pyxis_id ON formulary_groups(
  pyxis_id, group_id, description, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, brand_name, formulary_status, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_brand_name ON formulary_groups(
  LOWER(brand_name), brand_name, group_id, description, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_brand_name2 ON formulary_groups(
  LOWER(brand_name2), brand_name2, group_id, description, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, brand_name, formulary_status, pyxis_id, region, environment
);
CREATE INDEX IF NOT EXISTS idx_fg_cov_brand_name3 ON formulary_groups(
  LOWER(brand_name3), brand_name3, group_id, description, generic_name, strength, strength_unit, dosage_form,
  mnemonic, status, charge_number, brand_name, brand_name2, formulary_status, pyxis_id, region, environment
);

CREATE TABLE IF NOT EXISTS supply_records (
  id                      INTEGER PRIMARY KEY,
  domain                  TEXT NOT NULL,
  group_id                TEXT NOT NULL,
  ndc                     TEXT NOT NULL DEFAULT '',
  is_non_reference        INTEGER NOT NULL DEFAULT 0,
  is_active               INTEGER NOT NULL DEFAULT 1,
  manufacturer            TEXT NOT NULL DEFAULT '',
  manufacturer_brand      TEXT NOT NULL DEFAULT '',
  manufacturer_label_desc TEXT NOT NULL DEFAULT '',
  is_primary              INTEGER NOT NULL DEFAULT 0,
  is_biological           INTEGER NOT NULL DEFAULT 0,
  is_brand                INTEGER NOT NULL DEFAULT 0,
  is_unit_dose            INTEGER NOT NULL DEFAULT 0,
  awp_cost                REAL,
  cost1                   REAL,
  cost2                   REAL,
  supply_json             TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sr_domain_group ON supply_records(domain, group_id);
CREATE INDEX IF NOT EXISTS idx_sr_ndc ON supply_records(ndc);

CREATE TABLE IF NOT EXISTS drug_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Manual membership (cross-domain: groupId only, no domain)
CREATE TABLE IF NOT EXISTS category_members (
  category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  drug_description TEXT,             -- denormalized for display
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (category_id, group_id)
);

-- Explicit Pyxis ID list per category (drives SearchModal category search)
CREATE TABLE IF NOT EXISTS category_pyxis_ids (
  category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
  pyxis_id    TEXT NOT NULL,
  added_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (category_id, pyxis_id)
);

-- Rule-based membership (dynamic; evaluated at query time)
CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
  field TEXT NOT NULL,               -- 'dispenseCategory' | 'therapeuticClass' | 'dosageForm' | 'status' | 'strength'
  operator TEXT NOT NULL CHECK (operator IN ('equals','contains','starts_with','ends_with','in','matches_regex')),
  value TEXT NOT NULL,
  negated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Search filter groups (dosage form / route / dispense category groupings for advanced search)
-- Populated via Category Manager → Filter Groups tab. Run scripts/migrate_filter_columns.ts first.
CREATE TABLE IF NOT EXISTS search_filter_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',
  field       TEXT NOT NULL,                -- 'dosage_form' | 'route' | 'dispense_category'
  values_json TEXT NOT NULL DEFAULT '[]',   -- JSON array of exact column values
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Multum NDC cost/package reference data (loaded via scripts/load_multum_ndcs.ts)
CREATE TABLE IF NOT EXISTS multum_ndcs (
  ndc_formatted  TEXT PRIMARY KEY,
  a_cost         REAL,
  awp            REAL,
  inner_pkg_size REAL,
  inner_pkg_code TEXT,
  outer_pkg_size REAL,
  unit_dose_code TEXT,
  gbo            TEXT
);
CREATE INDEX IF NOT EXISTS idx_mn_ndc ON multum_ndcs(ndc_formatted);

-- ============================================================================
-- Multum data model — full normalized extract from Cerner's MLTM_* tables.
-- Loaded via scripts/load_multum_xlsx.ts from a Multum xlsx dump.
--
-- Distinct from the `multum_ndcs` CSV table above (cost/package only, smaller).
-- Both can coexist; the new mltm_* tables are the source-of-truth for the
-- Formulary Diagnosis Scanner's stacking probe (see findStackCandidates in
-- lib/db.ts).
--
-- The Main Multum Drug Code (MMDC, mltm_ndc.main_multum_drug_code) is the
-- canonical Cerner stacking key. Per Cerner's data model docs:
--   "An MMDC is assigned to each unique combination of: active ingredient(s),
--    principal_route_code, dose_form_code, and product_strength."
-- Two NDCs share an MMDC iff they are interchangeable from a CDM-build
-- perspective. Filter siblings by `obsolete_date IS NULL` to avoid
-- recommending stack-onto a discontinued NDC.
-- ============================================================================

-- MLTM_NDC_CORE_DESCRIPTION — one row per NDC (~229K rows in full extract).
CREATE TABLE IF NOT EXISTS mltm_ndc (
  ndc_formatted           TEXT PRIMARY KEY,         -- 5-4-2 hyphenated, matches barcode parser output
  ndc_code                TEXT NOT NULL,            -- raw integer-stripped form, joins mltm_ndc_cost
  main_multum_drug_code   INTEGER,                  -- MMDC — Cerner stacking key
  brand_code              INTEGER,
  source_id               INTEGER,
  orange_book_id          INTEGER,
  otc_status              TEXT,                     -- 'Rx' / 'OTC' / NULL
  unit_dose_code          TEXT,                     -- 'U' or 'N'
  gbo                     TEXT,                     -- 'B' brand / 'G' generic / NULL
  inner_package_size      REAL,
  inner_package_desc_code INTEGER,
  outer_package_size      REAL,
  obsolete_date           TEXT,                     -- NULL = active; otherwise date discontinued
  repackaged              TEXT                      -- 'T' or 'F'
);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_mmdc ON mltm_ndc(main_multum_drug_code);
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_code ON mltm_ndc(ndc_code);

-- MLTM_NDC_MAIN_DRUG_CODE — one row per MMDC (~15.8K rows).
-- Defines the formulation: drug + dose form + strength + route.
CREATE TABLE IF NOT EXISTS mltm_main_drug_code (
  main_multum_drug_code  INTEGER PRIMARY KEY,
  dose_form_code         INTEGER,                   -- → mltm_dose_form
  product_strength_code  INTEGER,                   -- → mltm_product_strength
  drug_identifier        TEXT,                      -- → mltm_drug_id (e.g. 'd00236')
  principal_route_code   INTEGER,
  csa_schedule           TEXT,
  j_code                 TEXT,
  j_code_description     TEXT
);
CREATE INDEX IF NOT EXISTS idx_mltm_mdc_drug_id ON mltm_main_drug_code(drug_identifier);

-- MLTM_DOSE_FORM — dose form dictionary (~87 rows).
CREATE TABLE IF NOT EXISTS mltm_dose_form (
  dose_form_code         INTEGER PRIMARY KEY,
  dose_form_abbr         TEXT,
  dose_form_description  TEXT
);

-- MLTM_PRODUCT_STRENGTH — strength dictionary (~7.5K rows).
CREATE TABLE IF NOT EXISTS mltm_product_strength (
  product_strength_code         INTEGER PRIMARY KEY,
  product_strength_description  TEXT
);

-- MLTM_DRUG_ID — generic drug master (~4.2K rows).
CREATE TABLE IF NOT EXISTS mltm_drug_id (
  drug_identifier              TEXT PRIMARY KEY,    -- e.g. 'd00236'
  drug_synonym_id              INTEGER,             -- → mltm_drug_name for display
  pregnancy_abbr               TEXT,
  half_life                    REAL,
  empirically                  TEXT,
  is_single_ingredient         TEXT,                -- 'T' (single) or 'F' (combo). Probe respects this.
  max_therapeutic_duplication  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mltm_drug_id_syn ON mltm_drug_id(drug_synonym_id);

-- MLTM_DRUG_NAME — drug names + synonyms (~79K rows).
-- Composite PK because one synonym_id can map to multiple names (e.g. brand variants).
CREATE TABLE IF NOT EXISTS mltm_drug_name (
  drug_synonym_id  INTEGER NOT NULL,
  drug_name        TEXT NOT NULL,
  is_obsolete      TEXT NOT NULL,                   -- 'T' or 'F'
  PRIMARY KEY (drug_synonym_id, drug_name)
);
CREATE INDEX IF NOT EXISTS idx_mltm_drug_name_syn ON mltm_drug_name(drug_synonym_id);

-- MLTM_NDC_COST — pricing per (NDC, inventory_type) (~154K active rows).
-- Joined to mltm_ndc on ndc_code (the integer-stripped form, NOT ndc_formatted).
CREATE TABLE IF NOT EXISTS mltm_ndc_cost (
  ndc_code        TEXT NOT NULL,                    -- joins mltm_ndc.ndc_code
  inventory_type  TEXT NOT NULL,                    -- 'A' = AWP, others
  cost            REAL,
  time_stamp      TEXT,
  PRIMARY KEY (ndc_code, inventory_type)
);

-- MLTM_ORDER_SENT — Multum-defined order sentences keyed on MMDC (~70K rows).
-- Lets the trace surface "the existing build's Multum-suggested order sentences are…"
-- when a stack candidate is identified.
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

-- MLTM_NDC_SOURCE — manufacturer/labeler dictionary (~2.5K rows).
-- mltm_ndc.source_id → mltm_ndc_source.source_id resolves an NDC's labeler.
-- ZIP is TEXT because Multum stores both numeric ('8807' = 08807) and
-- hyphenated extended-zip ('60073-0490') values.
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
-- Add an index on mltm_ndc.source_id so labeler-→-NDC joins don't full-scan.
CREATE INDEX IF NOT EXISTS idx_mltm_ndc_source_id ON mltm_ndc(source_id);

-- Indexes on denormalized columns
CREATE INDEX IF NOT EXISTS idx_fg_dosage_form      ON formulary_groups(dosage_form);
CREATE INDEX IF NOT EXISTS idx_fg_route            ON formulary_groups(route);
CREATE INDEX IF NOT EXISTS idx_fg_dispense_cat     ON formulary_groups(dispense_category);
CREATE INDEX IF NOT EXISTS idx_fg_therapeutic_class ON formulary_groups(therapeutic_class);
CREATE INDEX IF NOT EXISTS idx_fg_dispense_strength ON formulary_groups(dispense_strength);

-- Manual exclusions: drugs explicitly removed from a category even if they match rules
CREATE TABLE IF NOT EXISTS category_exclusions (
  category_id      TEXT NOT NULL REFERENCES drug_categories(id) ON DELETE CASCADE,
  group_id         TEXT NOT NULL,
  drug_description TEXT NOT NULL DEFAULT '',
  added_at         TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (category_id, group_id)
);

-- Design Patterns / Linter
CREATE TABLE IF NOT EXISTS design_patterns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#F97316',
  scope_type  TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'category' | 'rule'
  scope_value TEXT NOT NULL DEFAULT '',      -- category_id OR JSON {"field","operator","value"}
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pattern_field_rules (
  id               TEXT PRIMARY KEY,
  pattern_id       TEXT NOT NULL REFERENCES design_patterns(id) ON DELETE CASCADE,
  field            TEXT NOT NULL,
  operator         TEXT NOT NULL,
  -- equals|contains|starts_with|ends_with|matches_regex|not_empty|not_equals|not_contains
  value            TEXT NOT NULL DEFAULT '',
  expected_display TEXT NOT NULL DEFAULT '',
  created_at       TEXT DEFAULT (datetime('now'))
);

-- CDM (Charge Description Master) reference data
CREATE TABLE IF NOT EXISTS cdm_master (
  cdm_code    TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  tech_desc   TEXT NOT NULL DEFAULT '',
  ins_code    TEXT NOT NULL DEFAULT '',
  gl_key      TEXT NOT NULL DEFAULT '',
  proc_code   TEXT NOT NULL DEFAULT '',
  rev_code    TEXT NOT NULL DEFAULT '',
  divisor     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cdm_description ON cdm_master(LOWER(description));
CREATE INDEX IF NOT EXISTS idx_cdm_proc_code ON cdm_master(proc_code);

-- Task system tables
CREATE TABLE IF NOT EXISTS change_tasks (
  id TEXT PRIMARY KEY,
  drug_key TEXT NOT NULL,
  drug_description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('diff', 'free_form')),
  field_name TEXT,
  field_label TEXT,
  target_domain TEXT,
  domain_values TEXT,
  target_value TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
  assigned_to TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT,
  group_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ct_drug_key ON change_tasks(drug_key);
CREATE INDEX IF NOT EXISTS idx_ct_status ON change_tasks(status);

CREATE TABLE IF NOT EXISTS field_overrides (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  group_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  override_value TEXT NOT NULL,
  task_id TEXT,
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fo_domain_group ON field_overrides(domain, group_id);

CREATE TABLE IF NOT EXISTS product_builds (
  id TEXT PRIMARY KEY,
  drug_description TEXT NOT NULL,
  drug_key TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'review', 'complete')),
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS build_domain_progress (
  build_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
  completed_at TEXT,
  completed_by TEXT,
  notes TEXT,
  PRIMARY KEY (build_id, domain)
);

CREATE TABLE IF NOT EXISTS task_domain_progress (
  task_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
  completed_at TEXT,
  completed_by TEXT,
  notes TEXT,
  PRIMARY KEY (task_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_tdp_task_id ON task_domain_progress(task_id);

-- DailyMed (NIH/NLM) per-NDC cache. The DailyMed REST API at
-- https://dailymed.nlm.nih.gov/dailymed/services/v2/ is rate-permissive but
-- internet-bound, so cache the SPL setId + image manifest per NDC. The
-- payload stores the resolved metadata (title, set ID, image URLs) so the
-- popover doesn't re-hit NIH on every open.
--
-- has_data = 0 means DailyMed has no SPL for this NDC (negative cache, so
-- we don't keep retrying for an NDC NIH simply doesn't index).
-- fetched_at = unix epoch seconds; treat entries older than ~30 days as stale.
CREATE TABLE IF NOT EXISTS dailymed_cache (
  ndc          TEXT PRIMARY KEY,
  fetched_at   INTEGER NOT NULL,
  has_data     INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

-- OpenFDA per-NDC cache. https://api.fda.gov/drug/ndc.json (NDC Directory) and
-- /drug/label.json (Structured Product Label) are publicly accessible but
-- internet-bound and rate-limited per IP. Cache the directory entry plus the
-- subset of SPL fields the scanner surfaces (indications, dosage, warnings).
--
-- Same shape and retention semantics as dailymed_cache: 30-day TTL, has_data=0
-- is a negative cache so we don't repeat-call for NDCs OpenFDA doesn't index.
CREATE TABLE IF NOT EXISTS openfda_cache (
  ndc          TEXT PRIMARY KEY,
  fetched_at   INTEGER NOT NULL,
  has_data     INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

-- RxNorm (NIH/NLM) per-NDC cache. https://rxnav.nlm.nih.gov/REST resolves NDC
-- → RxCUI, then ingredient/brand/clinical-drug concepts. Same retention shape
-- as dailymed_cache / openfda_cache: 30-day TTL, has_data=0 negative cache.
CREATE TABLE IF NOT EXISTS rxnorm_cache (
  ndc          TEXT PRIMARY KEY,
  fetched_at   INTEGER NOT NULL,
  has_data     INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

-- ============================================================================
-- Multum pill-identification — image filename + imprint markings + lookups
-- for shape / color / flavor / additional dose form. Loaded from MLTM_NDC_IMAGE
-- and the four small dictionary sheets via scripts/load_multum_xlsx.ts.
-- See scripts/lib/multum-tables.ts for the source-of-truth DDL.
-- ============================================================================

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

-- Keyed by NDC_LEFT_9 — first 9 digits of the packed NDC (labeler+product,
-- no package). Joins to supply_records via SUBSTR(REPLACE(ndc, '-', ''), 1, 9).
-- Multiple rows per ndc_left_9 are possible (different presentations) so the
-- PK is a synthetic id. Loader pads NDC_LEFT_9 to 9 chars at insert time.
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

-- FDA Orange Book therapeutic-equivalence dictionary. Maps mltm_ndc.orange_book_id
-- to the AB rating ('A', 'B', '1'..'10', 'O') and human description.
-- 7073 = 'O' = "Not Rated" dominates; 7075 = 'A' = "Therapeutically Equivalent".
CREATE TABLE IF NOT EXISTS mltm_orange_book (
  orange_book_id          INTEGER PRIMARY KEY,
  orange_book_desc_ab     TEXT,
  orange_book_description TEXT
);

-- ============================================================================
-- RxBuilder (RXB) reference tables — Cerner Millennium pharmacy-order-entry
-- defaults. mltm_rxb_order is the join hub (drug_identifier + order_id_nbr →
-- MMDC); per-order options for dose, route, frequency, etc. live in the
-- *_map tables. Rows flagged most_common_ind = 1 are the Cerner-recommended
-- defaults — used to autofill the CDM Request form's pharmacy-side cells
-- (Usual Dose, Route, Usual Frequency, PRN Y/N).
-- Dictionary IDs resolve through mltm_rxb_dictionary (~1.9K rows).
-- ============================================================================

CREATE TABLE IF NOT EXISTS mltm_rxb_order_category (
  order_category_id          INTEGER PRIMARY KEY,
  order_category_description TEXT
);

CREATE TABLE IF NOT EXISTS mltm_rxb_order_type (
  order_type_id          INTEGER PRIMARY KEY,
  order_type_description TEXT
);

CREATE TABLE IF NOT EXISTS mltm_rxb_dictionary (
  dictionary_id  INTEGER PRIMARY KEY,
  abbreviation   TEXT,
  description    TEXT
);

CREATE TABLE IF NOT EXISTS mltm_rxb_order (
  drug_identifier        TEXT NOT NULL,
  order_id_nbr           INTEGER NOT NULL,
  main_multum_drug_code  INTEGER,
  order_category_id      INTEGER,
  order_type_id          INTEGER,
  PRIMARY KEY (drug_identifier, order_id_nbr)
);
CREATE INDEX IF NOT EXISTS idx_mltm_rxb_order_mmdc ON mltm_rxb_order(main_multum_drug_code);

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
-- per-NDC reference data. Seeded by scripts/load_multum_xlsx.ts after the
-- raw mltm_* tables are loaded. Going forward, a CCL query on the Cerner
-- side can write directly here, sidestepping the per-table xlsx export.
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
  orange_book_rating        TEXT,
  orange_book_description   TEXT,
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

-- ============================================================================
-- Extract changeset viewer — pre-computed delta between consecutive extracts.
-- Computed by scripts/compute_extract_changes.ts at the end of deploy-db.sh,
-- read by the admin route /admin/extract-changes. See memory entry
-- project_extract_changeset_viewer.md for design context.
--
-- One row in extract_runs per deploy; one row in extract_changes per
-- (drug, change) pair so the UI can pivot by field-name later.
-- ============================================================================
-- ============================================================================
-- Facility identity tables — cross-source mapping for NDC-move alerting and
-- contact resolution. Three input sources feed these:
--   • UHS Pharmacy Contact Information.xlsx (authoritative business scope —
--     ~36 acute-care hospitals, formatted "MNEMONIC - Long Name")
--   • facilities.xlsx (Cerner FACILITY code-set dump, ~838 active rows across
--     P152E/P152C/P152W; many sub-clinics + labs we don't care about)
--   • end_user_facility.csv (Service Desk ticket source — uses
--     "Long Name (MNEMONIC)" naming convention)
--
-- Mnemonic (e.g. 'WRM' for Wellington Regional) is the cross-source stable
-- key — appears in all three sources just in different positions. The
-- alias table catches everything else (colloquial spellings, sub-displays).
-- ============================================================================

CREATE TABLE IF NOT EXISTS facilities (
  mnemonic   TEXT PRIMARY KEY,            -- 'WRM', 'AIK', 'ABM', …
  long_name  TEXT NOT NULL,                -- 'Wellington Regional Medical Center'
  region     TEXT,                         -- 'East', 'Central', 'West'
  is_acute   INTEGER NOT NULL DEFAULT 1,   -- 0 for BH / Omnicell / AMB / CentRx
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-Cerner-domain code mapping. Translates the integer loc_facility_cd that
-- the CCL admin-scan query returns into a canonical facility row, and lets
-- the app generate domain-aware queries. One row per (mnemonic, domain).
CREATE TABLE IF NOT EXISTS facility_cerner_codes (
  mnemonic    TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  domain      TEXT NOT NULL,                -- 'P152E', 'P152C', 'P152W'
  code_value  INTEGER NOT NULL,
  display     TEXT,                          -- Cerner DISPLAY ('WRM Center')
  description TEXT,                          -- Cerner DESCRIPTION ('WRM- Wellington…')
  active_ind  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (mnemonic, domain)
);
CREATE INDEX IF NOT EXISTS idx_facility_cerner_code_value
  ON facility_cerner_codes(domain, code_value);

-- Free-form alias index. Holds every observed string form of every facility
-- (Cerner DISPLAY, DESCRIPTION, contacts long-name, Service Desk variants,
-- manually-added colloquial spellings) so any incoming string can resolve to
-- a canonical mnemonic via single-row lookup. alias_lower is the lowercased
-- form for case-insensitive matching.
CREATE TABLE IF NOT EXISTS facility_aliases (
  alias_lower TEXT PRIMARY KEY,
  mnemonic    TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  -- 'cerner_display' / 'cerner_description' / 'contacts_long_name' /
  -- 'service_desk' / 'service_desk_with_parens' / 'manual'
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_facility_aliases_mnemonic
  ON facility_aliases(mnemonic);

-- Pharmacy contacts — flattened from the UHS Pharmacy Contact Information
-- workbook (one row per role per facility). Used by NDC-move alerting to
-- decide who to email at each affected facility. The same mnemonic can
-- appear in multiple sheets (acute vs BH); source_sheet tracks origin.
CREATE TABLE IF NOT EXISTS pharmacy_contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mnemonic     TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
  -- 'pharmacy_director' / 'operations_manager' / 'clinical_manager' /
  -- 'ip_pharmacist' / 'is_director' / 'main_pharmacy_phone'
  role         TEXT NOT NULL,
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  raw_value    TEXT,                              -- original cell text for audit
  source_sheet TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_mnemonic
  ON pharmacy_contacts(mnemonic);
CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_role
  ON pharmacy_contacts(role);

CREATE TABLE IF NOT EXISTS extract_runs (
  id            TEXT PRIMARY KEY,                 -- e.g. 'formulary-20260503'
  ran_at        TEXT NOT NULL DEFAULT (datetime('now')),
  prev_run_id   TEXT,                              -- id of the prior extract_run
  summary_json  TEXT NOT NULL DEFAULT '{}'         -- per-domain aggregate counts
);

CREATE TABLE IF NOT EXISTS extract_changes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            TEXT NOT NULL,
  -- 'added'              — new group_id (no prior presence in any domain)
  -- 'cross_domain_added' — group_id existed elsewhere; now appears in this domain
  -- 'modified'           — same (domain, group_id), at least one signature field differs
  -- 'removed'            — present in old extract, absent in new
  change_type       TEXT NOT NULL CHECK(change_type IN ('added','cross_domain_added','modified','removed')),
  domain            TEXT NOT NULL,
  group_id          TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',     -- denormalized for display
  -- Clinical event classification — what an admin recognizes:
  --   'new_build'          — genuinely new drug (was 'added')
  --   'cross_domain_add'   — appeared in this domain; existed elsewhere
  --   'flex'               — inventory_json.facilities gained keys
  --   'unflex'             — inventory_json.facilities lost keys / flipped to false
  --   'stack'              — new NDC linked to existing drug (from supply_records diff)
  --   'status_change'      — formulary_status flipped
  --   'description_change' — description / generic_name / mnemonic edited
  --   'other_modified'     — modified row with no specific clinical bucket
  --   'removed'            — drug no longer present
  -- A single drug can produce MULTIPLE rows (flexed AND status_changed = 2 rows).
  event_type        TEXT NOT NULL DEFAULT 'other_modified',
  -- Field-level diffs as JSON array. Shape depends on event_type:
  --   'modified' family : [{"field":"dispense_category","old":"Vial","new":"Syringe"},...]
  --   'flex'/'unflex'   : [{"field":"facilities","old":"[]","new":"[\"BWH\",\"MGH\"]"}]
  --                       (array of facility names that flexed/unflexed encoded as JSON)
  --   'stack'           : [{"field":"ndc","old":"","new":"0008-0123-45"},...] one per new NDC
  --   'new_build'/'removed': '[]'
  field_diffs_json  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_ec_run_type    ON extract_changes(run_id, change_type);
CREATE INDEX IF NOT EXISTS idx_ec_run_event   ON extract_changes(run_id, event_type);
CREATE INDEX IF NOT EXISTS idx_ec_run_domain  ON extract_changes(run_id, domain);
CREATE INDEX IF NOT EXISTS idx_ec_run_group   ON extract_changes(run_id, group_id);
