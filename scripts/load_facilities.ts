/**
 * Stage 1 of the facilities loader: source files → local SQLite (data/multum.db).
 *
 * Mirrors scripts/load_multum_xlsx.ts pattern — local-first, then a separate
 * push step (extending push_multum_to_turso.ts) ships to Turso. Writing
 * directly to Turso costs network round-trip per row and prevents replay
 * without re-parsing the source spreadsheets.
 *
 * Three sources, one canonical model:
 *   • UHS Pharmacy Contact Information.xlsx
 *     - "Acute Facilities (with FEDs)" sheet → ~36 hospitals + role contacts
 *     - "Acute BH Cerner Sites" sheet → BH facilities + Pharmacy Director contacts
 *
 *   • facilities.xlsx (Cerner FACILITY code-set dump)
 *     → integer code_value per (mnemonic, domain). Filtered to ACTIVE_IND=1
 *     and to rows whose DESCRIPTION starts with a known mnemonic prefix.
 *     Per (mnemonic, domain), picks the canonical row by Jaccard similarity
 *     between the description's name-portion and the contacts long_name.
 *
 *   • end_user_facility.csv (Service Desk ticket source)
 *     → naming variants like "Wellington Regional Medical Center (WRM)".
 *     Adds aliases for the alias table.
 *
 * Usage:
 *   pnpm exec tsx scripts/load_facilities.ts                   # defaults from ~/Downloads
 *   pnpm exec tsx scripts/load_facilities.ts --contacts=… --cerner=… --users=…
 *   pnpm exec tsx scripts/load_facilities.ts --db=/tmp/fac.db  # custom local file
 *
 * Idempotent: each table is wiped + reloaded inside one transaction.
 * After running this, push to Turso with `pnpm db:push:multum:turso --tables=facilities,facility_cerner_codes,facility_aliases,pharmacy_contacts`.
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
function flag(name: string, fallback: string): string {
  const a = args.find(x => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : fallback
}
const HOME = process.env.HOME ?? ''
const DB_PATH = path.resolve(flag('db',
  path.join(process.cwd(), 'data', 'multum.db')))
const CONTACTS_PATH = path.resolve(flag('contacts',
  path.join(HOME, 'Downloads', 'UHS Pharmacy Contact Information.xlsx')))
const CERNER_PATH = path.resolve(flag('cerner',
  path.join(HOME, 'Downloads', 'facilities.xlsx')))
const USERS_PATH = path.resolve(flag('users',
  path.join(HOME, 'Downloads', 'end_user_facility.csv')))

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Contacts xlsx & Cerner DESCRIPTION: "AIK - Aiken Regional…" / "WRM- Wellington…". */
const MNEMONIC_PREFIX = /^([A-Z]{2,5})\s*-\s*(.+?)\s*$/

/** Service Desk format: "Wellington Regional Medical Center (WRM)". */
const TRAILING_PARENS = /^(.+?)\s*\(([A-Z]{2,5})\)\s*$/

/** Region header row: "East Region\nCORP Regional Operations Manager: …". */
const REGION_HEADER = /^([A-Z][a-z]+)\s+Region\b/

/** Cerner FACILITY code set. */
const FACILITY_CODE_SET = 220

// ---------------------------------------------------------------------------
// Tokenization for fuzzy name match
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'of', 'a', 'at', 'and', 'for', 'in', 'medical', 'hospital',
  'center', 'centers', 'health', 'healthcare', 'regional', 'community',
])

/** Tokenize a facility name for Jaccard similarity scoring. */
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !STOPWORDS.has(t)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// ---------------------------------------------------------------------------
// 1) Read contacts xlsx
// ---------------------------------------------------------------------------

interface ContactsFacility {
  mnemonic: string
  longName: string
  region: string | null
  isAcute: boolean         // false for BH facilities
  rawString: string
}

interface ContactRow {
  mnemonic: string
  role: string             // 'pharmacy_director' / 'operations_manager' / 'clinical_manager' /
                           // 'ip_pharmacist' / 'is_director' / 'main_pharmacy_phone'
  name: string | null
  email: string | null
  phone: string | null
  rawValue: string
  sourceSheet: string
}

// ---------------------------------------------------------------------------
// Email + phone extraction helpers — deal with messy embedded formats.
// ---------------------------------------------------------------------------

