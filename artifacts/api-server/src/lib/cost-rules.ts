import { matches, type ConditionSet, type Context } from "./predicate";
import type { Uplift } from "./rate-card";

/**
 * General, PMO-authored cost rules.
 *
 * A cost rule is `when` (any predicate matrix — programme, project type, a budget threshold, a negative
 * projection, an intra-company flag, a region, any project attribute the backend exposes …) → `then`
 * (override the costing uplift). "Intra-company → margin 0" is just one rule a PMO might write; the
 * engine is fully general — there is nothing intra-company-specific in the code.
 *
 * Rules layer on top of the scope-resolved uplift (central → programme → project): a matching rule
 * overrides margin and/or overhead for that context, so a charge column can become cost-only (margin 0),
 * carry a premium margin for a given client, etc. — all by data, no code change.
 *
 * Pure + side-effect free, so the whole rule language is unit-testable; the route builds the context.
 */

/** What a matching rule does to the costing uplift (absolute field overrides). */
export interface CostEffect {
  /** Set the margin fraction (0.2 = 20%) for matching contexts. */
  margin?: number;
  /** Set the overhead fraction for matching contexts. */
  overhead?: number;
}

export interface CostRule {
  id: string;
  label?: string;
  /** The match condition; absent ⇒ the rule always applies. */
  when?: ConditionSet;
  effect: CostEffect;
}

/**
 * The effective uplift for a context: the scope-resolved base, then every matching rule applied in
 * declared order (last write wins per field), so a later, more specific rule overrides an earlier
 * general one. Negative effect values are ignored (an uplift never goes below zero).
 */
export function applyCostRules(base: Uplift, rules: readonly CostRule[], ctx: Context): Uplift {
  let { margin, overhead } = base;
  for (const r of rules) {
    if (!matches(r.when, ctx)) continue;
    if (typeof r.effect.margin === "number" && r.effect.margin >= 0) margin = r.effect.margin;
    if (typeof r.effect.overhead === "number" && r.effect.overhead >= 0) overhead = r.effect.overhead;
  }
  return { margin, overhead };
}

/** The ids of the rules that fired for a context — for explainability ("why is this charge this?"). */
export function firedCostRuleIds(rules: readonly CostRule[], ctx: Context): string[] {
  return rules.filter((r) => matches(r.when, ctx)).map((r) => r.id);
}
