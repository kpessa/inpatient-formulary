# Order-Sentence Integration Plan

**Status:** Draft for review
**Scope:** Integrate `order-sentence` functionality into `inpatient_formulary` so that pharmacists reviewing a product see its related Cerner order sentences, with dosage-form mismatch detection and a structured workflow for keeping product ↔ order sentences ↔ Pyxis ↔ Omnicell in sync.

---

## 1. The workflow we're building toward

When a pharmacist opens a product in the formulary app, they should be able to:

1. See the related Cerner order sentences for that drug, with their parsed dosage forms, doses, routes, and frequencies displayed cleanly.
2. Immediately spot where the product's dosage form and the order-sentence dosage forms disagree — since that mismatch is what breaks Cerner's auto-product-assign.
3. When editing the product's dosage form, be guided through the downstream changes: which order sentences need updating, plus the ADC-side edits (3 Pyxis domains + 1 Omnicell server).

The first two are pure visibility. The third is a workflow layer on top of the task/override system that already exists in the formulary app.

---

## 2. Recommendation on integration shape — port features in

**Recommendation: port the order-sentence features into the formulary app. Retire the separate order-sentence app over time.**

I considered three shapes and am rejecting the other two:

**Shared library.** Extract parsing + API clients into a package both apps consume. This is the "correct" answer on paper, but it's overkill for a two-app situation where one app (inpatient_formulary) is clearly evolving into the primary tool. A shared package means maintaining a third repo/publish pipeline, and the actual shared surface is small — a parser and three API clients. The cost of the package boilerplate exceeds the duplication cost.

**Iframe/embed.** Keeps order-sentence running as its own app; formulary links to it. Fastest to stand up, but it defeats the whole point: the integration's value is joining order sentences to specific products, which requires shared data, not side-by-side views.

**Why porting wins:**

- The formulary app is culturally simpler (no Redux, no HTTP client wrapper, local state). Most of the order-sentence Redux surface is boilerplate around pure functions — we can leave the boilerplate behind and bring in the pure pieces.
- The formulary app already uses Turso; order sentences belong in a table there, not in a static `/public/Inpatient_Pharmacy_Reference_Build.xlsx` file. One source of truth.
- Both apps are Tailwind v4 / React 19. No version conflicts. Next.js 15.3.2 → 16 is a minor bump for any code we bring over.
- Consolidating reduces the surface area of tools pharmacists have to switch between.

**What actually gets ported (in priority order):**

1. `src/lib/utils/parseOrderSentence.ts` — pure function, copy verbatim.
2. `src/lib/config/api.ts` + the RxNorm/OpenFDA/DailyMed fetch calls — extract from Redux thunks into plain async functions.
3. `src/components/organisms/ExcelOrderSentenceTable.tsx` — adapt to read from Turso instead of Redux. TanStack Table v8 fits fine alongside the existing shadcn UI.
4. The Excel parsing logic, but decoupled from `fetchExcelData()` so it takes a buffer argument — used only for one-time ingestion into Turso, not for runtime data.

**What does NOT get ported:**

- Redux Toolkit + Redux Persist. The formulary app has deliberately avoided global state. Keep it that way.
- The static Excel-as-source-of-truth pattern. Order sentences live in Turso.
- The standalone `/excel-viewer/` and `/drug-details/` pages. Their functionality gets absorbed into the formulary app's product view.

---

## 3. Data model changes

A new `order_sentences` table in Turso. First pass at shape:

| Column | Notes |
|---|---|
| `id` | primary key |
| `group_id` | FK-ish to `formulary_groups.group_id`, nullable initially |
| `rxcui` | RxNorm concept ID, for secondary joins when `group_id` isn't mapped |
| `drug_name` | raw drug name from Cerner extract |
| `original_sentence` | raw Cerner order sentence string |
| `dose` | parsed |
| `dose_uom` | parsed |
| `route` | parsed |
| `dose_form` | parsed — **this is the mismatch field** |
| `frequency` | parsed |
| `prn` | parsed bool |
| `prn_reason` | parsed |
| `order_type` | if present in source |
| `source_file` | provenance — which Excel extract this came from |
| `imported_at` | timestamp |

