/**
 * One-time seed: inserts the "Half-Tab Standard" design pattern into Turso.
 *
 * Usage:
 *   npx tsx scripts/seed_half_tab_pattern.ts
 */

import { createClient } from '@libsql/client'
import path from 'path'
import fs from 'fs'

if (!process.env.DATABASE_URL) {
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/)
      if (m) process.env[m[1]] = m[2]
    }
  }
}

const db = createClient({
  url: process.env.DATABASE_URL ?? '',
  authToken: process.env.TURSO_AUTH_TOKEN,
})

async function seed() {
  console.log('Seeding Half-Tab Standard design pattern…')

  const patternId = crypto.randomUUID()
  const scopeValue = JSON.stringify({ field: 'description', operator: 'matches_regex', value: 'half|1\\/2' })

  await db.batch([
    {
      sql: `INSERT INTO design_patterns (id, name, description, color, scope_type, scope_value)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        patternId,
        'Half-Tab Standard',
        'Naming conventions for half-tablet drugs split from a reference product',
        '#F97316',
        'rule',
        scopeValue,
      ],
    },
    {
      sql: `INSERT INTO pattern_field_rules (id, pattern_id, field, operator, value, expected_display)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        patternId,
        'description',
        'matches_regex',
        '^.+? \\d+\\.?\\d* \\S+ \\(Half of \\d+\\.?\\d* \\S+ Tab\\)$',
        '<generic_name> <strength> <uom> (Half of <whole_strength> <uom> Tab)',
      ],
    },
    {
      sql: `INSERT INTO pattern_field_rules (id, pattern_id, field, operator, value, expected_display)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        patternId,
        'mnemonic',
        'matches_regex',
        '^[a-z]+\\d+\\.?\\d*htab$',
        '<prefix><half_strength>HTab (same alphabetic prefix as reference drug)',
      ],
    },
    {
      sql: `INSERT INTO pattern_field_rules (id, pattern_id, field, operator, value, expected_display)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        patternId,
        'dosageForm',
        'equals',
        'Tab',
        'dosage form must be Tab',
      ],
    },
  ])

  console.log(`Done. Pattern ID: ${patternId}`)
}

seed().catch(err => { console.error(err); process.exit(1) })
