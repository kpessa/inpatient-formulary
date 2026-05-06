import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * POST /api/admin/ndc-move-alert
 *
 * Two-step workflow rolled into one endpoint:
 *
 *   1. Caller posts a list of CDM codes. We always return the parameterized
 *      CCL query to copy into Discern Explorer.
 *   2. If the caller also includes pastedTsv, we parse the scan results,
 *      resolve facility names → mnemonics via facility_aliases, fetch
 *      flexed-facilities-per-CDM from formulary_groups.inventory_json, and
 *      bucket facilities into tier-1 (recent admin scans → urgent alert)
 *      and tier-2 (flexed but no recent scans → heads-up).
 *
 * Each tier carries the relevant pharmacy_contacts so the UI can render
 * mailto links per facility.
 *
 * `force-dynamic` because the underlying tables are edited via the admin
 * CRUD routes; we don't want stale snapshots.
 */
export const dynamic = 'force-dynamic'

interface RequestBody {
  cdmCodes: string[]
  /** TSV pasted from Discern Explorer. Headers: DOMAIN, BARCODE, FACILITY, SCAN_COUNT.
   *  May be the concatenation of three runs (P152E/P152C/P152W) — curdomain
   *  self-tags each row, so we don't need to know which domain the user
   *  copied first. */
  pastedTsv?: string
  /** Lookback window (days) — only used to format the CCL string; doesn't
   *  affect parsing. */
  lookbackDays?: number
}

interface ContactBrief {
  role: string
  name: string
  email: string | null
  phone: string | null
}

interface FacilityAlert {
  mnemonic: string
  longName: string
  region: string | null
  scanCount: number                   // total scans across all matching CDMs
  scansByCdm: Record<string, number>  // per-CDM breakdown
  contacts: ContactBrief[]
}

interface UnresolvedFacility {
  facility: string
  domain: string
  scanCount: number
}

export interface NdcMoveAlertResponse {
  cclQuery: string
  cdmCodes: string[]
  /** Per-CDM resolved info: which group, description, which domains have it. */
  cdmContext: Array<{
    cdmCode: string
    description: string | null
    flexedFacilities: string[]    // mnemonics with the CDM flexed in any prod domain
  }>
  parsedScanRows: number          // total parsed (after dedupe)
  tier1: FacilityAlert[]          // scanned in last N days (URGENT)
  tier2: FacilityAlert[]          // flexed but no recent scans
  unresolvedFacilities: UnresolvedFacility[]
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as RequestBody | null
  if (!body || !Array.isArray(body.cdmCodes) || body.cdmCodes.length === 0) {
    return NextResponse.json({ error: 'cdmCodes (string[]) required' }, { status: 400 })
  }

  const cdmCodes = body.cdmCodes
    .map(s => s.trim())
    .filter(s => /^\d{4,12}$/.test(s))           // CDM codes are numeric
  if (cdmCodes.length === 0) {
    return NextResponse.json(
      { error: 'No valid CDM codes (must be numeric 4-12 digits)' },
      { status: 400 },
    )
  }

  const lookbackDays = body.lookbackDays ?? 30
  const cclQuery = buildCclQuery(cdmCodes, lookbackDays)

  const db = getDb()

  // ─── CDM context: lookup descriptions + flexed-facility lists ─────────
  const placeholders = cdmCodes.map(() => '?').join(',')
  const { rows: cdmRows } = await db.execute({
    sql: `SELECT charge_number, domain, description, inventory_json
          FROM formulary_groups
          WHERE charge_number IN (${placeholders})
            AND environment = 'prod'`,
    args: cdmCodes,
  })

  // Group flexed-facility lookups by CDM. inventory_json.facilities is keyed
  // on Cerner DISPLAY names; we resolve those to mnemonics via the alias
  // table built in the facilities seed. One-shot: load all aliases into a map.
  const aliasMap = await loadAliasMap(db)
  const facilityMetadata = await loadFacilityMetadata(db)

  type CdmContext = {
    cdmCode: string
    description: string | null
    flexedMnemonics: Set<string>
  }
  const ctxByCdm = new Map<string, CdmContext>()
  for (const code of cdmCodes) {
    ctxByCdm.set(code, { cdmCode: code, description: null, flexedMnemonics: new Set() })
  }
  for (const r of cdmRows) {
    const code = r.charge_number as string
    const ctx = ctxByCdm.get(code)
    if (!ctx) continue
    if (!ctx.description) ctx.description = r.description as string
    let inv: { facilities?: Record<string, boolean> } = {}
    try { inv = JSON.parse((r.inventory_json as string) || '{}') } catch { /* ignore */ }
    for (const [name, flexed] of Object.entries(inv.facilities ?? {})) {
      if (!flexed) continue
      const mnemonic = aliasMap.get(name.toLowerCase())
      if (mnemonic) ctx.flexedMnemonics.add(mnemonic)
    }
  }

