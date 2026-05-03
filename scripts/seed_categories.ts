/**
 * Seed drug-category groupings into the live Turso DB. Idempotent — skips
 * categories and rules that already exist by id. Writes to the
 * `drug_categories` + `category_rules` tables (Category Manager's home),
 * not `design_patterns` (which is Pattern Manager's home, intended for
 * build-pattern *linter* rules — different purpose).
 *
 * Replaces scripts/seed_patterns.ts for the categorization use case. See
 * memory/project_drug_categorization.md for the broader vision and seed list.
 *
 * Also performs a one-time cleanup: removes any `cat-*` entries from
 * design_patterns / pattern_field_rules that were seeded there during the
 * May 3 2026 prototype before we settled on Category Manager as the right
 * home. Existing user-created Pattern Manager entries are left alone.
 *
 * Usage:
 *   pnpm tsx scripts/seed_categories.ts
 */

import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'

interface CategorySeed {
  id: string
  name: string
  description: string
  color: string
  rules: { id: string; field: string; operator: string; value: string; negated?: boolean }[]
}

const SEEDS: CategorySeed[] = [
  {
    id: 'cat-half-tab',
    name: 'Half-tab',
    description: 'BH dosing split — non-reference custom build (e.g. "atorvastatin 5 mg (Half of 10 mg Tab)"). Rule matches the parenthesized "(Half of " marker in description.',
    color: '#F97316',
    rules: [
      { id: 'cat-half-tab-r1', field: 'description', operator: 'contains', value: '(Half of ' },
    ],
  },
  {
    id: 'cat-cns-stimulants',
    name: 'CNS Stimulants',
    // Therapeutic class is stored as a numeric code in formulary_groups.
    // Code 71 = "CNS stimulants" per lib/therapeutic-class-map.ts.
    // Includes amphetamines, methylphenidate variants, modafinil/armodafinil, etc.
    description: 'Drugs in the CNS stimulants therapeutic class (TC code 71). Includes amphetamines, methylphenidate variants, modafinil/armodafinil, etc.',
    color: '#3B82F6',
    rules: [
      { id: 'cat-cns-stimulants-r1', field: 'therapeuticClass', operator: 'equals', value: '71' },
    ],
  },
  {
    id: 'cat-birth-controls',
    name: 'Birth Controls',
    // Code 102 = "contraceptives" per lib/therapeutic-class-map.ts (child of
    // sex hormones, code 101). Includes oral combined/progestin-only pills,
    // emergency contraceptives, IUD/implant levonorgestrel, etc.
    description: 'Drugs in the contraceptives therapeutic class (TC code 102). Includes oral combined/progestin-only pills, emergency contraceptives, levonorgestrel IUDs/implants, etc.',
    color: '#EC4899',
    rules: [
      { id: 'cat-birth-controls-r1', field: 'therapeuticClass', operator: 'equals', value: '102' },
    ],
  },
  {
    id: 'cat-antipsychotics',
    name: 'Antipsychotics',
    // TC 251 (parent) + descendants: 77 misc, 210 phenothiazine, 280
    // thioxanthenes, 341 atypical. Note: tcDescendants() excludes the
    // parent code itself, so we list it explicitly.
    description: 'Antipsychotic agents (TC 251 + sub-classes: miscellaneous, phenothiazine, thioxanthene, atypical).',
    color: '#8B5CF6',
    rules: [
      { id: 'cat-antipsychotics-r1', field: 'therapeuticClass', operator: 'in', value: '251,77,210,280,341' },
    ],
  },
  {
    id: 'cat-anticonvulsants',
    name: 'Anticonvulsants',
    // TC 64 (parent) + 14 sub-classes (hydantoin, succinimide, barbiturate,
    // benzodiazepine, dibenzazepine, fatty acid, GABA, triazine, carbamate,
    // pyrrolidine, carbonic anhydrase, urea, AMPA antagonists, misc).
    description: 'Anticonvulsants / antiepileptics (TC 64 + 14 sub-classes). Benzodiazepine anticonvulsants (TC 203) match here AND under the Benzodiazepines category — drugs like clonazepam show up in both.',
    color: '#22C55E',
    rules: [
      { id: 'cat-anticonvulsants-r1', field: 'therapeuticClass', operator: 'in', value: '64,199,200,201,203,204,311,345,346,347,348,349,350,351,456' },
    ],
  },
  {
    id: 'cat-antidepressants',
    name: 'Antidepressants',
    // TC 249 (parent) + descendants: 76 misc, 208 SSRI, 209 tricyclic,
    // 250 MAOI, 306 phenylpiperazine, 307 tetracyclic, 308 SSNRI.
    description: 'Antidepressants (TC 249 + sub-classes: miscellaneous, SSRI, tricyclic, MAOI, phenylpiperazine, tetracyclic, SSNRI).',
    color: '#14B8A6',
    rules: [
      { id: 'cat-antidepressants-r1', field: 'therapeuticClass', operator: 'in', value: '249,76,208,209,250,306,307,308' },
    ],
  },
  {
    id: 'cat-benzodiazepines',
    name: 'Benzodiazepines',
    // TC 69 = benzodiazepines (anxiolytic class). Also includes 203 =
    // benzodiazepine anticonvulsants so clonazepam / diazepam-as-AED show
    // up here too. They'll also appear under Anticonvulsants — that's the
    // intended overlap.
    description: 'Benzodiazepine class — primarily anxiolytic (TC 69) plus the anticonvulsant subset (TC 203). Drugs in TC 203 will appear in both this and the Anticonvulsants category.',
    color: '#EAB308',
    rules: [
      { id: 'cat-benzodiazepines-r1', field: 'therapeuticClass', operator: 'in', value: '69,203' },
    ],
  },
  {
    id: 'cat-otc',
    name: 'OTC',
    // Matches drugs with legal_status = "OTC" (over-the-counter).
    // Other legal_status values seen in the data: 'Rx' (prescription),
    // controlled-substance schedule codes (CII / CIII / CIV / CV), etc.
    description: 'Over-the-counter products (legal_status = "OTC"). Distinct from Rx and controlled-substance products.',
    color: '#0EA5E9',
    rules: [
      { id: 'cat-otc-r1', field: 'legalStatus', operator: 'equals', value: 'OTC' },
    ],
  },
  {
    id: 'cat-topical',
    name: 'Topical',
    // Matches drugs whose route is "Topical" — skin-applied creams, ointments,
    // gels, lotions, patches, etc. Distinct from SubCutaneous (injection
    // under skin), Rectal, Nasal, Vaginal — those have their own route values.
    description: 'Topical (skin-applied) products. route = "Topical". Excludes SubCutaneous, Rectal, Nasal, Vaginal which are stored as distinct route values.',
    color: '#92400E',
    rules: [
      { id: 'cat-topical-r1', field: 'route', operator: 'equals', value: 'Topical' },
    ],
  },
]

