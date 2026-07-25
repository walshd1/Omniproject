import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { resolveMethodologyComposition, writeOrgConfigCollection, writeScopedConfigCollection, assertDelegationAllowed, DelegationDeniedError, METHODOLOGY_COMPOSITION_ID, type ConfigWriteScope } from "../lib/scoped-config";
import { resolveMethodologyDeployment } from "@workspace/backend-catalogue";
import { applyRuleset } from "../lib/ruleset";
import { updateSettings, validatePatch } from "../lib/settings";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * The methodology COMPOSITION — the PMO/admin's curated set of visible artifact/output/ruleset ids, or `null`
 * (uncurated: everything the catalogues offer stays visible). Held in the composition model as a config-def-
 * backed collection whose value is NULLABLE (`null` is meaningful, so it can't ride the array-collection seam
 * whose default is `[]`). It gates the output surfaces (lib/composition-gate), reference rulesets and reports.
 *
 *  - GET /api/methodology-composition — the current composition (any authed user; the SPA composer reads it).
 *  - PUT /api/methodology-composition — set it (admin/PMO). Body: `{ methodologyComposition: string[] | null }`.
 *  - GET /api/methodology-composition/deployment/:id — PREVIEW a one-click methodology deploy (any authed):
 *      the composition item ids it turns on + its ruleset + its business-rule invariants.
 *  - POST /api/methodology-composition/deploy/:id — DEPLOY a methodology in one click (admin/PMO): set the
 *      org composition to its tagged surfaces AND apply its reference ruleset, atomically. (Programme/project
 *      scope is the remaining wiring; today the composition is org-scoped.)
 */
const router = Router();

/** Validate the composition: `null` (uncurated) or an array of string ids. Throws on anything else. */
function sanitize(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new Error("methodologyComposition must be null or an array of strings");
  }
  return value as string[];
}

router.get("/methodology-composition", (_req, res) => {
  res.json({ methodologyComposition: resolveMethodologyComposition() });
});

/**
 * PUT /api/methodology-composition — set the curated composition (admin/PMO).
 *
 * LANE 2: an org-config governance verb — the PMO-or-admin union rides in `gates`; the sealed-store
 * precondition and the null-or-string-array validation are the parse gate (503 store-off / 400 invalid). The
 * action base now records a success audit (methodology-composition.save) the hand-written route lacked —
 * additive, no-op under default config.
 */
export const methodologyCompositionSaveCommand: CommandDescriptor<{ value: string[] | null }> = {
  name: "methodology-composition.save",
  method: "put",
  path: "/methodology-composition",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req, res) => {
    if (!requireArtifactStore(res)) return null;
    try {
      return { value: sanitize((req.body as { methodologyComposition?: unknown } | undefined)?.methodologyComposition) };
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "invalid methodology composition" });
      return null;
    }
  },
  run: async (_req, _res, { value }) => {
    writeOrgConfigCollection(METHODOLOGY_COMPOSITION_ID, "Methodology composition", value);
    return { methodologyComposition: resolveMethodologyComposition() };
  },
  audit: "methodology-composition.save",
  auditCategory: "admin",
};
mountCommand(router, methodologyCompositionSaveCommand);

// PREVIEW: what deploying this methodology would turn on (read-only, any authed user).
router.get("/methodology-composition/deployment/:id", (req, res) => {
  const plan = resolveMethodologyDeployment(String((req.params as { id?: unknown }).id ?? ""));
  if (!plan) { res.status(404).json({ error: "unknown methodology" }); return; }
  res.json(plan);
});

/** The target scope for a deploy: org by default, or a programme/project named in the body. A body may name
 *  AT MOST one of programmeId/projectId. Throws a message on a bad shape. */
function deployScope(body: { programmeId?: unknown; projectId?: unknown } | undefined): ConfigWriteScope {
  const programmeId = typeof body?.programmeId === "string" && body.programmeId ? body.programmeId : undefined;
  const projectId = typeof body?.projectId === "string" && body.projectId ? body.projectId : undefined;
  if (programmeId && projectId) throw new Error("name only one of programmeId / projectId");
  if (programmeId) return { kind: "programme", programmeId };
  if (projectId) return { kind: "project", projectId };
  return { kind: "org" };
}

/** The resolved one-click deploy plan (non-null branch of resolveMethodologyDeployment). */
type MethodologyDeployPlan = NonNullable<ReturnType<typeof resolveMethodologyDeployment>>;