  // ─── If no TSV pasted yet, return CCL + context only ──────────────────
  if (!body.pastedTsv?.trim()) {
    const response: NdcMoveAlertResponse = {
      cclQuery,
      cdmCodes,
      cdmContext: [...ctxByCdm.values()].map(c => ({
        cdmCode: c.cdmCode,
        description: c.description,
        flexedFacilities: [...c.flexedMnemonics].sort(),
      })),
      parsedScanRows: 0,
      tier1: [],
      tier2: [],
      unresolvedFacilities: [],
    }
    return NextResponse.json(response)
  }

  // ─── Parse pasted TSV ─────────────────────────────────────────────────
  const { rows: scanRows, parseError } = parseScanTsv(body.pastedTsv)
  if (parseError) {
    return NextResponse.json({ error: `Could not parse pasted TSV: ${parseError}` }, { status: 400 })
  }

  // ─── Aggregate scans per (mnemonic, cdmCode) ──────────────────────────
  // Currently the CCL query returns barcodes, not CDM codes — but all rows
  // it returns are for the CDM list we sent (via the IN clause), so we have
  // to attribute scans across all input CDMs. Without per-row CDM tagging,
  // v1 attributes the total scan count to ALL input CDMs uniformly. When
  // multi-CDM analysis is needed, the CCL needs an extra column.
  const scansByMnemonic = new Map<string, { total: number; perDomain: Map<string, number> }>()
  const unresolved: UnresolvedFacility[] = []

  for (const r of scanRows) {
    const facLower = r.facility.toLowerCase()
    const mnemonic = aliasMap.get(facLower)
    if (!mnemonic) {
      unresolved.push({ facility: r.facility, domain: r.domain, scanCount: r.scanCount })
      continue
    }
    let agg = scansByMnemonic.get(mnemonic)
    if (!agg) {
      agg = { total: 0, perDomain: new Map() }
      scansByMnemonic.set(mnemonic, agg)
    }
    agg.total += r.scanCount
    agg.perDomain.set(r.domain, (agg.perDomain.get(r.domain) ?? 0) + r.scanCount)
  }

  // ─── Pull contacts per scanned/flexed facility in one query ───────────
  const allTargetMnemonics = new Set<string>(scansByMnemonic.keys())
  for (const ctx of ctxByCdm.values()) {
    for (const mn of ctx.flexedMnemonics) allTargetMnemonics.add(mn)
  }
  const contactsByMnemonic =
    allTargetMnemonics.size === 0
      ? new Map<string, ContactBrief[]>()
      : await loadContacts(db, [...allTargetMnemonics])

  // ─── Bucket into tiers ────────────────────────────────────────────────
  const tier1: FacilityAlert[] = []
  const tier2: FacilityAlert[] = []

  // Tier 1: scanned (any count > 0). Sorted by scan count desc.
  for (const [mnemonic, agg] of scansByMnemonic) {
    const meta = facilityMetadata.get(mnemonic)
    tier1.push({
      mnemonic,
      longName: meta?.longName ?? mnemonic,
      region: meta?.region ?? null,
      scanCount: agg.total,
      scansByCdm: {},
      contacts: contactsByMnemonic.get(mnemonic) ?? [],
    })
  }
  tier1.sort((a, b) => b.scanCount - a.scanCount)

  // Tier 2: flexed but not scanned.
  const scannedSet = new Set(scansByMnemonic.keys())
  const flexedAll = new Set<string>()
  for (const ctx of ctxByCdm.values()) for (const mn of ctx.flexedMnemonics) flexedAll.add(mn)
  for (const mnemonic of flexedAll) {
    if (scannedSet.has(mnemonic)) continue
    const meta = facilityMetadata.get(mnemonic)
    tier2.push({
      mnemonic,
      longName: meta?.longName ?? mnemonic,
      region: meta?.region ?? null,
      scanCount: 0,
      scansByCdm: {},
      contacts: contactsByMnemonic.get(mnemonic) ?? [],
    })
  }
  tier2.sort((a, b) => a.mnemonic.localeCompare(b.mnemonic))

