import { matches, type ConditionSet, type Context } from "./predicate";

/**
 * Conditional governance rules — a PMO mandate that applies only WHEN its predicate matches.
 *
 * "Small internal projects need lighter control" is just one example: the PMO writes their mandates with
 * a `when` (e.g. `projectType != small-internal`), so small-internal projects simply aren't subject to
 * them. The rule carries its own **scope-of-applicability** — it is the org/PMO authoring a *conditional
 * restriction*, NOT a child loosening a parent. So the monotonic "org is the ceiling" guarantee of the
 * gating model is preserved: a rule can only mandate (`require`) or ban (`forbid`/`disable`) catalogue
 * items for the contexts it matches; it can never grant a capability the org withheld.
 *
 * Pure + side-effect free, so the rule language is unit-testable; callers build the project context
 * (programme, project type, budget, projection, any attribute the backend exposes) and fold the result
 * into the scope overrides the resolver already consumes.
 */

export interface GovernanceRule {
  id: string;
  label?: string;
  /** The match condition; absent ⇒ the rule always applies. */
  when?: ConditionSet;
  /** Catalogue ids (feature / `report:<id>` / `methodology:<id>`) to mandate when the rule applies. */
  require?: string[];
  /** Catalogue ids to ban (hard) when the rule applies. */
  forbid?: string[];
  /** Catalogue ids to soft-disable when the rule applies. */
  disable?: string[];
}

export interface GovernanceOverrides {
  required: string[];
  forbidden: string[];
  disabled: string[];
}

/** Collect the effects of every rule whose condition matches the context (deduped, declared order). */
export function governanceOverridesFor(rules: readonly GovernanceRule[], ctx: Context): GovernanceOverrides {
  const required = new Set<string>();
  const forbidden = new Set<string>();
  const disabled = new Set<string>();
  for (const r of rules) {
    if (!matches(r.when, ctx)) continue;
    for (const id of r.require ?? []) required.add(id);
    for (const id of r.forbid ?? []) forbidden.add(id);
    for (const id of r.disable ?? []) disabled.add(id);
  }
  return { required: [...required], forbidden: [...forbidden], disabled: [...disabled] };
}

/** The ids of the governance rules that fired for a context — for explainability + audit. */
export function firedGovernanceRuleIds(rules: readonly GovernanceRule[], ctx: Context): string[] {
  return rules.filter((r) => matches(r.when, ctx)).map((r) => r.id);
}