function loadEnv(): { url: string; token: string } {
  const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const url = env.match(/DATABASE_URL="([^"]+)"/)?.[1]
  const token = env.match(/TURSO_AUTH_TOKEN="([^"]+)"/)?.[1]
  if (!url || !token) throw new Error('DATABASE_URL or TURSO_AUTH_TOKEN missing from .env.local')
  return { url, token }
}

async function main() {
  const env = loadEnv()
  const db = createClient({ url: env.url, authToken: env.token })

  // ── Cleanup: remove cat-* entries from Pattern Manager (legacy mistake) ──
  // Doesn't touch user-created Pattern Manager rows like 'Half-Tab Standard'
  // — just the cat-prefixed ones from the May 3 prototype seeding.
  const oldRules = await db.execute({ sql: `DELETE FROM pattern_field_rules WHERE pattern_id LIKE 'cat-%'`, args: [] })
  const oldPatterns = await db.execute({ sql: `DELETE FROM design_patterns WHERE id LIKE 'cat-%'`, args: [] })
  if ((oldPatterns.rowsAffected ?? 0) > 0) {
    console.log(`▸ Cleaned up legacy: removed ${oldPatterns.rowsAffected} pattern${oldPatterns.rowsAffected === 1 ? '' : 's'} + ${oldRules.rowsAffected} rule${oldRules.rowsAffected === 1 ? '' : 's'} from Pattern Manager`)
  }

  console.log(`▶ Seeding ${SEEDS.length} categor${SEEDS.length === 1 ? 'y' : 'ies'} into Category Manager`)

  for (const seed of SEEDS) {
    const existing = await db.execute({ sql: 'SELECT id FROM drug_categories WHERE id = ?', args: [seed.id] })
    if (existing.rows.length) {
      console.log(`  ↻ skip (already exists): ${seed.id} — ${seed.name}`)
      continue
    }

    await db.execute({
      sql: `INSERT INTO drug_categories (id, name, description, color) VALUES (?, ?, ?, ?)`,
      args: [seed.id, seed.name, seed.description, seed.color],
    })
    for (const r of seed.rules) {
      await db.execute({
        sql: `INSERT INTO category_rules (id, category_id, field, operator, value, negated) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [r.id, seed.id, r.field, r.operator, r.value, r.negated ? 1 : 0],
      })
    }
    console.log(`  ✓ seeded ${seed.id} — ${seed.name} (${seed.rules.length} rule${seed.rules.length === 1 ? '' : 's'})`)
  }

  // Sanity check
  const all = await db.execute('SELECT id, name FROM drug_categories ORDER BY name')
  console.log(`\nDrug categories now in DB:`)
  for (const r of all.rows) console.log(`  ${r.id}  —  ${r.name}`)
  db.close()
}

main().catch(err => { console.error(err); process.exit(1) })