  const response: NdcMoveAlertResponse = {
    cclQuery,
    cdmCodes,
    cdmContext: [...ctxByCdm.values()].map(c => ({
      cdmCode: c.cdmCode,
      description: c.description,
      flexedFacilities: [...c.flexedMnemonics].sort(),
    })),
    parsedScanRows: scanRows.length,
    tier1,
    tier2,
    unresolvedFacilities: unresolved,
  }
  return NextResponse.json(response)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the parameterized CCL query the user runs in Discern Explorer.
 *  curdomain self-tags each row so the user can concatenate three runs
 *  (P152E/P152C/P152W) into one paste without manually adding domain.
 *
 *  Index strategy — drive from med_identifier first (tiny IN-list resolves
 *  via the indexed mi.value), then probe cmai.item_id (also indexed). The
 *  alternative pattern of `plan cmai where cmai.item_id IN (subquery)` lets
 *  the CCL optimizer pick the cmai.valid_from_dt_tm index as the leading
 *  access path — which on a busy site means scanning every admin-scan in
 *  the lookback window across every drug, then filtering. Driving from mi
 *  keeps the working set narrow and applies the date as a row-level filter
 *  on already-narrow cmai rows. Time budget bumped to 300s to absorb
 *  larger lookbacks without timing out. */
function buildCclQuery(cdmCodes: string[], lookbackDays: number): string {
  const inList = cdmCodes.map(c => `"${c}"`).join(', ')
  return `select DOMAIN = curdomain,
       BARCODE = cmai.med_admin_barcode,
       FACILITY = uar_get_code_display(e.loc_facility_cd),
       SCAN_COUNT = count(*)
from med_identifier mi,
     ce_med_admin_ident cmai,
     ce_med_admin_ident_reltn cmair,
     clinical_event ce,
     encounter e
plan mi    where mi.value in (${inList})
join cmai  where cmai.item_id = mi.item_id
             and cmai.valid_from_dt_tm > cnvtlookbehind("${lookbackDays}D")
join cmair where cmair.ce_med_admin_ident_id = cmai.ce_med_admin_ident_id
join ce    where cmair.event_id = ce.event_id
join e     where ce.encntr_id = e.encntr_id
group by curdomain, cmai.med_admin_barcode, e.loc_facility_cd
order by curdomain, uar_get_code_display(e.loc_facility_cd), count(*) desc
with maxrec=1000, time=300`
}

/** Load all facility_aliases as a lowercased-string → mnemonic map. */
async function loadAliasMap(
  db: ReturnType<typeof getDb>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { rows } = await db.execute(
    'SELECT alias_lower, mnemonic FROM facility_aliases',
  )
  for (const r of rows) {
    map.set(r.alias_lower as string, r.mnemonic as string)
  }
  return map
}

/** Per-mnemonic metadata for tier display. */
async function loadFacilityMetadata(
  db: ReturnType<typeof getDb>,
): Promise<Map<string, { longName: string; region: string | null }>> {
  const map = new Map<string, { longName: string; region: string | null }>()
  const { rows } = await db.execute(
    'SELECT mnemonic, long_name, region FROM facilities',
  )
  for (const r of rows) {
    map.set(r.mnemonic as string, {
      longName: r.long_name as string,
      region: (r.region as string | null) ?? null,
    })
  }
  return map
}

/** Pull contacts for a list of mnemonics in one query. Returns a map keyed
 *  on mnemonic. Skips contacts with no email AND no phone (unreachable). */
async function loadContacts(
  db: ReturnType<typeof getDb>,
  mnemonics: string[],
): Promise<Map<string, ContactBrief[]>> {
  if (mnemonics.length === 0) return new Map()
  const placeholders = mnemonics.map(() => '?').join(',')
  const { rows } = await db.execute({
    sql: `SELECT mnemonic, role, name, email, phone
          FROM pharmacy_contacts
          WHERE mnemonic IN (${placeholders})
          ORDER BY mnemonic, role, name`,
    args: mnemonics,
  })
  const map = new Map<string, ContactBrief[]>()
  for (const r of rows) {
    const email = r.email as string | null
    const phone = r.phone as string | null
    if (!email && !phone) continue
    const mnemonic = r.mnemonic as string
    if (!map.has(mnemonic)) map.set(mnemonic, [])
    map.get(mnemonic)!.push({
      role: r.role as string,
      name: (r.name as string) ?? '',
      email,
      phone,
    })
  }
  return map
}

/** Parse a TSV pasted from Discern Explorer. Tolerates:
 *  - header row in any case
 *  - extra whitespace
 *  - quoted facility names (Discern uses quoted strings sometimes)
 *  - dedupes (DOMAIN, BARCODE, FACILITY) tuples, summing SCAN_COUNT
 *  - blank lines */
interface ScanRow {
  domain: string
  barcode: string
  facility: string
  scanCount: number
}

function parseScanTsv(tsv: string): { rows: ScanRow[]; parseError: string | null } {
  const lines = tsv.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) {
    return { rows: [], parseError: 'empty input' }
  }

  // First line might be a header. Detect by column 4 not being a number.
  const first = splitTabs(lines[0])
  const startIdx =
    first.length >= 4 && /domain/i.test(first[0]) && /scan/i.test(first[3]) ? 1 : 0

  const dedupe = new Map<string, ScanRow>()
  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitTabs(lines[i])
    if (cols.length < 4) continue
    const domain = cols[0]
    const barcode = cols[1].replace(/^"|"$/g, '')
    const facility = cols[2].replace(/^"|"$/g, '')
    const scanCount = Number(cols[3].replace(/[^0-9]/g, ''))
    if (!domain || !facility || !Number.isFinite(scanCount)) continue
    const key = `${domain}|${barcode}|${facility}`
    const existing = dedupe.get(key)
    if (existing) {
      existing.scanCount += scanCount
    } else {
      dedupe.set(key, { domain, barcode, facility, scanCount })
    }
  }
  return { rows: [...dedupe.values()], parseError: null }
}

function splitTabs(line: string): string[] {
  // Discern Explorer's TSV uses literal tabs. If user pasted CSV, fall back
  // to comma split (less common but handle gracefully).
  if (line.includes('\t')) return line.split('\t').map(s => s.trim())
  return line.split(',').map(s => s.trim())
}