/** Pull an email out of strings like "Diehl, Erich <Erich.Diehl@uhsinc.com>" or
 *  "Office:\nEmail: foo@bar.com". Returns null if no email found. */
function extractEmail(s: string | null | undefined): string | null {
  if (!s) return null
  // Outlook-style "Name <addr>" — preferred when present
  const angle = s.match(/<([^@>\s]+@[^>\s]+)>/)
  if (angle) return angle[1].trim().toLowerCase()
  // Bare email anywhere in the string
  const bare = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  return bare ? bare[0].trim().toLowerCase() : null
}

/** Pull a phone number out of "Office: (803)-641-5691\nEmail: ..." or just
 *  "(803)-641-5680" — first 7+ digit run, optionally with separators. */
function extractPhone(s: string | null | undefined): string | null {
  if (!s) return null
  // Strip "Office:" / "Email:" labels first to avoid partial-digit picks.
  const cleaned = s.replace(/Office:\s*/i, '').replace(/Email:.*$/im, '')
  const m = cleaned.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*\(?(?:x|ext)\.?\s*\d+\)?)?/i)
  return m ? m[0].trim() : null
}

interface ReadResult {
  facilities: ContactsFacility[]
  contacts: ContactRow[]
}

/** Read the "Acute Facilities (with FEDs)" sheet — facility identity + role-
 *  scoped contacts. Pharmacy Director and IS Director rows have an adjacent
 *  __EMPTY column carrying "Office: phone\nEmail: addr" — parse those. Other
 *  contact roles are name-only. */
function readAcuteSheet(wb: import('xlsx').WorkBook): ReadResult {
  const sheetName = 'Acute Facilities (with FEDs)'
  const sheet = wb.Sheets[sheetName]
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  const facilities: ContactsFacility[] = []
  const contacts: ContactRow[] = []
  let currentRegion: string | null = null

  for (const row of rows) {
    const cell = row['UHS Acute Care Pharmacy']
    if (cell == null) continue
    const cellText = String(cell).trim()
    if (!cellText) continue

    if (/^~+/.test(cellText)) continue

    const reg = REGION_HEADER.exec(cellText)
    if (reg) {
      currentRegion = reg[1]
      continue
    }

    // Multi-line cells: extract every line that matches MNEMONIC_PREFIX.
    // The first one becomes the canonical entry; later same-mnemonic lines
    // are de-duped at the facilities level but their cell may carry contacts
    // we still want, so we attribute contacts to the first mnemonic on the row.
    const lines = cellText.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    let primaryMnemonic: string | null = null
    for (const line of lines) {
      const m = MNEMONIC_PREFIX.exec(line)
      if (!m) continue
      const mnemonic = m[1].trim().toUpperCase()
      const longName = m[2].trim()
      if (!mnemonic || !longName) continue
      if (!primaryMnemonic) primaryMnemonic = mnemonic
      if (facilities.some(f => f.mnemonic === mnemonic)) {
        console.log(`  ⚠ duplicate contacts mnemonic ${mnemonic} (kept first): "${longName}"`)
        continue
      }
      facilities.push({
        mnemonic, longName, region: currentRegion, isAcute: true, rawString: line,
      })
    }
    if (!primaryMnemonic) continue

    // ---- Extract role-scoped contacts from this row ----
    // Pharmacy Director — name in main col, "Office: phone\nEmail: addr" in __EMPTY.
    pushContact(contacts, primaryMnemonic, 'pharmacy_director',
      row[' Pharmacy Director Contact'], row['__EMPTY'], sheetName)
    pushContact(contacts, primaryMnemonic, 'operations_manager',
      row['Operations Manager'], null, sheetName)
    pushContact(contacts, primaryMnemonic, 'clinical_manager',
      row['Clinical Manager'], null, sheetName)
    pushContact(contacts, primaryMnemonic, 'ip_pharmacist',
      row['Infection Prevention (IP) Pharmacist'], null, sheetName)
    pushContact(contacts, primaryMnemonic, 'is_director',
      row['IS Director Contact'], row['__EMPTY_1'], sheetName)
    // Main pharmacy line — phone-only, no person.
    if (row['Main Pharmacy Number']) {
      contacts.push({
        mnemonic: primaryMnemonic,
        role: 'main_pharmacy_phone',
        name: null,
        email: null,
        phone: extractPhone(String(row['Main Pharmacy Number'])),
        rawValue: String(row['Main Pharmacy Number']),
        sourceSheet: sheetName,
      })
    }
  }

  return { facilities, contacts }
}

