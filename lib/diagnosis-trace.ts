/**
 * Decision trace — derives a human-readable explanation of *what the classifier
 * actually checked* (and, just as importantly, what it did NOT check) from a
 * ScanResult.
 *
 * This is a pure derivation. It re-walks the same decision tree as
 * `lib/diagnosis.ts` against the already-computed evidence, so it cannot
 * disagree with the rendered verdict. When the classifier grows new probes
 * (stacking candidate search, DailyMed identity lookup, RxNorm related-NDC
 * pull, Multum drug formulation match, Orange Book TE), move the corresponding
 * entry from `DEFERRED_PROBES` into the active code path in `diagnose()` and
 * emit a `ran` entry here instead.
 *
 * Maintainer/Analyst mode is the intended audience — end users see the
 * scope-gate or the diagnosis card; this trace is for "why did it decide
 * that?" investigations like the Fluoxetine 40 mg / 16729-0210-10 case where
 * a stacking candidate plainly exists at the facility but the classifier
 * has no probe for it.
 *
 * No I/O, no React. Pure function over `ScanResult`. Test by constructing
 * fixture results — or just call from the UI; mismatch with the verdict means
 * either the classifier or this trace drifted.
 */

import type { ScanResult } from './scanner'
import type { DiagnosisState } from './diagnosis'

/**
 * `pass`     — check ran and produced a positive signal (built here, master present, etc.).
 * `fail`     — check ran and produced a negative signal (no build, no master).
 * `skipped`  — check did NOT run because an earlier check already short-circuited the decision.
 * `deferred` — check is part of the design but not yet implemented (Phase 1.5+).
 */
export type TraceCheckStatus = 'pass' | 'fail' | 'skipped' | 'deferred'

export interface TraceCheck {
  /** Stable id so the renderer can key on it. */
  id: string
  /** Short label, e.g. "Resolve facility to Cerner domain". */
  label: string
  status: TraceCheckStatus
  /** One-line factual detail for the UI. */
  detail: string
  /**
   * For `deferred` / `skipped` only: why this check didn't run. Explains the
   * gap so the investigator doesn't have to read source.
   */
  reason?: string
  /**
   * For `deferred` only: what data source / table / API the probe would hit
   * if it were implemented. Helps you spot which probe to wire up next.
   */
  futureSource?: string
}

export interface DecisionTrace {
  /** The state the classifier emitted, plus the rule whose predicate fired. */
  verdict: {
    state: DiagnosisState
    /** Plain-English rule name, mirrored from the if/else chain in diagnose(). */
    rule: string
  }
  /** Checks the classifier actually ran, in evaluation order. */
  ranChecks: TraceCheck[]
  /** Probes that exist in the design but aren't wired up yet. Stable list. */
  deferredChecks: TraceCheck[]
  /** Barcode / NDC parse summary — what was detected, what candidates we tried. */
  parseTrace: {
    format: string
    digits: string
    candidates: readonly string[]
    chosenNdc: string
    alternates: ReadonlyArray<{ ndc: string; state: DiagnosisState; label: string }>
  }
}

/**
 * The fixed list of probes the design calls for but that aren't implemented
 * yet. Order is "what I'd wire up next" so the panel doubles as a roadmap.
 *
 * When you implement one, delete it from here and add a corresponding `ran`
 * entry in `buildDecisionTrace()`.
 */
