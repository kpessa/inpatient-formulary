/**
 * Maps c152e_extract.csv columns to typed, camelCase properties.
 *
 * The CSV is NDC-granular: one row per NDC, with GROUP_ID linking all NDCs
 * for the same formulary entry. FormularyItem represents the group-level
 * record (header fields + OE Defaults + Dispense + Clinical + Inventory).
 * SupplyRecord represents one NDC row in the Supply tab grid.
 */

// ---------------------------------------------------------------------------
// OE Defaults tab
// ---------------------------------------------------------------------------
export interface OeDefaults {
  /** DOSE */
  dose: string;
  /** REF_DOSE */
  referenceDose: string;
  /** ROUTE */
  route: string;
  /** FREQUENCY */
  frequency: string;
  /** INFUSE_OVER */
  infuseOver: string;
  /** INFUSE_OVER_UNIT */
  infuseOverUnit: string;
  /** RATE */
  rate: string;
  /** RATE_UNIT */
  rateUnit: string;
  /** NORMALIZED_RATE */
  normalizedRate: string;
  /** NORMALIZED_RATE_UNIT */
  normalizedRateUnit: string;
  /** FREETEXT_RATE */
  freetextRate: string;
  /** PRN */
  isPrn: boolean;
  /** PRN_REASON */
  prnReason: string;
  /** DURATION */
  duration: number | null;
  /** DURATION_UNIT */
  durationUnit: string;
  /** STOP_TYPE */
  stopType: string;
  /** ORDERED_AS_SYNONYM — "Default ordered as" dropdown */
  orderedAsSynonym: string;
  /** DEF_FORMAT — "Default screen format" (Medication | Continuous | TPN) */
  defaultFormat: string;
  /** SEARCH_MED */
  searchMedication: boolean;
  /** SEARCH_CONT */
  searchContinuous: boolean;
  /** SEARCH_INTERMIT */
  searchIntermittent: boolean;
  /** NOTES1 */
  notes1: string;
  /** NOTES1_APPLIESTO_FILL */
  notes1AppliesToFill: boolean;
  /** NOTES1_APPLIESTO_LABEL */
  notes1AppliesToLabel: boolean;
  /** NOTES1_APPLIESTO_MAR */
  notes1AppliesToMar: boolean;
  /** NOTES2 */
  notes2: string;
  /** NOTES2_APPLIESTO_FILL */
  notes2AppliesToFill: boolean;
  /** NOTES2_APPLIESTO_LABEL */
  notes2AppliesToLabel: boolean;
  /** NOTES2_APPLIESTO_MAR */
  notes2AppliesToMar: boolean;
}

// ---------------------------------------------------------------------------
// Dispense tab
// ---------------------------------------------------------------------------
export interface DispenseInfo {
  /** STRENGTH */
  strength: number | null;
  /** STRENGTH_UNIT */
  strengthUnit: string;
  /** VOLUME */
  volume: number | null;
  /** VOLUME_UNIT */
  volumeUnit: string;
  /** USED_IN_TOTAL_VOLUME_CALCULATION */
  usedInTotalVolumeCalculation: boolean;
  /** DISPENSE_QTY */
  dispenseQty: number | null;
  /** DISPENSE_QTY_UNIT */
  dispenseQtyUnit: string;
  /** DISPENSE_CATEGORY — e.g. UD, IVPB */
  dispenseCategory: string;
  /** DIVISIBLE_IND */
  isDivisible: boolean;
  /** INFINITE_DIV_IND */
  isInfinitelyDivisible: boolean;
  /** MINIMUM_DOSE_QTY — minimum divisible factor */
  minimumDoseQty: number | null;
  /** PKG_SIZE — "Number of" in Package dispense quantity */
  packageSize: number | null;
  /** PKG_UNIT */
  packageUnit: string;
  /** OUTER_PKG_SIZE */
  outerPackageSize: number | null;
  /** OUTER_PKG_UNIT */
  outerPackageUnit: string;
  /** BASE_PKG_UNIT */
  basePackageUnit: string;
  /** PKG_DISP_QTY */
  packageDispenseQty: number | null;
  /** PKG_DISP_ONLY_QTY_NEED */
  packageDispenseOnlyQtyNeeded: boolean;
  /** FORMULARY_STATUS */
  formularyStatus: string;
  /** PRICE_SCHEDULE */
  priceSchedule: string;
  /** AWP_FACTOR */
  awpFactor: number | null;
  /** DEFAULT_PAR_DOSES */
  defaultParDoses: number | null;
  /** MAX_PAR_QTY */
  maxParQty: number | null;
}

