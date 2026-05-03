/**
 * Formulary Diagnosis Scanner — state classifier.
 *
 * Pure function: takes a `FacilityNdcLookup` (from `lib/db.ts`) and emits one
 * of the diagnosis states described in the wiki's "Formulary Diagnosis Scanner"
 * project page:
 *
 *   A      — Already built AND flexed at this facility (no action)
 *   B      — Built in this facility's domain but not flexed here (flex request)
 *   B'     — Built in some other Cerner domain only (build-in-this-domain-then-flex)
 *   C      — Stacking candidate exists (Phase 1.5 — needs similar-generic search)
 *   D      — Master CDM exists, no Cerner build anywhere (build-from-master)
 *   E      — Nothing exists (full new CDM lifecycle)
 *
 * Phase 1 emits A / B / B' / D / E. State C requires a similar-generic search
 * with Multum Drug Formulation match — both deferred (the Multum Drug
 * Formulation column isn't in Turso yet per the wiki). When we emit D, we set
 * `unverifiedStateC: true` to flag that a stacking candidate may exist; the UI
 * can render that as a "rule out stacking before building" hint.
 *
 * No I/O here. All decisions are deterministic from the input lookup. Test by
 * constructing fixture lookups — see `outputs/verify_diagnosis.mjs`.
 */

import type { FacilityNdcLookup, FacilityBuild, StackProbeResult } from './db'

export type DiagnosisState = 'A' | 'B' | 'B-prime' | 'C' | 'D' | 'E'

export type DiagnosisColor = 'green' | 'yellow' | 'orange' | 'blue' | 'red'

export interface DiagnosisEvidence {
  /**
   * Resolved Cerner domain when scope collapses to one domain (single facility,
   * or multiple facilities all in the same domain). `null` when no facility
   * was selected, the facility wasn't recognized, or the user picked across
   * domains. See `facilityDomains` for the full set.
   */
  facilityDomain: string | null
  /**
   * All distinct Cerner domains the selected facilities resolve to. Empty in
   * no-scope mode. The diagnosis treats any build whose domain ∈ this set as
   * in-scope; the rest are "other domains."
   */
  facilityDomains: string[]
  /** Builds whose `domain` is one of `facilityDomains`. Empty if no in-domain build. */
  buildsInDomain: FacilityBuild[]
  /** Builds whose `domain` is not in `facilityDomains`. Empty if no out-of-domain build. */
  buildsInOtherDomains: FacilityBuild[]
  /** Whether the NDC is in the Multum master CDM extract. */
  multumPresent: boolean
  /** State A only: the in-domain build flexed to the requested facility. */
  flexedBuild: FacilityBuild | null
  /** State B only: an in-domain build that is NOT flexed to the requested facility. */
  unflexedBuild: FacilityBuild | null
  /** State B' only: an example build in another domain (basis of the multi-domain build request). */
  sourceBuild: FacilityBuild | null
  /** Stacking probe result. `null` if probe didn't run (builds existed) or mltm tables not loaded. */
  stackProbe: StackProbeResult | null
}

export interface Diagnosis {
  state: DiagnosisState
  /** Short title for the badge, e.g. "Flex needed". */
  label: string
  /** Color slot for the badge. Maps to the wiki emoji color scheme. */
  color: DiagnosisColor
  /** Emoji from the wiki spec. */
  emoji: string
  /** One-line plain-language description of the state. */
  short: string
  /** Longer description suitable for a tooltip / detail card. */
  description: string
  /** What action the facility / pharmacist should take next. */
  action: string
  /** Data that produced this state. */
  evidence: DiagnosisEvidence
  /**
   * True when the classifier emitted state D but a stacking candidate (state C)
   * cannot yet be ruled out. Phase 1.5 work — when similar-generic search and
   * Multum Drug Formulation matching land, this flag goes away. The UI can
   * render this as "Before building from master, verify no stack candidate exists".
   */
  unverifiedStateC: boolean
  /** True when `facilityDomain` is null — the requested facility wasn't recognized. UI uses this to handle scope-gate / messaging. */
  facilityUnknown: boolean
}

