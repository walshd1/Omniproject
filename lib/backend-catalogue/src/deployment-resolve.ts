import { getDeploymentType, type DeploymentType } from "./deployment-type-catalogue";

/**
 * DEPLOYMENT RESOLVE — pure. Given a deployment type + the user's answers, fold the answers into the
 * known-good setup: start from the type's base `setup`, fill any unanswered question with its `default`,
 * then apply every refinement whose `when` fully matches the (defaulted) answers, later refinements winning.
 * This is what "pick your deployment type, answer a few questions, get a known best setup" runs. No I/O.
 */

export interface ResolvedDeployment {
  deploymentTypeId: string;
  label: string;
  /** The answers used — the caller's values with each unanswered question filled from its `default`. */
  answers: Record<string, string>;
  /** The resolved known-good setup (recommended config keys → values). */
  setup: Record<string, string>;
}

/** The answers with every question's `default` filled in for anything the caller left out (unknown answer
 *  keys are ignored — only declared questions count). */
export function withDefaults(type: DeploymentType, answers: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of type.questions ?? []) {
    const given = answers[q.id];
    const valid = q.options.some((o) => o.value === given);
    out[q.id] = valid ? given! : q.default;
  }
  return out;
}

/** Does every key/value in `when` match the answers? */
const matches = (when: Record<string, string>, answers: Record<string, string>): boolean =>
  Object.entries(when).every(([k, v]) => answers[k] === v);

/**
 * Resolve the known-good setup for a deployment type + answers. Returns null for an unknown type id.
 * Pure: base setup ⊕ (each matching refinement's `set`, in order).
 */
export function resolveDeploymentSetup(deploymentTypeId: string, answers: Record<string, string> = {}): ResolvedDeployment | null {
  const type = getDeploymentType(deploymentTypeId);
  if (!type) return null;
  const resolvedAnswers = withDefaults(type, answers);
  const setup: Record<string, string> = { ...type.setup };
  for (const r of type.refinements ?? []) {
    if (matches(r.when, resolvedAnswers)) Object.assign(setup, r.set);
  }
  return { deploymentTypeId, label: type.label, answers: resolvedAnswers, setup };
}