/** Read the "Acute BH Cerner Sites" sheet — clean Name | Email | Phone layout
 *  in columns B/C/D. Region markers are full-row title cells in column A. */
function readBHCernerSheet(wb: import('xlsx').WorkBook): ReadResult {
  const sheetName = 'Acute BH Cerner Sites'
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    console.warn(`  ⚠ "${sheetName}" not found — skipping BH Cerner load`)
    return { facilities: [], contacts: [] }
  }
  // Use array form so we can address by column index regardless of header
  // weirdness (the sheet has no clean header row — row 0 is "East Region",
  // row 1 is the column-purpose row with embedded leading spaces).
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  const facilities: ContactsFacility[] = []
  const contacts: ContactRow[] = []
  let currentRegion: string | null = null

  for (const r of rows) {
    const a = (r[0] != null ? String(r[0]) : '').trim()
    if (!a) continue

    // Region marker: "East Region", "Central Region", "West Region".
    const reg = REGION_HEADER.exec(a)
    if (reg) {
      currentRegion = reg[1]
      continue
    }

    // Skip the duplicate header row that recurs ("UHS Behaviorial Health Pharmacy …").
    if (/UHS\s+Behaviorial?\s+Health/i.test(a)) continue

    // Multi-line / dated facility row — handle the "Texas NeuroRehab\nNIA - …"
    // case by extracting the first line that matches MNEMONIC_PREFIX.
    const lines = a.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    let primary: { mnemonic: string; longName: string; rawString: string } | null = null
    for (const line of lines) {
      const m = MNEMONIC_PREFIX.exec(line)
      if (!m) continue
      const mnemonic = m[1].toUpperCase()
      const longName = m[2].trim()
      if (!primary) primary = { mnemonic, longName, rawString: line }
      // Add to facilities if not already present.
      if (!facilities.some(f => f.mnemonic === mnemonic)) {
        facilities.push({
          mnemonic, longName, region: currentRegion, isAcute: false, rawString: line,
        })
      }
    }
    if (!primary) continue

    // Pharmacy Director — name (col 1), email (col 2), phone (col 3).
    const name = r[1] != null ? String(r[1]).trim() : null
    const emailCell = r[2] != null ? String(r[2]).trim() : null
    const phoneCell = r[3] != null ? String(r[3]).trim() : null
    if (name || emailCell || phoneCell) {
      contacts.push({
        mnemonic: primary.mnemonic,
        role: 'pharmacy_director',
        name: name || null,
        email: extractEmail(emailCell),
        phone: extractPhone(phoneCell),
        rawValue: [name, emailCell, phoneCell].filter(Boolean).join(' | '),
        sourceSheet: sheetName,
      })
    }
  }

  return { facilities, contacts }
}

/** Append a name+phone+email contact row from two adjacent cells. The "name"
 *  cell might just be a name; the "extra" cell typically holds
 *  "Office: phone\nEmail: addr". Skips rows where everything is empty. */
function pushContact(
  out: ContactRow[],
  mnemonic: string,
  role: string,
  nameCell: unknown,
  extraCell: unknown,
  sourceSheet: string,
): void {
  const name = nameCell != null ? String(nameCell).trim() : ''
  const extra = extraCell != null ? String(extraCell).trim() : ''
  // Some Acute rows have name = name + email merged ("Foo Bar foo@bar.com").
  // Pull email from either cell; phone primarily from extra.
  const email = extractEmail(name) ?? extractEmail(extra)
  const phone = extractPhone(extra) ?? extractPhone(name)
  // Strip the email out of the name if it ended up in there.
  const cleanName = email ? name.replace(email, '').replace(/[<>]/g, '').trim() : name
  if (!cleanName && !email && !phone) return
  out.push({
    mnemonic,
    role,
    name: cleanName || null,
    email,
    phone,
    rawValue: [name, extra].filter(Boolean).join(' | '),
    sourceSheet,
  })
}

// ---------------------------------------------------------------------------
// 2) Read Cerner facilities.xlsx
// ---------------------------------------------------------------------------

