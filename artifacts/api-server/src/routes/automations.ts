import { Router, type Request, type RequestHandler } from "express";
import { getActionDef, recipeMutates, type AutomationRecipe } from "@workspace/backend-catalogue";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { validateAutomations, compileRecipe, recipeRequirements, actionProjectId, AutomationError } from "../lib/automation";
import { grantsForReq, grantsSatisfy } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { editPolicyFor } from "../lib/collection-edit-policy";

/**
 * Automation RECIPES — the user-facing "when X, do Y" builder (Phase 1.2). Recipes are stored as data and
 * compile to the existing workflow engine. The HARD rule: a user may only automate what THEY may edit —
 * enforced here at authoring (the PUT guard rejects a recipe with an action the author isn't permitted to
 * perform) and, at run time, by the workflow runner (which never widens scope and refuses silent mutations —
 * mutating recipes run only under an autonomous grant). A preview endpoint dry-runs the compile.
 */
const router = Router();

/** Is the caller permitted to perform every action in this recipe? Returns a denial reason, or null. */
async function authorDenial(req: Request, recipe: AutomationRecipe): Promise<string | null> {
  for (const action of recipe.actions) {
    const def = getActionDef(action.kind);
    if (!def) return `unknown action "${action.kind}"`;
    const need = def.requires;
    if (need.kind === "inform") continue; // sending a notification needs no edit right
    if (need.kind === "collection") {
      const policy = editPolicyFor(need.collection) ?? "contributor";
      if (policy === "readonly" || !grantsSatisfy(grantsForReq(req), policy)) {
        return `you can't automate "${def.label}": editing "${need.collection}" is not permitted for you`;
      }
      continue;
    }
    // project-write — you must be able to write work items in the action's project.
    const projectId = actionProjectId(recipe, action);
    if (!projectId) return `action "${def.label}" has no project to write to`;
    if (!grantsSatisfy(grantsForReq(req), "contributor")) return `you can't automate "${def.label}": writing work items requires the contributor role`;
    const scope = await assertProjectScope(req, projectId);
    if (!scope.ok) return `you can't automate "${def.label}" in project "${projectId}": ${scope.error}`;
  }
  return null;
}

/** Authoring guard: a saved recipe may only contain actions the author is permitted to perform. */
const gateAutomationPermissions: RequestHandler = async (req, res, next) => {
  let recipes: AutomationRecipe[];
  try {
    recipes = validateAutomations((req.body as { automations?: unknown } | undefined)?.automations);
  } catch {
    next(); // shape errors are the settings validator's job (→ 400 there)
    return;
  }
  for (const r of recipes) {
    const denial = await authorDenial(req, r);
    if (denial) { res.status(403).json({ error: `Recipe "${r.id}": ${denial}.` }); return; }
  }
  next();
};

/**
 * Dry-run: validate + compile a DRAFT recipe (in the body) and report the compiled workflow, the RBAC
 * requirements, whether it mutates (⇒ needs an autonomous grant to run), and whether the caller could author
 * it. No side effects — the preview before enabling.
 */
router.post("/automations/preview", async (req, res) => {
  let recipe: AutomationRecipe;
  try {
    recipe = validateAutomations([(req.body as { recipe?: unknown } | undefined)?.recipe])[0]!;
  } catch (err) {
    res.status(400).json({ error: err instanceof AutomationError ? err.message : "Invalid recipe" });
    return;
  }
  const denial = await authorDenial(req, recipe);
  res.json({
    workflow: compileRecipe(recipe),
    requirements: recipeRequirements(recipe),
    mutates: recipeMutates(recipe),
    canAuthor: denial === null,
    ...(denial ? { reason: denial } : {}),
  });
});

// The recipe store — read open (the SPA lists them), write gated to what the author may edit.
router.use(settingsCollectionRouter({
  path: "/automations",
  settingsKey: "automations",
  versionLabel: "automations updated",
  writeGuards: [gateAutomationPermissions],
}));

export default router;
