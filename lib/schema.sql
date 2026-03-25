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
  inventory_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_fg_domain     ON formulary_groups(domain);
CREATE INDEX IF NOT EXISTS idx_fg_group_id   ON formulary_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_fg_region_env ON formulary_groups(region, environment);

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

-- Denormalized columns extracted from JSON blobs (added via migration scripts)
-- ALTER TABLE formulary_groups ADD COLUMN route TEXT NOT NULL DEFAULT '';
-- ALTER TABLE formulary_groups ADD COLUMN dispense_category TEXT NOT NULL DEFAULT '';
-- CREATE INDEX IF NOT EXISTS idx_fg_dosage_form      ON formulary_groups(dosage_form);
-- CREATE INDEX IF NOT EXISTS idx_fg_route            ON formulary_groups(route);
-- CREATE INDEX IF NOT EXISTS idx_fg_dispense_cat     ON formulary_groups(dispense_category);
-- (scripts/migrate_filter_columns.ts)
--
-- ALTER TABLE formulary_groups ADD COLUMN therapeutic_class TEXT NOT NULL DEFAULT '';
-- UPDATE formulary_groups SET therapeutic_class = COALESCE(json_extract(clinical_json, '$.therapeuticClass'), '') WHERE therapeutic_class = '';
-- CREATE INDEX IF NOT EXISTS idx_fg_therapeutic_class ON formulary_groups(therapeutic_class);
-- (scripts/migrate_therapeutic_class.ts)

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