interface CernerRow {
  domain: string                 // EXP — 'P152E', 'P152C', 'P152W'
  codeValue: number
  display: string | null
  description: string
  mnemonic: string                // extracted from description
  namePortion: string             // text after the mnemonic prefix
  collationSeq: number | null
}

function readCernerActive(): CernerRow[] {
  console.log(`Reading Cerner: ${CERNER_PATH}`)
  const wb = XLSX.readFile(CERNER_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  const out: CernerRow[] = []
  for (const row of rows) {
    if (Number(row['ACTIVE_IND']) !== 1) continue
    if (Number(row['CODE_SET']) !== FACILITY_CODE_SET) continue
    const description = String(row['DESCRIPTION'] ?? '').trim()
    if (!description) continue
    const m = MNEMONIC_PREFIX.exec(description)
    if (!m) continue                                  // skip non-prefixed (UHS Corp, etc.)
    const mnemonic = m[1].toUpperCase()
    const namePortion = m[2].trim()
    const codeValue = Number(row['CODE_VALUE'])
    if (!Number.isFinite(codeValue)) continue
    const domain = String(row['EXP'] ?? '').trim()
    if (!domain) continue

    out.push({
      domain,
      codeValue,
      display: row['DISPLAY'] ? String(row['DISPLAY']).trim() : null,
      description,
      mnemonic,
      namePortion,
      collationSeq: row['COLLATION_SEQ'] != null ? Number(row['COLLATION_SEQ']) : null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// 3) Read end_user_facility.csv distinct facility names
// ---------------------------------------------------------------------------

function readServiceDeskFacilities(): string[] {
  console.log(`Reading service-desk: ${USERS_PATH}`)
  const raw = fs.readFileSync(USERS_PATH, 'utf8')
  // Split on \r?\n so trailing \r on each line doesn't break the regex below
  // (JS regex `.` doesn't match \r — `(.*)$` fails on a line that ends in \r).
  const lines = raw.split(/\r?\n/).slice(1).filter(Boolean)
  const set = new Set<string>()
  // Format: Incident,EndUser,Facility — EndUser is "Last, First" (quoted because
  // of the embedded comma). Try the quoted form first, fall back to unquoted.
  for (const line of lines) {
    const m = line.match(/^([^,]+),"([^"]*)",(.*)$/) || line.match(/^([^,]+),([^,]*),(.*)$/)
    if (!m) continue
    const fac = m[3].trim()
    if (fac) set.add(fac)
  }
  return [...set]
}

// ---------------------------------------------------------------------------
// 4) Pick canonical Cerner row per (mnemonic, domain)
// ---------------------------------------------------------------------------

function pickCanonical(rows: CernerRow[], contactsLongName: string): CernerRow {
  const target = tokens(contactsLongName)
  let best = rows[0]
  let bestScore = jaccard(target, tokens(best.namePortion))
  for (const r of rows.slice(1)) {
    const s = jaccard(target, tokens(r.namePortion))
    if (
      s > bestScore ||
      // tiebreaker: lower collation_seq first (Cerner's own ordering)
      (s === bestScore &&
        (r.collationSeq ?? Infinity) < (best.collationSeq ?? Infinity))
    ) {
      best = r
      bestScore = s
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 5) Main load — write to Turso
// ---------------------------------------------------------------------------

interface Unresolved {
  cernerMnemonics: string[]                            // Cerner mnemonics not in contacts
  serviceDeskNames: string[]                           // CSV facility strings that didn't match
  serviceDeskMnemonicNotFound: Array<{ name: string; mnemonic: string }>
}

function load() {
  console.log(`Reading contacts: ${CONTACTS_PATH}`)
  const wb = XLSX.readFile(CONTACTS_PATH)
  const acute = readAcuteSheet(wb)
  const bh = readBHCernerSheet(wb)

  // Merge facility lists. If the same mnemonic appears in both sheets, the
  // first one wins (acute is loaded first, which matches business priority).
  const seenMnemonics = new Set<string>()
  const facilities: ContactsFacility[] = []
  for (const f of [...acute.facilities, ...bh.facilities]) {
    if (seenMnemonics.has(f.mnemonic)) continue
    seenMnemonics.add(f.mnemonic)
    facilities.push(f)
  }
  const allContacts = [...acute.contacts, ...bh.contacts]

  const cernerAll = readCernerActive()
  const sdNames = readServiceDeskFacilities()
  console.log(`  facilities: ${facilities.length} (acute=${acute.facilities.length}, bh=${bh.facilities.length})`)
  console.log(`  contacts:   ${allContacts.length} (acute=${acute.contacts.length}, bh=${bh.contacts.length})`)
  console.log(`  cerner:     ${cernerAll.length} active mnemonic-prefixed rows`)
  console.log(`  servicedsk: ${sdNames.length} distinct facility names`)

  // Open the local SQLite file. Bulk-load PRAGMAs match the multum loader.
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  console.log(`\nTarget local DB: ${DB_PATH}`)
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('temp_store = MEMORY')
  db.pragma('foreign_keys = ON')

  // Apply DDL (idempotent — matches lib/schema.sql facility-section verbatim).
  console.log('Applying facility-table DDL…')
  db.exec(`
    CREATE TABLE IF NOT EXISTS facilities (
      mnemonic TEXT PRIMARY KEY, long_name TEXT NOT NULL, region TEXT,
      is_acute INTEGER NOT NULL DEFAULT 1, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS facility_cerner_codes (
      mnemonic TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
      domain TEXT NOT NULL, code_value INTEGER NOT NULL,
      display TEXT, description TEXT, active_ind INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (mnemonic, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_facility_cerner_code_value
      ON facility_cerner_codes(domain, code_value);
    CREATE TABLE IF NOT EXISTS facility_aliases (
      alias_lower TEXT PRIMARY KEY,
      mnemonic TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_facility_aliases_mnemonic
      ON facility_aliases(mnemonic);
    CREATE TABLE IF NOT EXISTS pharmacy_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mnemonic TEXT NOT NULL REFERENCES facilities(mnemonic) ON DELETE CASCADE,
      role TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      email TEXT,
      phone TEXT,
      notes TEXT,
      raw_value TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_sheet TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (mnemonic, role, name)
    );
    CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_mnemonic
      ON pharmacy_contacts(mnemonic);
    CREATE INDEX IF NOT EXISTS idx_pharmacy_contacts_role
      ON pharmacy_contacts(role);
  `)

  // Build a quick set of known mnemonics for lookup.
  const knownMnemonics = new Set(facilities.map(f => f.mnemonic))
  const longNameByMnemonic = new Map(facilities.map(f => [f.mnemonic, f.longName]))

  // Cerner sometimes encodes sub-units with suffixed mnemonics (AIKE/AIKB/AIKN
  // for Aiken East/Behavioral/North; GWUB/GWUE for GWU sub-units). The
  // canonical row in contacts uses the bare 3-letter prefix (AIK / GWU). When
  // the full Cerner mnemonic doesn't match contacts directly, fall back to
  // the first 3 chars. This catches the AIKE → AIK case while still letting
  // truly distinct mnemonics (NWT vs NWTE) collapse together.
  function resolveContactMnemonic(cernerMnemonic: string): string | null {
    if (knownMnemonics.has(cernerMnemonic)) return cernerMnemonic
    const head = cernerMnemonic.slice(0, 3)
    if (head !== cernerMnemonic && knownMnemonics.has(head)) return head
    return null
  }

  // ---- Group cerner rows by (resolved-mnemonic, domain) and pick canonical ----
  const grouped = new Map<string, CernerRow[]>()
  const unknownCernerMnemonics = new Set<string>()
  for (const r of cernerAll) {
    const resolved = resolveContactMnemonic(r.mnemonic)
    if (!resolved) {
      unknownCernerMnemonics.add(r.mnemonic)
      continue
    }
    r.mnemonic = resolved
    const key = `${resolved}|${r.domain}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(r)
  }

  // Pick canonical Cerner row per (mnemonic, domain) and stage aliases.
  const aliasesToAdd: Array<{ alias: string; mnemonic: string; source: string }> = []
  const cernerInserts: Array<{ mnemonic: string; row: CernerRow }> = []
  for (const [key, rows] of grouped) {
    const [mnemonic] = key.split('|')
    const longName = longNameByMnemonic.get(mnemonic) ?? mnemonic
    const chosen = pickCanonical(rows, longName)
    cernerInserts.push({ mnemonic, row: chosen })
    if (chosen.display) {
      aliasesToAdd.push({ alias: chosen.display, mnemonic, source: 'cerner_display' })
    }
    aliasesToAdd.push({ alias: chosen.description, mnemonic, source: 'cerner_description' })
    aliasesToAdd.push({ alias: chosen.namePortion, mnemonic, source: 'cerner_description' })
  }

  // ---- Resolve service-desk distinct names → aliases ----
  const aliasIndex = new Map<string, string>()
  for (const a of aliasesToAdd) aliasIndex.set(a.alias.toLowerCase(), a.mnemonic)
  for (const f of facilities) {
    aliasIndex.set(f.longName.toLowerCase(), f.mnemonic)
    aliasIndex.set(f.rawString.toLowerCase(), f.mnemonic)
  }

  const sdAliases: Array<{ alias: string; mnemonic: string; source: string }> = []
  const unresolvedSd: string[] = []
  const sdMnemonicNotFound: Array<{ name: string; mnemonic: string }> = []

  /** Resolve an extended Service Desk mnemonic (NWTHS, GWUH) to a known
   * 3-letter contacts mnemonic. Mirrors the Cerner-side fallback. */
  function resolveSdMnemonic(m: string): string | null {
    if (knownMnemonics.has(m)) return m
    if (m.length > 3 && knownMnemonics.has(m.slice(0, 3))) return m.slice(0, 3)
    return null
  }

  for (const name of sdNames) {
    const pm = TRAILING_PARENS.exec(name)
    if (pm) {
      const rawMnemonic = pm[2].toUpperCase()
      const bareName = pm[1].trim()
      const mnemonic = resolveSdMnemonic(rawMnemonic)
      if (mnemonic) {
        sdAliases.push({ alias: name,     mnemonic, source: 'service_desk_with_parens' })
        sdAliases.push({ alias: bareName, mnemonic, source: 'service_desk' })
        aliasIndex.set(name.toLowerCase(), mnemonic)
        aliasIndex.set(bareName.toLowerCase(), mnemonic)
        continue
      }
      sdMnemonicNotFound.push({ name, mnemonic: rawMnemonic })
      continue
    }
    const m2 = aliasIndex.get(name.toLowerCase())
    if (m2) {
      sdAliases.push({ alias: name, mnemonic: m2, source: 'service_desk' })
      continue
    }
    unresolvedSd.push(name)
  }

  // Dedupe aliases by alias_lower; conflict means the same lowercased string
  // maps to two different facilities — surface and keep the first.
  const finalAliases = new Map<string, { mnemonic: string; source: string }>()
  function addAlias(a: { alias: string; mnemonic: string; source: string }) {
    const key = a.alias.toLowerCase()
    if (!key) return
    const existing = finalAliases.get(key)
    if (existing && existing.mnemonic !== a.mnemonic) {
      console.warn(`  ⚠ alias "${a.alias}" → conflict: ${existing.mnemonic} vs ${a.mnemonic} (keeping ${existing.mnemonic})`)
      return
    }
    if (!existing) finalAliases.set(key, { mnemonic: a.mnemonic, source: a.source })
  }
  for (const a of aliasesToAdd) addAlias(a)
  for (const f of facilities) {
    addAlias({ alias: f.longName,  mnemonic: f.mnemonic, source: 'contacts_long_name' })
    addAlias({ alias: f.rawString, mnemonic: f.mnemonic, source: 'contacts_long_name' })
  }
  for (const a of sdAliases) addAlias(a)

  // ─── All writes go in one transaction ───
  // INSERT OR IGNORE everywhere — the xlsx is seed data only. Once a row
  // exists, the loader is a no-op for it; in-app CRUD owns the data after
  // the first successful seed. Re-running the loader against a populated
  // DB picks up only genuinely-new facilities/contacts/aliases from an
  // updated xlsx without clobbering manual edits.
  const insertFacility = db.prepare(
    'INSERT OR IGNORE INTO facilities (mnemonic, long_name, region, is_acute) VALUES (?, ?, ?, ?)'
  )
  const insertCerner = db.prepare(
    `INSERT OR IGNORE INTO facility_cerner_codes
       (mnemonic, domain, code_value, display, description, active_ind)
     VALUES (?, ?, ?, ?, ?, 1)`
  )
  const insertAlias = db.prepare(
    'INSERT OR IGNORE INTO facility_aliases (alias_lower, mnemonic, source) VALUES (?, ?, ?)'
  )
  const insertContact = db.prepare(
    `INSERT OR IGNORE INTO pharmacy_contacts
       (mnemonic, role, name, email, phone, raw_value, source, source_sheet)
     VALUES (?, ?, ?, ?, ?, ?, 'seed', ?)`
  )

  const writeAll = db.transaction(() => {
    for (const f of facilities) {
      insertFacility.run(f.mnemonic, f.longName, f.region, f.isAcute ? 1 : 0)
    }
    for (const { mnemonic, row } of cernerInserts) {
      insertCerner.run(mnemonic, row.domain, row.codeValue, row.display, row.description)
    }
    for (const [aliasLower, v] of finalAliases) {
      insertAlias.run(aliasLower, v.mnemonic, v.source)
    }
    // Skip contacts whose mnemonic isn't in facilities (FK violation guard).
    // Empty-string the name to satisfy NOT NULL when the seed has no name
    // (e.g. main_pharmacy_phone rows are phone-only).
    for (const c of allContacts) {
      if (!knownMnemonics.has(c.mnemonic)) continue
      insertContact.run(
        c.mnemonic, c.role, c.name ?? '', c.email, c.phone, c.rawValue, c.sourceSheet,
      )
    }
  })

  console.log('Writing in single transaction…')
  writeAll()

  console.log('Running ANALYZE…')
  db.exec('ANALYZE')

  // ---- Summary ----
  const unresolved: Unresolved = {
    cernerMnemonics: [...unknownCernerMnemonics].sort(),
    serviceDeskNames: unresolvedSd.sort(),
    serviceDeskMnemonicNotFound: sdMnemonicNotFound,
  }
  printSummary(facilities, allContacts, cernerInserts.length, finalAliases.size, unresolved)

  db.close()
}

function printSummary(
  facilities: ContactsFacility[],
  contacts: ContactRow[],
  cernerCount: number,
  aliasCount: number,
  unresolved: Unresolved,
) {
  console.log('\n=== Summary ===')
  console.log(`  ${facilities.length} canonical facilities loaded`)
  console.log(`  ${cernerCount} (mnemonic, domain) Cerner code rows`)
  console.log(`  ${aliasCount} aliases`)
  console.log(`  ${contacts.length} pharmacy contact rows`)

  console.log(`\nFacilities by region:`)
  const byRegion: Record<string, number> = {}
  for (const f of facilities) byRegion[f.region ?? '(none)'] = (byRegion[f.region ?? '(none)'] || 0) + 1
  for (const [r, n] of Object.entries(byRegion)) console.log(`  ${r}: ${n}`)

  console.log(`\nFacilities by type: acute=${facilities.filter(f => f.isAcute).length}, BH=${facilities.filter(f => !f.isAcute).length}`)

  console.log(`\nContacts by role:`)
  const byRole: Record<string, number> = {}
  for (const c of contacts) byRole[c.role] = (byRole[c.role] || 0) + 1
  for (const [r, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${n}`)
  }
  const withEmail = contacts.filter(c => c.email).length
  const withPhone = contacts.filter(c => c.phone).length
  console.log(`  with email: ${withEmail}, with phone: ${withPhone}`)

  if (unresolved.cernerMnemonics.length > 0) {
    console.log(`\n⚠ ${unresolved.cernerMnemonics.length} Cerner mnemonics not in contacts (informational):`)
    console.log('  ' + unresolved.cernerMnemonics.join(', '))
  }

  if (unresolved.serviceDeskMnemonicNotFound.length > 0) {
    console.log(`\n⚠ Service Desk facilities with parens-mnemonic NOT in facilities (review-worthy):`)
    for (const x of unresolved.serviceDeskMnemonicNotFound) {
      console.log(`  "${x.name}" → mnemonic ${x.mnemonic}`)
    }
  }

  if (unresolved.serviceDeskNames.length > 0) {
    console.log(`\n⚠ Service Desk facilities not auto-resolved (need manual alias):`)
    for (const n of unresolved.serviceDeskNames) console.log(`  "${n}"`)
  } else {
    console.log(`\n✓ All Service Desk facility names auto-resolved.`)
  }
}

try {
  load()
  console.log('\nDone. Next step: push to Turso via')
  console.log('  pnpm exec tsx scripts/push_multum_to_turso.ts \\')
  console.log('    --tables=facilities,facility_cerner_codes,facility_aliases,pharmacy_contacts')
} catch (err) {
  console.error(err)
  process.exit(1)
}
