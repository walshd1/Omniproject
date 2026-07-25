/**
 * RISK-EXPOSURE maths, routed through the SCOPE-RESOLVED graded vocabularies. A RAID/risk entry's exposure is
 * the classic P×I — its LIKELIHOOD ordinal times its IMPACT ordinal — but likelihood/impact are now
 * scope-overridable (a scope may relabel, add or remove grades — see the *-vocabulary-config resolvers). So
 * the score is computed from each grade's RESOLVED internal `level`, snapped onto the nearest SHIPPED anchor
 * band (mirroring work-vocabulary's `priorityWeightBand`), so:
 *   - the shipped grades (low/medium/high = 1/2/3) are anchors → identity → the numbers never move, and
 *   - a scope-ADDED grade (any ordinal) still yields a bounded number instead of breaking the maths.
 *
 * Pure + resolver-driven. `resolveRiskExposure` returns null only when a supplied grade id isn't in the
 * resolved set (the caller can treat an unknown grade as "no exposure computable").
 */
import { resolveImpactVocabulary } from "./impact-vocabulary-config";
import { resolveLikelihoodVocabulary } from "./likelihood-vocabulary-config";
import { impactVocabularyValues, likelihoodVocabularyValues } from "@workspace/backend-catalogue";
import type { ConfigScopes } from "./scoped-config";

/** The distinct shipped anchor levels of a graded vocabulary, ascending — the canonical bands to snap onto. */
function anchorsOf(levels: readonly { level: number }[]): number[] {
  return [...new Set(levels.map((l) => l.level))].sort((a, b) => a - b);
}

/**
 * Snap an arbitrary ordinal `level` onto the NEAREST shipped anchor band (ties break toward the higher, i.e.
 * more-severe, band). This is how a scope-added grade — whatever ordinal it declares — still resolves onto a
 * band the exposure maths understand. Returns null only when there are no anchors.
 */
export function nearestBand(level: number, anchors: readonly number[]): number | null {
  if (!anchors.length) return null;
  let best = anchors[0]!;
  for (const anchor of anchors) {
    const d = Math.abs(anchor - level);
    const bd = Math.abs(best - level);
    if (d < bd || (d === bd && anchor > best)) best = anchor;
  }
  return best;
}

/** The shipped likelihood anchors (P) — computed once from the catalogue default, so the snap is stable. */
const LIKELIHOOD_ANCHORS = anchorsOf(likelihoodVocabularyValues().levels);
/** The shipped impact anchors (I) — computed once from the catalogue default. */
const IMPACT_ANCHORS = anchorsOf(impactVocabularyValues().levels);

/**
 * The risk exposure (P×I) for a RAID/risk entry at the caller's scope: the resolved LIKELIHOOD grade's ordinal
 * (snapped onto the nearest shipped likelihood anchor) times the resolved IMPACT grade's ordinal (snapped onto
 * the nearest shipped impact anchor). Shipped grades snap to themselves, so the exposure for a shipped
 * likelihood/impact pair is unchanged; a scope-added grade still yields a bounded number. Returns null when
 * either id isn't a grade in the resolved set for this scope.
 */
export function resolveRiskExposure(likelihoodId: string, impactId: string, scopes: ConfigScopes = {}): number | null {
  const likelihood = resolveLikelihoodVocabulary(scopes).levels.find((l) => l.id === likelihoodId);
  const impact = resolveImpactVocabulary(scopes).levels.find((l) => l.id === impactId);
  if (!likelihood || !impact) return null;
  const p = nearestBand(likelihood.level, LIKELIHOOD_ANCHORS);
  const i = nearestBand(impact.level, IMPACT_ANCHORS);
  if (p === null || i === null) return null;
  return p * i;
}
