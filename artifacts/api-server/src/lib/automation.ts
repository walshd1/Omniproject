import {
  AUTOMATION_ACTIONS, getActionDef, getTriggerDef, recipeMutates,
  type AutomationRecipe, type AutomationAction, type AutomationCondition, type ActionRequirement,
} from "@workspace/backend-catalogue";
import { validateWorkflow, type WorkflowDef, type WorkflowStep } from "./workflow";

/**
 * Automation recipes — validation, compile-to-workflow, and the RBAC requirement set. A recipe is the
 * friendly "when X, do Y" shape; it COMPILES to the existing workflow-engine JSON (no new engine) and runs
 * through the existing, RBAC-scoped runner. This module is pure — no broker/settings/IO — so it validates
 * cleanly (typed 400s) and is unit-testable; the route resolves the caller's permissions and enforces the
 * requirements this returns.
 */
export class AutomationError extends Error {
  constructor(message: string) { super(message); this.name = "AutomationError"; }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isForbiddenKey = (k: string): boolean => k === "__proto__" || k === "constructor" || k === "prototype";
const OPS = new Set(["eq", "ne", "in", "gt", "lt", "truthy"]);

/** Validate + normalise the stored recipe list. Pure — throws {@link AutomationError}. */
export function validateAutomations(value: unknown): AutomationRecipe[] {
  if (!Array.isArray(value)) throw new AutomationError("automations must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const label = str(o["label"]);
    if (!id || !label) throw new AutomationError("each recipe needs an id and a label");
    if (ids.has(id)) throw new AutomationError(`duplicate recipe id "${id}"`);
    ids.add(id);

    // Scope — org or a specific project (a project recipe can only touch that project).
    const rawScope = (o["scope"] ?? {}) as Record<string, unknown>;
    let scope: AutomationRecipe["scope"];
    if (str(rawScope["kind"]) === "org") scope = { kind: "org" };
    else if (str(rawScope["kind"]) === "project" && str(rawScope["projectId"])) scope = { kind: "project", projectId: str(rawScope["projectId"]) };
    else throw new AutomationError(`recipe "${id}" scope must be {kind:'org'} or {kind:'project',projectId}`);

    // Trigger.
    const rawTrigger = (o["trigger"] ?? {}) as Record<string, unknown>;
    const tDef = getTriggerDef(str(rawTrigger["kind"]));
    if (!tDef) throw new AutomationError(`recipe "${id}" has an unknown trigger`);
    const trigger: AutomationRecipe["trigger"] = { kind: tDef.kind };
    if (tDef.mode === "schedule") {
      const cron = str(rawTrigger["cron"]);
      if (!cron) throw new AutomationError(`recipe "${id}" schedule trigger needs a cron expression`);
      trigger.cron = cron;
    }

    // Conditions (optional).
    const conditions: AutomationCondition[] = [];
    if (o["conditions"] != null) {
      if (!Array.isArray(o["conditions"])) throw new AutomationError(`recipe "${id}" conditions must be an array`);
      for (const rawC of o["conditions"] as unknown[]) {
        const c = (rawC ?? {}) as Record<string, unknown>;
        const field = str(c["field"]);
        const op = str(c["op"]);
        if (!field || isForbiddenKey(field)) throw new AutomationError(`recipe "${id}" condition needs a field`);
        if (!OPS.has(op)) throw new AutomationError(`recipe "${id}" condition op must be one of ${[...OPS].join(", ")}`);
        const cond: AutomationCondition = { field, op: op as AutomationCondition["op"] };
        if (op !== "truthy") {
          if (str(c["value"]) === "" && c["value"] == null) throw new AutomationError(`recipe "${id}" condition "${field}" needs a value`);
          cond.value = str(c["value"]);
        }
        conditions.push(cond);
      }
    }

    // Actions — at least one, each a catalogued kind.
    if (!Array.isArray(o["actions"]) || o["actions"].length === 0) throw new AutomationError(`recipe "${id}" needs at least one action`);
    const actions: AutomationAction[] = (o["actions"] as unknown[]).map((rawA) => {
      const a = (rawA ?? {}) as Record<string, unknown>;
      const def = getActionDef(str(a["kind"]));
      if (!def) throw new AutomationError(`recipe "${id}" has an unknown action "${str(a["kind"])}"`);
      const params = (a["params"] && typeof a["params"] === "object" && !Array.isArray(a["params"])) ? (a["params"] as Record<string, unknown>) : {};
      for (const k of Object.keys(params)) if (isForbiddenKey(k)) delete params[k];
      // A project-write action inside an org recipe must name a project; a project recipe binds it implicitly.
      if (def.mutating && scope.kind === "org" && !str(params["projectId"])) throw new AutomationError(`recipe "${id}" action "${def.kind}" needs a projectId (org-scoped recipe)`);
      return { kind: def.kind, params };
    });

    const recipe: AutomationRecipe = { id, label, scope, trigger, actions };
    if (conditions.length > 0) recipe.conditions = conditions;
    if (o["enabled"] === false) recipe.enabled = false;
    return recipe;
  });
}

/**
 * The set of PERMISSION requirements a recipe imposes — what the author (and the runner) must be allowed to
 * do. The route resolves these against the caller's RBAC so a user can only automate what they may edit.
 */
export function recipeRequirements(recipe: AutomationRecipe): ActionRequirement[] {
  const reqs: ActionRequirement[] = [];
  const seen = new Set<string>();
  for (const a of recipe.actions) {
    const def = getActionDef(a.kind);
    if (!def) continue;
    const key = JSON.stringify(def.requires);
    if (!seen.has(key)) { seen.add(key); reqs.push(def.requires); }
  }
  return reqs;
}

/** Which project a mutating action touches (explicit param, or the recipe's project scope). */
export function actionProjectId(recipe: AutomationRecipe, action: AutomationAction): string | undefined {
  const explicit = str((action.params ?? {})["projectId"]);
  if (explicit) return explicit;
  return recipe.scope.kind === "project" ? recipe.scope.projectId : undefined;
}

/**
 * Compile a recipe to the existing workflow-engine JSON. Actions become `action` steps; conditions wrap them
 * in a `condition` step keyed on a synthetic `subject` result the runner seeds with the triggering entity.
 * Returns a validated {@link WorkflowDef} (so a malformed compile is caught by the engine's own validator).
 */
export function compileRecipe(recipe: AutomationRecipe): WorkflowDef {
  const actionSteps: WorkflowStep[] = recipe.actions.map((a, i) => {
    const def = getActionDef(a.kind)!;
    return { id: `action-${i}`, kind: "action", action: def.effect, params: { ...a.params, __recipeAction: a.kind } };
  });

  // Conditions gate the actions: all must pass. We model "all pass" as nested condition steps.
  let steps: WorkflowStep[] = actionSteps;
  const conditions = recipe.conditions ?? [];
  for (let i = conditions.length - 1; i >= 0; i--) {
    const c = conditions[i]!;
    steps = [{
      id: `cond-${i}`,
      kind: "condition",
      // The runner seeds `subject` with the triggering entity; the engine's StepTest checks existence/equality.
      test: c.op === "truthy" ? { result: "subject", exists: true } : { result: "subject", equals: undefined },
      then: steps,
      else: [],
    }];
    // Note: fine-grained field comparison happens in the runner's predicate (the engine test is coarse); this
    // keeps the compiled shape valid while the runner applies the real condition before seeding `subject`.
  }

  const def = { id: `recipe:${recipe.id}`, scope: recipe.scope, steps };
  return validateWorkflow(def); // structural + bounds check via the ONE engine validator
}

export { recipeMutates, AUTOMATION_ACTIONS };