// ---------------------------------------------------------------------------
// Clinical tab
// ---------------------------------------------------------------------------
export interface ClinicalInfo {
  /** GENERIC_FORMULATION_CODE — "Generic formulation" lookup */
  genericFormulationCode: string;
  /** DRUG_FORMULATION_CODE — "Drug formulation (drug, strength, form)" lookup */
  drugFormulationCode: string;
  /** SUPPRESS_MULTUM_IND — "Suppress clinical checking alerts" */
  suppressMultumAlerts: boolean;
  /** THERAPEUTIC_CLASS */
  therapeuticClass: string;
  /** DC_INTER_DAYS — Order catalog DC interaction days */
  dcInteractionDays: number | null;
  /** DC_DISPLAY_DAYS — Order catalog DC display days */
  dcDisplayDays: number | null;
  /** ORDER_ALERT_1 */
  orderAlert1: string;
}

// ---------------------------------------------------------------------------
// Inventory tab
// ---------------------------------------------------------------------------
export interface InventoryInfo {
  /** ALL_FAC — formulary is available at all facilities */
  allFacilities: boolean;
  /**
   * FAC:* columns — set of facility names where this item is active.
   * Key is the facility name (e.g. "GW Hospital"), value is true if active.
   */
  facilities: Record<string, boolean>;
  /** DISPENSE_FROM — Check location list | Always non-floorstock | Always floorstock */
  dispenseFrom: string;
  /** REUSABLE_IND */
  isReusable: boolean;
  /** INV_FACTOR */
  inventoryFactor: number | null;
  /** INV_BASE_PKG_UNIT */
  inventoryBasePackageUnit: string;
}

// ---------------------------------------------------------------------------
// Supply tab — one record per NDC row in the CSV
// ---------------------------------------------------------------------------
export interface SupplyRecord {
  /** NDC — Drug ID shown in Supply grid */
  ndc: string;
  /** NON_REF_IND — inner NDC indicator */
  isNonReference: boolean;
  /** ACTIVE_IND */
  isActive: boolean;
  /** MANUFACTURER */
  manufacturer: string;
  /** MANF_BRAND */
  manufacturerBrandName: string;
  /** MANF_LABEL_DESC */
  manufacturerLabelDescription: string;
  /** MANF_GENERIC */
  manufacturerGenericName: string;
  /** MANF_MNEMONIC */
  manufacturerMnemonic: string;
  /** MANF_PYXIS */
  manufacturerPyxisId: string;
  /** MANF_UB92 */
  manufacturerUb92: string;
  /** MANF_RX_UNIQUEID */
  manufacturerRxUniqueId: string;
  /** MANF_ACTIVE_IND */
  isManufacturerActive: boolean;
  /** MANF_FORMULARY_STATUS */
  manufacturerFormularyStatus: string;
  /** PRIMARY_IND — primary/reference NDC for the group */
  isPrimary: boolean;
  /** BIO_IND — biological indicator */
  isBiological: boolean;
  /** BRAND_IND — B = brand, G = generic */
  isBrand: boolean;
  /** UNIT_DOSE_IND */
  isUnitDose: boolean;
  /** COST:AWP */
  awpCost: number | null;
  /** COST:COST1 */
  cost1: number | null;
  /** COST:COST2 */
  cost2: number | null;
  /** RXDEVICE1–5 */
  rxDevices: [string, string, string, string, string];
  /** RXMISC1–5 */
  rxMisc: [string, string, string, string, string];
  /** RX UNIQUEID */
  rxUniqueId: string;
}