/**
 * POST /api/methodology-composition/deploy/:id — deploy a methodology in one click (admin/PMO).
 *
 * LANE 2: set the composition to the methodology's tagged surfaces + apply its reference ruleset, targeting the
 * org by default or a programme/project named in the body. The PMO-or-admin union rides in `gates`; every
 * pre-write check is the parse gate — sealed-store precondition (503), unknown methodology (404), bad scope
 * (400 — a body may name at most one of programmeId/projectId), and the delegation-policy cap
 * (403 `delegation_denied` with its area/allowed/attempted detail). Parse hands `run` the resolved plan +
 * scope, so `run` is the pure effect (writes + response). The existing `methodology_deploy` audit moves to
 * `auditMeta`/`auditStatus` (unchanged action/category/status/meta; the action base additionally stamps
 * `write: true`, consistent with every migrated command). Response payload — including the org-wide caveat
 * `scopeNote` and the non-aborting `settingsError` — is unchanged.
 */
export const methodologyDeployCommand: CommandDescriptor<{ id: string; plan: MethodologyDeployPlan; scope: ConfigWriteScope }> = {
  name: "methodology_deploy",
  method: "post",
  path: "/methodology-composition/deploy/:id",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req, res) => {
    if (!requireArtifactStore(res)) return null;
    const id = String((req.params as { id?: unknown }).id ?? "");
    const plan = resolveMethodologyDeployment(id);
    if (!plan) { res.status(404).json({ error: "unknown methodology" }); return null; }
    let scope: ConfigWriteScope;
    try { scope = deployScope(req.body as { programmeId?: unknown; projectId?: unknown } | undefined); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid deploy scope" }); return null; }
    // Governance gate: the admin's delegation policy caps how deep a methodology may vary. A deploy at a scope
    // deeper than allowed is refused (403) — "set the level of local variation you'll allow, and no further".
    try { assertDelegationAllowed("methodologyComposition", scope); }
    catch (e) {
      if (e instanceof DelegationDeniedError) { res.status(403).json({ error: e.message, code: "delegation_denied", area: e.area, allowed: e.allowed, attempted: e.attempted }); return null; }
      throw e;
    }
    return { id, plan, scope };
  },
  run: async (_req, _res, { id, plan, scope }) => {
    // 1) Turn on the methodology's surfaces (its tagged composition item ids) AT the target scope.
    writeScopedConfigCollection(METHODOLOGY_COMPOSITION_ID, "Methodology composition", plan.compositionItemIds, scope);
    // 2) Apply its reference ruleset (modes + field rules), if it ships one. (The ruleset engine is org-global.)
    if (plan.ruleset) applyRuleset({ modes: plan.ruleset.modes, fieldRules: plan.ruleset.fieldRules });
    // 3) Land its PRESET SETTINGS block (the posture half of the bundle), validated against the field
    //    descriptors. Settings are org-global (like the ruleset), so this applies regardless of the scope.
    //    An invalid block is rejected as a whole, reported back, and doesn't abort the (already-written) deploy.
    let appliedSettings: string[] = [];
    let settingsError: string | null = null;
    if (Object.keys(plan.settings).length > 0) {
      try {
        const normalized = validatePatch(plan.settings);
        updateSettings(normalized);
        appliedSettings = Object.keys(normalized);
      } catch (e) {
        settingsError = e instanceof Error ? e.message : "invalid methodology settings";
      }
    }
    const scopeKeys = scope.kind === "programme" ? { programmeId: scope.programmeId } : scope.kind === "project" ? { projectId: scope.projectId } : {};
    // Honest caveat: the composition lands AT the chosen scope, but the ruleset + settings engines are
    // org-global — deploying to a nearer scope still applies them org-wide. Surface it so a caller (and the
    // UI) can warn, rather than silently changing the whole org from a "programme" action.
    const orgWideApplied = (plan.ruleset ? ["ruleset"] : []).concat(appliedSettings.length ? ["settings"] : []);
    const scopeNote = scope.kind !== "org" && orgWideApplied.length > 0
      ? `The composition applied to this ${scope.kind}, but its ${orgWideApplied.join(" and ")} applied ORG-WIDE (those engines are org-global).`
      : null;
    return {
      methodologyId: id,
      scope: scope.kind,
      methodologyComposition: resolveMethodologyComposition(scopeKeys),
      appliedRuleset: plan.ruleset?.id ?? null,
      invariants: plan.invariants,
      appliedSettings,
      ...(settingsError ? { settingsError } : {}),
      ...(scopeNote ? { scopeNote } : {}),
    };
  },
  audit: "methodology_deploy",
  auditCategory: "admin",
  auditStatus: 200,
  auditMeta: (_req, { id, plan, scope }, result) => {
    const r = result as { appliedSettings: string[]; settingsError?: string };
    return {
      methodology: id, scope: scope.kind, items: plan.compositionItemIds.length,
      ruleset: plan.ruleset?.id ?? null, invariants: plan.invariants.length,
      settings: r.appliedSettings.length, settingsError: r.settingsError ?? null,
    };
  },
};
mountCommand(router, methodologyDeployCommand);

export default router;