Indexes on `group_id`, `rxcui`, and `dose_form` (the last one for mismatch queries).

The join to a product is primarily by `group_id`. For unmapped order sentences, we fall back to `rxcui`, and show them in a "needs mapping" state. This gives us a path for incremental mapping without blocking the whole feature.

**Ingestion:** A one-time script (`scripts/import_order_sentences.ts`) that parses the Cerner extract with the ported Excel logic, runs `parseOrderSentence()` on each row, and inserts into Turso. Re-runnable on each new extract.

---

## 4. UI changes

**New tab: "Order Sentences"** in the tab bar in `app/page.tsx` — slots in alongside the existing eight tabs (OE Defaults, Dispense, Inventory, Clinical, Supply, Identifiers, TPN Details, Change Log). The tab architecture is already a clean conditional render; adding one more follows the existing pattern exactly.

**New component: `components/formulary/OrderSentencesTab.tsx`** — the panel shown inside that tab. Responsibilities:

- Fetch related order sentences for `selectedItem.groupId` from a new `/api/order-sentences/[groupId]` route.
- Render them as a table (can lean on the adapted `ExcelOrderSentenceTable`).
- **Highlight dosage-form mismatches prominently.** A row where `order_sentence.dose_form !== product.dosage_form` is flagged with the same treatment already used for `FieldDiffTooltip` / domain diffs in `FormularyHeader.tsx`. Reuse, don't reinvent.
- Show a summary banner at the top: "12 order sentences · 3 with dosage-form mismatches."

**Product header treatment.** No changes needed in `FormularyHeader.tsx` for v1 — dosage form stays read-only, edits continue to flow through the task system.

---

## 5. Dosage-form mirroring workflow — recommendation

**Recommendation: Visibility + edit checklist (not full automation).**

Full automation requires writable APIs into Pyxis and Omnicell, which almost certainly don't exist in a form we can use from a web app. Visibility-only is too weak — it shows the mismatch but leaves the pharmacist to track the downstream changes mentally, which is exactly the error mode we're trying to eliminate.

The checklist is the right middle ground, and it lands *perfectly* on top of the existing task/override architecture. Here's how:

**A major finding from verifying the schema:** the `task_domain_progress` table already exists and models per-domain status on a task (`task_id`, `domain`, `status`, `completed_at`, `completed_by`, `notes`). That is almost exactly the checklist pattern. We're extending a real mechanism, not inventing one.

**When a pharmacist initiates a dosage-form change on a product:**

1. The existing task-creation dialog opens (`TaskCreateDialog`). A task created for the `dosageForm` field is already a first-class concept (`change_tasks.field_name` exists in the schema).
2. The task automatically populates `task_domain_progress` rows for every ADC target:
   - One row per Pyxis domain (3 rows) — this already matches how `task_domain_progress` is used today.
   - One row for Omnicell — a new domain value, e.g. `"omnicell-shared"`, so the same table covers it.
   - Optionally one row per related order sentence, keyed as `"order-sentence:<id>"` — or, cleaner, a parallel `task_order_sentence_progress` table if we want to keep order-sentence items structurally separate from ADC domains. Recommended: keep them separate, because the workflows differ (ADC is "change in system X"; order sentence is "verify or edit in Cerner").
3. The task cannot move to `done` until every progress row is `done`.
4. The "Order Sentences" tab reflects the progress — a row that's been acknowledged is styled differently from one that's still open.

**Implementation cost drops significantly because of this finding.** What I originally scoped as "schema migration + new sub-item UI + new completion logic" is really "add Omnicell as a domain value, add one small table for order-sentence progress, extend the existing task-completion UI."

**Why this is better than it sounds:**