/** Static metadata per state. Centralized so the UI can render badges without each component re-inventing colors. */
const STATE_META: Record<DiagnosisState, Pick<Diagnosis, 'label' | 'color' | 'emoji' | 'short' | 'action'>> = {
  A: {
    label: 'Already built',
    color: 'green',
    emoji: '✅',
    short: 'Already built and flexed at this facility',
    action: 'No action needed.',
  },
  B: {
    label: 'Flex needed',
    color: 'yellow',
    emoji: '🟡',
    short: 'Built in this facility’s domain, but not flexed here',
    action: 'Submit a flex request to corporate.',
  },
  'B-prime': {
    label: 'Multi-domain build',
    color: 'orange',
    emoji: '🟠',
    short: 'Built in another Cerner domain — needs build in this domain first',
    action: 'Submit a multi-domain build request (build in this domain, then flex).',
  },
  C: {
    label: 'Stack onto existing',
    color: 'orange',
    emoji: '🟠',
    short: 'A similar build exists — candidate for stacking this NDC',
    action: 'Submit a stacking request linking the NDC to the existing build.',
  },
  D: {
    label: 'Build from master',
    color: 'blue',
    emoji: '🔵',
    short: 'Master CDM exists, no Cerner build yet',
    action: 'Submit a build request referencing the master CDM number.',
  },
  E: {
    label: 'Full new CDM',
    color: 'red',
    emoji: '🔴',
    short: 'No build, no master — full new-product lifecycle',
    action: 'Submit a full new-product request: charge number + Med ID + P&T review + JW/JZ identification.',
  },
}

function describe(state: DiagnosisState, evidence: DiagnosisEvidence): string {
  switch (state) {
    case 'A': {
      const b = evidence.flexedBuild
      if (b) {
        return `Build group ${b.groupId} (Pyxis ${b.pyxisId || '—'}) is active in ${b.domain} and flexed to this facility along with ${b.flexedFacilities.length - 1} other${b.flexedFacilities.length === 2 ? '' : 's'}.`
      }
      // No-scope variant: builds exist but no facility-specific check ran.
      // Pull from buildsInDomain (which contains all builds in no-scope mode).
      const all = evidence.buildsInDomain
      if (all.length > 0) {
        const domains = Array.from(new Set(all.map((x) => x.domain))).sort()
        const example = all[0]
        const domainPhrase =
          domains.length === 1
            ? domains[0]
            : `${domains.length} domains (${domains.join(', ')})`
        return `Stacked in ${domainPhrase} — group ${example.groupId}, Pyxis ${example.pyxisId || '—'}, CDM ${example.chargeNumber || '—'}. No facility-specific flex check was performed (no scope).`
      }
      return 'Already built and flexed at this facility.'
    }
    case 'B': {
      const b = evidence.unflexedBuild
      return b
        ? `Build group ${b.groupId} (Pyxis ${b.pyxisId || '—'}) exists in ${b.domain} and is flexed to ${b.flexedFacilities.length} other facilit${b.flexedFacilities.length === 1 ? 'y' : 'ies'} in this domain, but not yet to this one.`
        : 'Built in this domain but not flexed to this facility.'
    }
    case 'B-prime': {
      const b = evidence.sourceBuild
      const others = evidence.buildsInOtherDomains.length
      return b
        ? `Built in ${others === 1 ? 'one other domain' : `${others} other domains`} (e.g. ${b.domain}, group ${b.groupId}). Corporate will need to build in this domain first, then flex.`
        : 'Built only in other Cerner domains.'
    }
    case 'C': {
      const sp = evidence.stackProbe
      if (sp && sp.status === 'match' && sp.candidates.length > 0) {
        const c = sp.candidates[0]
        const more = sp.candidates.length > 1 ? ` (and ${sp.candidates.length - 1} other)` : ''
        const formul = sp.formulationName ?? `MMDC ${sp.mmdc}`
        return `Existing build at this facility shares the same Multum drug code (${formul}). Stack the NDC onto group ${c.groupId}${c.chargeNumber ? ` / CDM ${c.chargeNumber}` : ''}${more} instead of creating a new build.`
      }
      return 'A similar generic build exists in this domain. Stack the NDC onto that build instead of creating a new one.'
    }
    case 'D':
      return evidence.multumPresent
        ? 'NDC is in the Multum master CDM extract but no Cerner build references it. Build using the existing master CDM number — no new charge number needed.'
        : 'Master CDM presence not verified.'
    case 'E':
      return 'No Cerner build, no Multum master entry. Full new-CDM lifecycle: Pharmacy Ops triage → Clinical Pharmacy Workgroup → charge number + Med ID + JW/JZ identification + P&T review.'
  }
}

/**
 * Classify an NDC + facility into one of the diagnosis states.
 *
 * Decision order (first match wins):
 *   A  — any in-domain build with `flexedAtRequestedFacility`
 *   B  — any in-domain build (without flex)
 *   B' — any out-of-domain build (no in-domain build)
 *   C  — no builds, but the MMDC stacking probe found a same-formulation build
 *        in this facility's domain (`lookup.stackProbe.status === 'match'`)
 *   D  — no builds anywhere, no stack candidate, Multum master present
 *   E  — no builds anywhere, no stack candidate, no Multum master
 *
 * State C is now live (not deferred). The probe runs in `lookupNdcForFacility`
 * when `builds.length === 0` and populates `lookup.stackProbe`. A `match`
 * status means at least one build at this facility's domain shares the
 * scanned NDC's MAIN_MULTUM_DRUG_CODE — the canonical Cerner stacking key.
 *
 * `unverifiedStateC` is now reserved for the rare path where the probe
 * didn't run or returned `not_in_extract` while we landed in D — i.e. we
 * can't rule stacking out, but Multum doesn't know enough to confirm it.
 */