// ---------------------------------------------------------------------------
// Identifiers — flattened from brand/charge/mnemonic columns
// ---------------------------------------------------------------------------
export interface Identifiers {
  /** BRAND_NAME */
  brandName: string;
  /** BRAND_PRIMARY_IND */
  isBrandPrimary: boolean;
  /** BRAND_NAME2 */
  brandName2: string;
  /** BRAND2_PRIMARY_IND */
  isBrand2Primary: boolean;
  /** BRAND_NAME3 */
  brandName3: string;
  /** BRAND3_PRIMARY_IND */
  isBrand3Primary: boolean;
  /** CHARGE_NBR */
  chargeNumber: string;
  /** LABEL_DESC — short description shown in identifiers grid */
  labelDescription: string;
  /** GENERIC_NAME */
  genericName: string;
  /** HCPCS */
  hcpcsCode: string;
  /** MNEMONIC */
  mnemonic: string;
  /** PYXIS — Pyxis Interface ID */
  pyxisId: string;
  /** GROUP_RX_MNEM */
  groupRxMnemonic: string;
}

// ---------------------------------------------------------------------------
// Task tracking
// ---------------------------------------------------------------------------
export interface ChangeTask {
  id: string
  drugKey: string
  drugDescription: string
  type: 'diff' | 'free_form'
  fieldName?: string
  fieldLabel?: string
  targetDomain?: string
  domainValues?: string  // JSON snapshot: { "west_prod": "val", ... }
  targetValue?: string
  status: 'pending' | 'in_progress' | 'done'
  assignedTo?: string
  notes?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  completedBy?: string
}

export interface FieldOverride {
  id: string
  domain: string
  groupId: string
  fieldPath: string        // e.g. 'description', 'oeDefaults.dose'
  overrideValue: string    // JSON-encoded scalar
  taskId?: string
  appliedAt: string
  appliedBy: string
}

export interface BuildDomainProgress {
  buildId: string
  domain: string
  status: 'pending' | 'in_progress' | 'done'
  completedAt?: string
  completedBy?: string
  notes?: string
}

export interface ProductBuild {
  id: string
  drugDescription: string
  drugKey?: string
  status: 'in_progress' | 'review' | 'complete'
  notes?: string
  createdAt: string
  createdBy?: string
  domainProgress?: BuildDomainProgress[]
}

// ---------------------------------------------------------------------------
// Category Manager
// ---------------------------------------------------------------------------

export interface DrugCategory {
  id: string
  name: string
  description: string
  color: string
  manualCount: number
  ruleCount: number
  totalCount: number
}

export interface CategoryRule {
  id: string
  categoryId: string
  field: 'dispenseCategory' | 'therapeuticClass' | 'dosageForm' | 'status' | 'strength'
  operator: 'equals' | 'contains' | 'starts_with' | 'ends_with'
  value: string
}

export interface CategoryMember {
  groupId: string
  drugDescription: string
  source: 'manual' | 'rule'
  ruleId?: string   // which rule matched, if source === 'rule'
}

// ---------------------------------------------------------------------------
// Search Filter Groups
// ---------------------------------------------------------------------------

export interface SearchFilterGroup {
  id: string
  name: string
  icon: string
  field: 'dosage_form' | 'route' | 'dispense_category'
  values: string[]   // exact DB values (not LIKE patterns)
  sortOrder: number
}

// ---------------------------------------------------------------------------
// Top-level FormularyItem — one per GROUP_ID
// ---------------------------------------------------------------------------
export interface FormularyItem {
  /** GROUP_ID — internal formulary group key linking related NDCs */
  groupId: string;

  // --- Global header fields (visible on all tabs) ---
  /** LABEL_DESC — primary description shown in the Description field */
  description: string;
  /** STRENGTH + STRENGTH_UNIT — displayed as "500 mg" */
  strength: string;
  strengthUnit: string;
  /** ACTIVE_IND mapped to "Active" | "Inactive" */
  status: "Active" | "Inactive";
  /** GENERIC_NAME */
  genericName: string;
  /** FORM — dosage form (Tab, Cap-EC, Soln-IV, …) */
  dosageForm: string;
  /** LEGAL_STATUS — Legend | OTC | Controlled */
  legalStatus: string;
  /** MNEMONIC */
  mnemonic: string;

  // --- Tab sections ---
  oeDefaults: OeDefaults;
  dispense: DispenseInfo;
  clinical: ClinicalInfo;
  inventory: InventoryInfo;
  identifiers: Identifiers;
  /**
   * All NDC rows belonging to this group.
   * Shown in the Supply tab grid.
   */
  supplyRecords: SupplyRecord[];
}