const DEFERRED_PROBES: ReadonlyArray<Omit<TraceCheck, 'status'>> = [
  {
    id: 'mmdc-combo-active-ingred',
    label: 'Active-ingredient join for combination products',
    detail:
      'When mltm_drug_id.is_single_ingredient = "F", the MMDC alone can group two combos that aren\'t actually interchangeable. Need to join MLTM_NDC_ACTIVE_INGRED + MLTM_NDC_INGRED_STRENGTH and require the full active-ingredient set to match before suggesting a stack.',
    reason: 'Tables not in the current Turso extract — add to the next Multum xlsx pull.',
    futureSource: 'MLTM_NDC_ACTIVE_INGRED, MLTM_NDC_INGRED_STRENGTH (per the official data model)',
  },
  {
    id: 'orange-book-te',
    label: 'Orange Book therapeutic equivalence (MLTM_NDC_ORANGE_BOOK)',
    detail:
      'AB-rated NDCs are interchangeable per FDA — confirmable in one column: MLTM_NDC_ORANGE_BOOK.ORANGE_BOOK_DESC_AB LIKE "A%". A second-tier probe that catches stack candidates when MMDC differs but FDA TE confirms interchangeability.',
    reason:
      'MLTM_NDC_ORANGE_BOOK isn\'t in the current Turso extract. Tiny table (~30 rows expected) — easy add on the next Multum pull.',
    futureSource: 'MLTM_NDC_ORANGE_BOOK joined to mltm_ndc.orange_book_id (already loaded)',
  },
  {
    id: 'dailymed-spl',
    label: 'DailyMed SPL lookup (identity fallback)',
    detail:
      'When the MMDC probe returns "not_in_extract" we have no identity to ground further reasoning. DailyMed by NDC fills that gap. Less critical now that the MMDC probe handles the bulk — useful for the long tail.',
    reason:
      'No DailyMed integration in this repo. The order-sentence repo has one (proxied at /api/dailymed/[setid]) — port when "not_in_extract" rate proves painful.',
    futureSource: 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc=<ndc>',
  },
  {
    id: 'rxnorm-related-ndcs',
    label: 'RxNorm related NDCs (same RxCUI)',
    detail:
      'Would resolve the scanned NDC to an RxCUI and pull all NDCs that share it. Overlaps significantly with the MMDC probe; treat as a sanity-check / cross-reference rather than a primary signal.',
    reason: 'No RxNorm integration. Lower priority now that MMDC is wired.',
    futureSource: 'https://rxnav.nlm.nih.gov/REST/ndcstatus.json?ndc=<ndc>',
  },
]

/**
 * Build the decision trace for an already-computed scan result.
 *
 * The function re-walks the diagnose() decision tree against the evidence
 * fields (which are themselves derived from the inputs the classifier saw).
 * If diagnose() and this function disagree, one of them has drifted.
 */
