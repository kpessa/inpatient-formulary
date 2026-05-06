import { createClient } from '@libsql/client';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
for (const l of env.split('\n')) { const m = l.match(/^([A-Z_]+)="?([^"]*)"?$/); if (m) process.env[m[1]]=m[2]; }
const db = createClient({ url: process.env.DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

console.log('--- count groups with multi-MMDC across all prod ---');
const t0 = Date.now();
const r = await db.execute(`
  WITH ndc_mmdc AS (
    SELECT sr.group_id, sr.domain, sr.ndc, m.mmdc
    FROM supply_records sr
    LEFT JOIN multum_ndc_combined m ON m.ndc_formatted = sr.ndc
    WHERE sr.is_active = 1
  )
  SELECT COUNT(*) AS n FROM (
    SELECT n.group_id, n.domain
    FROM ndc_mmdc n
    JOIN formulary_groups fg ON fg.group_id = n.group_id AND fg.domain = n.domain
    WHERE fg.environment = 'prod' AND n.mmdc IS NOT NULL
    GROUP BY n.group_id, n.domain
    HAVING COUNT(DISTINCT n.mmdc) >= 2
  )
`);
console.log(`${r.rows[0].n} groups in ${Date.now()-t0}ms`);

console.log('\n--- top 5 by MMDC count ---');
const r2 = await db.execute(`
  WITH ndc_mmdc AS (
    SELECT sr.group_id, sr.domain, sr.ndc, m.mmdc, m.generic_name, m.strength_description, m.dose_form_description
    FROM supply_records sr
    LEFT JOIN multum_ndc_combined m ON m.ndc_formatted = sr.ndc
    WHERE sr.is_active = 1
  )
  SELECT
    fg.charge_number, fg.description, fg.domain,
    COUNT(DISTINCT n.mmdc) AS mmdc_count,
    COUNT(DISTINCT n.ndc) AS ndc_count
  FROM ndc_mmdc n
  JOIN formulary_groups fg ON fg.group_id = n.group_id AND fg.domain = n.domain
  WHERE fg.environment = 'prod' AND n.mmdc IS NOT NULL
  GROUP BY fg.group_id, fg.domain
  HAVING mmdc_count >= 2
  ORDER BY mmdc_count DESC, ndc_count DESC
  LIMIT 5
`);
for (const row of r2.rows) {
  console.log(`  ${row.domain.padEnd(13)} cdm=${row.charge_number} mmdcs=${row.mmdc_count} ndcs=${row.ndc_count} ${String(row.description).slice(0,55)}`);
}