- It uses the infrastructure you already have (`change_tasks`, `field_overrides`, the task panel). No new workflow engine.
- It produces an audit trail — every dosage-form change has a visible record of whether all downstream systems were touched.
- It's honest about where automation isn't feasible: the pharmacist still clicks in Pyxis and Omnicell, but the checklist ensures they don't forget.
- It composes with future automation — if you ever get write APIs into an ADC, individual checklist items can be auto-checked by integrations. The UX stays the same.

**Future enhancement (post-v1):**

- Parse an exported Pyxis/Omnicell state file once a day, auto-check ADC items that already match. Reduces the pharmacist's manual-verification load.
- Surface "unacknowledged mismatches older than X days" as a dashboard widget — the thing that keeps this from silently rotting.

---

## 6. Phased rollout

**Phase 1 — Read-only visibility (the quickest real win).**

- `order_sentences` table in Turso.
- `scripts/import_order_sentences.ts` with ported parser.
- `/api/order-sentences/[groupId]` route.
- New `OrderSentencesTab` rendering the table.
- Mismatch highlighting using the existing diff visual vocabulary.

This alone would solve most of the "did I miss a mismatch?" pain, and it ships without any workflow changes.

**Phase 2 — Dosage-form edit checklist.**

- Reuse the existing `task_domain_progress` table. Add `"omnicell-shared"` as a recognized domain value alongside the three Pyxis domains.
- Add a small `task_order_sentence_progress` table (parallel to `task_domain_progress`) to track per-order-sentence acknowledgment.
- Extend `TaskCreateDialog` so that when `field_name === 'dosageForm'`, it auto-populates progress rows for all target ADCs and all related order sentences.
- Extend the task-panel UI to render the progress rows as checkboxes, and gate task `done` status on all rows being `done`.
- Wire "acknowledged" state back into `OrderSentencesTab`.

**Phase 3 — ADC state ingestion (optional).**

- Periodic import of Pyxis / Omnicell state (from exports, probably CSV).
- Auto-check matching checklist items.
- Dashboard of stale mismatches.

**Phase 4 — Retire order-sentence app.**

- Move the residual features (drug search + DailyMed drill-down) into the formulary app as a sidebar or a new tab.
- Archive the order-sentence repo.

---

## 7. Open questions

1. **How are order sentences mapped to formulary groups today?** Does each Cerner order sentence already carry a `groupId` we can use, or do we need a mapping step (name/RxCUI-based)? This affects Phase 1 scope.
2. **Are the three Pyxis domains in the formulary schema the same three Pyxis domains?** `formulary_groups.domain` and `task_domain_progress.domain` clearly support multi-domain work, and the three-domain count matches. Need to confirm these are literally the Pyxis domains (not, say, the Cerner environments: prod / test / dev). This distinction changes whether the Pyxis mirroring is already partially modeled or whether we're adding a new axis.
3. **Who besides Kurt will use this?** Affects whether the checklist needs role-based permissions or just audit-log-level visibility.
4. **Ingest cadence.** Is the Cerner extract a nightly drop, weekly, on-demand? Drives whether `import_order_sentences.ts` is a script, a cron, or a UI button.
5. **DailyMed / OpenFDA surface.** Is the drug-detail view from order-sentence needed inside the formulary app, or is the order-sentence table alone sufficient for v1? I've scoped the plan assuming *table only* — DailyMed drill-down deferred.

---

## 8. Risks and things to watch

- **Data gap between Cerner extract and current product state.** The Cerner C152E extract and the Cerner order-sentence list may drift. The feature is only as good as the freshness of both.
- **Mapping unmapped order sentences.** Order sentences that don't join cleanly to a product (no `groupId`, ambiguous `rxcui`) need a UI. Easy to deprioritize, easy to regret deprioritizing.
- **Task-system complexity creep.** Adding sub-items to `change_tasks` is not free — it's the kind of extension that can accumulate one-off fields. Consider a generic `task_checklist_items` table rather than stuffing JSON into `change_tasks.metadata`.
- **Excel-to-Turso ingestion is a new category of source of truth.** Document the import in a README next to the script, and log every import to `change_tasks` (or an equivalent audit table) so we know what data landed when.