export function diagnose(lookup: FacilityNdcLookup): Diagnosis {
  const { facilityDomain, facilityDomains, builds, multumMaster, stackProbe } = lookup

  // No-scope mode: the user picked "All facilities" (empty selection) OR
  // none of the selected facilities mapped to a known domain. In both cases
  // we can't make in-domain / out-of-domain claims, so treat all builds as
  // "in scope" — a built NDC resolves to A instead of cascading to B-prime
  // ("needs build in this domain first" — wrong, because there is no
  // canonical "this domain").
  //
  // Multi-domain selection (e.g. RSM + a facility in another domain) is NOT
  // no-scope: facilityDomains has 2+ entries, and any build whose domain is
  // in that set is in-scope.
  const noScope = facilityDomains.length === 0
  const inScope = (b: FacilityBuild) => facilityDomains.includes(b.domain)

  const buildsInDomain = noScope ? [...builds] : builds.filter(inScope)
  const buildsInOtherDomains = noScope ? [] : builds.filter((b) => !inScope(b))

  // Flex check requires a real facility name + recognized domain. In no-scope
  // mode flexedAtRequestedFacility is meaningless (no facility to look up),
  // so we don't try to find a "flexed" build — the user is asking "is it
  // built anywhere," not "is it flexed at me."
  const flexedBuild = noScope
    ? null
    : (buildsInDomain.find((b) => b.flexedAtRequestedFacility) ?? null)
  const unflexedBuild =
    !noScope && !flexedBuild ? (buildsInDomain[0] ?? null) : null
  const sourceBuild =
    !flexedBuild && !unflexedBuild && !noScope
      ? (buildsInOtherDomains[0] ?? null)
      : null
  // No-scope: an example build to anchor the description. First build wins.
  const anyBuild = noScope ? (builds[0] ?? null) : null

  const evidence: DiagnosisEvidence = {
    facilityDomain,
    facilityDomains,
    buildsInDomain,
    buildsInOtherDomains,
    multumPresent: multumMaster.present,
    flexedBuild,
    unflexedBuild,
    sourceBuild,
    stackProbe,
  }

  let state: DiagnosisState
  let unverifiedStateC = false

  if (flexedBuild) {
    state = 'A'
  } else if (unflexedBuild) {
    state = 'B'
  } else if (sourceBuild) {
    state = 'B-prime'
  } else if (anyBuild) {
    // No-scope query with builds — "built somewhere in the formulary."
    state = 'A'
  } else if (stackProbe && stackProbe.status === 'match' && stackProbe.candidates.length > 0) {
    state = 'C'
  } else if (multumMaster.present) {
    state = 'D'
    // Probe was inconclusive — flag the residual uncertainty for the analyst.
    if (!stackProbe || stackProbe.status === 'not_in_extract' || stackProbe.status === 'no_mmdc') {
      unverifiedStateC = true
    }
  } else {
    state = 'E'
  }

  const meta = STATE_META[state]
  // No-scope State A: short/description shouldn't claim a flex relationship
  // at the user's facility, since there is no user facility in scope.
  const isNoScopeA = state === 'A' && !flexedBuild
  const short = isNoScopeA
    ? 'Already built somewhere in the formulary'
    : meta.short

  return {
    state,
    label: meta.label,
    color: meta.color,
    emoji: meta.emoji,
    short,
    description: describe(state, evidence),
    action: meta.action,
    evidence,
    unverifiedStateC,
    // "Facility unknown" fires only when the user actually picked facilities
    // but none of them resolved to a Cerner domain — i.e. the names in the
    // picker don't appear in any inventory_json. An empty selection is
    // intentional all-facilities mode and shouldn't trigger the warning.
    facilityUnknown: lookup.facilities.length > 0 && facilityDomains.length === 0,
  }
}

/**
 * Severity ordering for choosing among zero-pad candidates. Lower = more
 * resolved. When a 10-digit input emits 3 candidate NDCs, we run all three
 * lookups and pick the candidate with the lowest-numbered state — i.e. a real
 * Cerner build beats a Multum-only hit beats nothing at all.
 *
 * Exported here so the I/O orchestrator in `lib/scanner.ts` can use it without
 * duplicating the table.
 */
export const DIAGNOSIS_STATE_RANK: Record<DiagnosisState, number> = {
  A: 0, B: 1, 'B-prime': 2, C: 3, D: 4, E: 5,
}