export function buildDecisionTrace(result: ScanResult): DecisionTrace | null {
  if (!result.diagnosis || !result.lookup) return null

  const ev = result.diagnosis.evidence
  const lookup = result.lookup
  const ran: TraceCheck[] = []

  // 1. Facility → Cerner domain resolution
  // Multi-facility: report each selected facility's domain, or note when the
  // selection spans multiple domains / nothing was selected (no-scope mode).
  const selected = lookup.facilities
  const facilityDetail = (() => {
    if (selected.length === 0) {
      return 'No facility selected — running in "All facilities" mode (no domain scope).'
    }
    if (ev.facilityDomains.length === 0) {
      return `${selected.map((f) => `"${f}"`).join(', ')} — none recognized in the inventory map.`
    }
    if (ev.facilityDomain) {
      return selected.length === 1
        ? `"${selected[0]}" → ${ev.facilityDomain}`
        : `${selected.map((f) => `"${f}"`).join(', ')} → ${ev.facilityDomain}`
    }
    // Multi-domain selection
    return `${selected.map((f) => `"${f}"`).join(', ')} span ${ev.facilityDomains.length} domains: ${ev.facilityDomains.join(', ')}.`
  })()
  ran.push({
    id: 'facility-domain',
    label: 'Resolve facility to Cerner domain',
    status: ev.facilityDomains.length > 0 ? 'pass' : selected.length === 0 ? 'skipped' : 'fail',
    detail: facilityDetail,
  })

  // 2. supply_records / build lookup
  const totalBuilds = ev.buildsInDomain.length + ev.buildsInOtherDomains.length
  ran.push({
    id: 'build-lookup',
    label: 'Find Cerner builds for this NDC',
    status: totalBuilds > 0 ? 'pass' : 'fail',
    detail:
      totalBuilds === 0
        ? 'No row in supply_records for this NDC anywhere — no Cerner build exists.'
        : `${ev.buildsInDomain.length} build(s) in this domain, ${ev.buildsInOtherDomains.length} in other domains.`,
  })

  // 3. State A check — flexed in this domain
  if (ev.flexedBuild) {
    ran.push({
      id: 'flexed-here',
      label: 'In-domain build flexed to this facility?',
      status: 'pass',
      detail: `Build group ${ev.flexedBuild.groupId} (${ev.flexedBuild.domain}) is flexed here → State A.`,
    })
  } else if (ev.buildsInDomain.length > 0) {
    ran.push({
      id: 'flexed-here',
      label: 'In-domain build flexed to this facility?',
      status: 'fail',
      detail: `${ev.buildsInDomain.length} in-domain build(s) but none flexed to ${lookup.facilities.length === 0 ? '(no facility selected)' : lookup.facilities.join(' / ')}.`,
    })
  } else {
    ran.push({
      id: 'flexed-here',
      label: 'In-domain build flexed to this facility?',
      status: 'skipped',
      detail: 'No in-domain builds to evaluate.',
      reason: 'Earlier check (build lookup) returned 0 in-domain builds.',
    })
  }

  // 4. State B check — unflexed in-domain
  if (ev.flexedBuild) {
    ran.push({
      id: 'unflexed-in-domain',
      label: 'Unflexed in-domain build (State B)?',
      status: 'skipped',
      detail: 'Already matched State A.',
      reason: 'State A short-circuits the rest of the tree.',
    })
  } else if (ev.unflexedBuild) {
    ran.push({
      id: 'unflexed-in-domain',
      label: 'Unflexed in-domain build (State B)?',
      status: 'pass',
      detail: `Build group ${ev.unflexedBuild.groupId} in ${ev.unflexedBuild.domain} is built but not flexed here → State B (flex request).`,
    })
  } else {
    ran.push({
      id: 'unflexed-in-domain',
      label: 'Unflexed in-domain build (State B)?',
      status: 'fail',
      detail: 'No in-domain builds.',
    })
  }

  // 5. State B' check — out-of-domain build
  if (ev.flexedBuild || ev.unflexedBuild) {
    ran.push({
      id: 'other-domain-build',
      label: 'Build in another Cerner domain (State B′)?',
      status: 'skipped',
      detail: 'Already matched State A or B.',
      reason: 'In-domain match short-circuits B′.',
    })
  } else if (ev.sourceBuild) {
    ran.push({
      id: 'other-domain-build',
      label: 'Build in another Cerner domain (State B′)?',
      status: 'pass',
      detail: `Build exists in ${ev.sourceBuild.domain} (group ${ev.sourceBuild.groupId}) — multi-domain build needed → State B′.`,
    })
  } else {
    ran.push({
      id: 'other-domain-build',
      label: 'Build in another Cerner domain (State B′)?',
      status: 'fail',
      detail: 'No Cerner builds in any domain.',
    })
  }

  // 6. Multum master CDM presence
  const hasAnyBuild = ev.flexedBuild || ev.unflexedBuild || ev.sourceBuild
  if (hasAnyBuild) {
    ran.push({
      id: 'multum-master',
      label: 'Multum master CDM extract',
      status: 'skipped',
      detail: ev.multumPresent
        ? 'NDC is present in the Multum master extract, but a Cerner build already won the verdict.'
        : 'Skipped — a Cerner build already won the verdict.',
      reason: 'Multum master only matters when no Cerner build exists.',
    })
  } else {
    ran.push({
      id: 'multum-master',
      label: 'Multum master CDM extract',
      status: ev.multumPresent ? 'pass' : 'fail',
      detail: ev.multumPresent
        ? `NDC is in multum_ndcs (AWP $${formatMoney(lookup.multumMaster.awp)}, A-cost $${formatMoney(lookup.multumMaster.aCost)}, pkg ${lookup.multumMaster.innerPkgSize ?? '—'}/${lookup.multumMaster.outerPkgSize ?? '—'}, unit-dose ${lookup.multumMaster.unitDoseCode ?? '—'}, GBO ${lookup.multumMaster.gbo ?? '—'}) → State D candidate.`
        : 'NDC is not in the Multum master extract — falls through to State E.',
    })
  }

  // 7. MMDC stacking probe — runs only when no Cerner build anywhere.
  // GHOST MODE: probe runs and result is shown here, but diagnose() still
  // emits D/E. Verdict-changing logic ships after live validation.
  if (hasAnyBuild) {
    ran.push({
      id: 'mmdc-stack-probe',
      label: 'MMDC stacking probe (Multum)',
      status: 'skipped',
      detail: 'A Cerner build already won the verdict — stacking is moot.',
      reason: 'Probe runs only when builds.length === 0.',
    })
  } else if (lookup.stackProbe == null) {
    ran.push({
      id: 'mmdc-stack-probe',
      label: 'MMDC stacking probe (Multum)',
      status: 'skipped',
      detail: 'mltm_* tables not loaded — probe could not run.',
      reason: 'Run scripts/load_multum_xlsx.ts to populate the Multum data-model tables.',
    })
  } else {
    const sp = lookup.stackProbe
    const formul = sp.formulationName ? `MMDC ${sp.mmdc} = ${sp.formulationName}` : `MMDC ${sp.mmdc ?? '—'}`
    // Note: is_single_ingredient flag in Multum's data is unreliable (Fluoxetine
    // and other clearly-mono drugs come back 'F'). Skip the combo warning until
    // we can verify what the field actually means — the canonical fix is the
    // active-ingredient join (see deferred probes below) which is right
    // regardless of the flag's semantics.
    if (sp.status === 'match') {
      const groupSummary = sp.candidates
        .slice(0, 3)
        .map((c) => `${c.groupId}${c.chargeNumber ? ` (CDM ${c.chargeNumber})` : ''}${c.flexedAtFacility ? ' ✓flexed here' : ''}`)
        .join(', ')
      const more = sp.candidates.length > 3 ? `, +${sp.candidates.length - 3} more` : ''
      ran.push({
        id: 'mmdc-stack-probe',
        label: 'MMDC stacking probe (Multum)',
        status: 'pass',
        detail: `${formul}. ${sp.siblingCount} active sibling NDC(s) share this MMDC; ${sp.candidates.length} are built in ${ev.facilityDomain} → State C. Candidates: ${groupSummary}${more}.`,
      })
    } else if (sp.status === 'no_match') {
      ran.push({
        id: 'mmdc-stack-probe',
        label: 'MMDC stacking probe (Multum)',
        status: 'fail',
        detail: `${formul}. ${sp.siblingCount} active sibling NDC(s) share the MMDC, but none have a build in ${ev.facilityDomain} — confirmed not stackable here.`,
      })
    } else if (sp.status === 'not_in_extract') {
      ran.push({
        id: 'mmdc-stack-probe',
        label: 'MMDC stacking probe (Multum)',
        status: 'fail',
        detail: 'Scanned NDC is not in mltm_ndc — probe inconclusive (Multum lags new launches; some NDCs aren\'t catalogued).',
        reason: 'A "not in extract" outcome is NOT the same as "no stack candidate" — fall back to identity from DailyMed/RxNorm before ruling stacking out.',
      })
    } else {
      ran.push({
        id: 'mmdc-stack-probe',
        label: 'MMDC stacking probe (Multum)',
        status: 'fail',
        detail: `NDC is in mltm_ndc but main_multum_drug_code is NULL (data quirk) — probe inconclusive.${sp.formulationName ? ` Best-effort identity: ${sp.formulationName}.` : ''}`,
      })
    }
  }

  // Verdict rule string — mirrors the if/else chain in diagnose()
  const ruleByState: Record<DiagnosisState, string> = {
    A: 'flexedBuild present',
    B: 'unflexedBuild present (no flexedBuild)',
    'B-prime': 'sourceBuild present (no in-domain build)',
    C: 'MMDC stacking probe matched (sibling NDC built in this domain)',
    D: 'multumMaster.present (no Cerner build, MMDC probe did not match)',
    E: 'no Cerner build, no Multum master, MMDC probe found no candidate',
  }

  return {
    verdict: {
      state: result.diagnosis.state,
      rule: ruleByState[result.diagnosis.state],
    },
    ranChecks: ran,
    deferredChecks: DEFERRED_PROBES.map((p) => ({ ...p, status: 'deferred' as const })),
    parseTrace: {
      format: result.parsed.format,
      digits: result.parsed.digits,
      candidates: result.parsed.candidates,
      chosenNdc: result.ndc,
      alternates: result.alternateCandidates,
    },
  }
}

function formatMoney(n: number | null): string {
  return n == null ? '—' : n.toFixed(2)
}
