import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { IRouter } from "express";
import { startHarness, type Harness } from "./_harness";
import { entityRoutes } from "../lib/entity-pipeline";
import { commandRoutes } from "../lib/action-base";
import { issueEntity } from "../routes/projects";
import { decisionCommand } from "../routes/approvals";

/**
 * WRITE-LANE COVERAGE RATCHET — the mechanical proof that every user-facing WRITE endpoint is guarded.
 *
 * Sibling of route-scope-coverage.test.ts (which ratchets IDOR). This ratchets the "perms + validation +
 * business rules" guarantee via a THREE-LANE partition:
 *   - Lane 1 (entity pipeline, lib/entity-pipeline): CRUD by descriptor — mountEntity applies
 *     RBAC → validate → ruleset → scope → write by construction.
 *   - Lane 2 (action base, lib/action-base): verb/commands by descriptor — mountCommand applies the shell
 *     (authorize → validate → ruleset → run → audit) by construction.
 *   - Lane 3 (BESPOKE_WRITES): hand-written writes not yet migrated to a spine, PLUS the genuinely
 *     irreducible ones (auth/session redirects, SSE, break-glass, SCIM protocol). Each is on record here.
 *
 * The ratchet asserts every live write is in EXACTLY ONE lane. A new POST/PUT/PATCH/DELETE fails the test
 * until it joins a lane (ideally a spine; Lane 3 only for a genuine oddball). Membership in Lane 1/2 IS the
 * guarantee — the mounter can't skip a gate — so the ratchet only has to verify the partition. As routes
 * migrate onto the spines they LEAVE Lane 3, so the bespoke list only shrinks (the stale-entry test forces
 * a converted route out of it). This is how the step-2 spines get enforced instead of drifting.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectRoutes(router: IRouter): string[] {
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        const p = prefix + layer.route.path;
        const methods = Object.keys(layer.route.methods ?? {}).filter((m) => layer.route.methods[m]);
        for (const m of methods) out.push(`${m.toUpperCase()} ${p}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walk((router as any).stack, "");
  return out;
}

const WRITE = /^(POST|PUT|PATCH|DELETE) /;

/** Every live WRITE route on the assembled /api router PLUS the feature-gated modules not mounted in test. */
async function writeRoutes(): Promise<Set<string>> {
  const assembled = (await import("../routes/index")).default as IRouter;
  const featureMods = ["presence", "comments", "collab", "whiteboard", "proofs", "odata", "integrations"];
  const routes = new Set<string>(collectRoutes(assembled));
  for (const name of featureMods) {
    const mod = (await import(`../routes/${name}`)).default as IRouter;
    for (const r of collectRoutes(mod)) routes.add(r);
  }
  return new Set([...routes].filter((r) => WRITE.test(r)));
}

// Lane 1 + Lane 2 — derived from the registered descriptors (the routes the spines own).
const LANE1 = new Set<string>(entityRoutes(issueEntity));
const LANE2 = new Set<string>(commandRoutes(decisionCommand));

// Lane 3 — hand-written writes not (yet) on a spine. SEED — regenerate by running the first test with this
// empty and pasting its "uncovered" list. New writes must join a lane; this list may only SHRINK.
const BESPOKE_WRITES = new Set<string>([
  "DELETE /ai/providers/:id",
  "DELETE /ai/providers/:id/key",
  "DELETE /approvals/workflow-acceptances/:workflowId",
  "DELETE /branding",
  "DELETE /comments/:roomId/:commentId",
  "DELETE /dev-mode/entitlements",
  "DELETE /dev-mode/impersonate",
  "DELETE /projects/:projectGuid/links",
  "DELETE /projects/:projectId/mapping/:slot/:rowId",
  "DELETE /proofs/:id",
  "DELETE /scim/v2/Groups/:id",
  "DELETE /scim/v2/Users/:id",
  "DELETE /users/:id",
  "DELETE /users/:id/password",
  "DELETE /webhooks/:id",
  "DELETE /whiteboards/:id",
  "DELETE /wiki/docs/:id",
  "PATCH /availability/curation",
  "PATCH /projects/:projectId",
  "PATCH /scim/v2/Groups/:id",
  "PATCH /scim/v2/Users/:id",
  "PATCH /settings",
  "PATCH /tasks/:taskId",
  "PATCH /users/:id",
  "POST /admin/approvals/:id/approve",
  "POST /admin/approvals/:id/reject",
  "POST /admin/digest/run",
  "POST /admin/drift-canary/run",
  "POST /admin/proactive-digest/run",
  "POST /admin/raw",
  "POST /admin/role-map/rollback",
  "POST /admin/ruleset/apply-reference",
  "POST /admin/scheduled-export/run",
  "POST /admin/system-defs/apply",
  "POST /ai/chat",
  "POST /ai/copilot",
  "POST /ai/estimate",
  "POST /ai/insights",
  "POST /ai/nl-action",
  "POST /ai/providers",
  "POST /ai/providers/rollback",
  "POST /ai/rebalance",
  "POST /ai/suggest-backend",
  "POST /ai/transcribe",
  "POST /approvals/:id/bypass",
  "POST /approvals/:id/bypass/challenge",
  "POST /approvals/:id/challenge",
  "POST /approvals/:id/redirect",
  "POST /approvals/passkey",
  "POST /approvals/passkey/revoke",
  "POST /approvals/passkey/revoke-all",
  "POST /approvals/workflow-acceptances/:workflowId",
  "POST /approvals/workflow-acceptances/:workflowId/challenge",
  "POST /auth/local",
  "POST /auth/local/bootstrap",
  "POST /auth/logout",
  "POST /auth/magic/request",
  "POST /auth/passkey/step-up",
  "POST /auth/passkey/step-up/challenge",
  "POST /auth/saml/callback",
  "POST /auth/step-up",
  "POST /automations/:id/run",
  "POST /automations/preview",
  "POST /break-glass/lockdown",
  "POST /break-glass/release",
  "POST /broker/command",
  "POST /client-errors",
  "POST /collab/rooms/:roomId",
  "POST /comments/:roomId",
  "POST /deployment-types/:id/resolve",
  "POST /dev-mode/broker",
  "POST /dev-mode/entitlements",
  "POST /dev-mode/impersonate",
  "POST /dev-mode/messy",
  "POST /forms/:formId/submit",
  "POST /governance/:id/test",
  "POST /health-watch/run",
  "POST /history/dispose",
  "POST /history/erase",
  "POST /import/commit",
  "POST /import/preview",
  "POST /labels/apply-preset",
  "POST /mcp",
  "POST /methodology-composition/deploy/:id",
  "POST /notifications/ingest",
  "POST /portal/invites",
  "POST /presence/rooms/:roomId",
  "POST /presets/:id/apply",
  "POST /projects",
  "POST /projects/:projectGuid/close",
  "POST /projects/:projectId/issues/:issueId/items",
  "POST /projects/:projectId/raid",
  "POST /proofs",
  "POST /proofs/:id/decision",
  "POST /provenance/call/:callId/verify",
  "POST /rate-card/rollback",
  "POST /scim/v2/Groups",
  "POST /scim/v2/Users",
  "POST /security/audit/log/dispose",
  "POST /security/audit/verify",
  "POST /security/config/export",
  "POST /security/data-residency/validate",
  "POST /security/keys/:name/revoke",
  "POST /security/sessions/revoke-user",
  "POST /setup/charity-onboarding",
  "POST /setup/config-diff",
  "POST /setup/config-dir/clear-backup",
  "POST /setup/config-dir/refresh",
  "POST /setup/connections/test",
  "POST /setup/connections/vault",
  "POST /setup/defs-import",
  "POST /setup/environments",
  "POST /setup/environments/activate",
  "POST /setup/full-restore",
  "POST /setup/generate-workflow",
  "POST /setup/instance-key/reveal",
  "POST /setup/instance-key/rotate",
  "POST /setup/portable-restore",
  "POST /setup/profile",
  "POST /setup/promote",
  "POST /setup/restore",
  "POST /setup/rollback",
  "POST /setup/self-host",
  "POST /setup/test-broker",
  "POST /setup/verify-workflow",
  "POST /setup/versions/:id/known-good",
  "POST /snapshots/capture",
  "POST /snapshots/verify",
  "POST /tasks",
  "POST /tasks/:taskId/attachments",
  "POST /tasks/:taskId/comments",
  "POST /tasks/reminders/sweep",
  "POST /templates/:id/instantiate",
  "POST /timesheets",
  "POST /timesheets/:id/action",
  "POST /usage/notify",
  "POST /users",
  "POST /users/:id/password",
  "POST /webhooks",
  "POST /webhooks/:id/test",
  "POST /whiteboards",
  "POST /whiteboards/rooms/:roomId",
  "POST /wiki/docs",
  "POST /workflows/:id/run",
  "PUT /accessibility-defaults",
  "PUT /admin/custom-roles",
  "PUT /admin/delegation-policy",
  "PUT /admin/maintenance",
  "PUT /admin/role-map",
  "PUT /admin/ruleset",
  "PUT /admin/ruleset/fields",
  "PUT /admin/ruleset/scope",
  "PUT /ai/capabilities/:cap",
  "PUT /ai/model-allowlist",
  "PUT /ai/provider-allowlist",
  "PUT /ai/providers/:id/key",
  "PUT /ai/stt-provider-allowlist",
  "PUT /approval-chains",
  "PUT /automations",
  "PUT /branding",
  "PUT /broker-kinds",
  "PUT /budget-plans",
  "PUT /calendar/push",
  "PUT /closed-projects",
  "PUT /collection-edit-roles",
  "PUT /content-pages",
  "PUT /custom-fields",
  "PUT /dashboards",
  "PUT /deployment-type",
  "PUT /disabled-screens",
  "PUT /energy-vocabulary",
  "PUT /error-telemetry",
  "PUT /features/governance-rules",
  "PUT /features/programme/:programmeId",
  "PUT /features/project/:projectId",
  "PUT /federated-peers",
  "PUT /field-validation",
  "PUT /forms",
  "PUT /governance/:id",
  "PUT /governance/ai-kill",
  "PUT /governance/approved",
  "PUT /governance/containment",
  "PUT /guid-aliases",
  "PUT /history/retention",
  "PUT /impact-vocabulary",
  "PUT /labels",
  "PUT /likelihood-vocabulary",
  "PUT /logging-sync",
  "PUT /me/prefs",
  "PUT /methodology-composition",
  "PUT /org-identity",
  "PUT /panel-views",
  "PUT /portfolio/priority-weights",
  "PUT /priority-labels",
  "PUT /programme-registry",
  "PUT /projects/:projectId/mapping/:slot/:rowId",
  "PUT /projects/:projectId/type",
  "PUT /projects/:projectId/wbs/:wbsId",
  "PUT /proofs/:id",
  "PUT /raci",
  "PUT /rag-vocabulary",
  "PUT /rate-card",
  "PUT /rate-card/cost-rules",
  "PUT /rate-card/identities",
  "PUT /rate-card/uplift/:level/:scopeId",
  "PUT /reports",
  "PUT /reports/custom",
  "PUT /reports/overrides",
  "PUT /resource-allocations",
  "PUT /routing",
  "PUT /scheduling",
  "PUT /scim/v2/Groups/:id",
  "PUT /scim/v2/Users/:id",
  "PUT /screen-defs",
  "PUT /screen-layouts",
  "PUT /settings/scope",
  "PUT /setup/screens/:id/layout",
  "PUT /severity-vocabulary",
  "PUT /stakeholders",
  "PUT /task-vocabulary",
  "PUT /templates",
  "PUT /usage/policies",
  "PUT /views",
  "PUT /whiteboards/:id",
  "PUT /wiki/docs/:id",
  "PUT /work-vocabulary",
  "PUT /workflows",
]);

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

test("every live write route is in exactly one lane (a new unguarded write can't ship unnoticed)", async () => {
  const live = await writeRoutes();
  const covered = new Set<string>([...LANE1, ...LANE2, ...BESPOKE_WRITES]);
  const uncovered = [...live].filter((r) => !covered.has(r)).sort();
  assert.deepEqual(uncovered, [],
    `New write route(s) in no lane. Put each in the entity pipeline (Lane 1: mountEntity), the action base ` +
    `(Lane 2: mountCommand), or — only for a genuinely irreducible one — BESPOKE_WRITES (Lane 3):\n${uncovered.join("\n")}`);
});

test("no stale lane entries (converting a route to a spine forces it out of Lane 3)", async () => {
  const live = await writeRoutes();
  const stale = [...LANE1, ...LANE2, ...BESPOKE_WRITES].filter((r) => !live.has(r)).sort();
  assert.deepEqual(stale, [], `Lane entry with no live write route — remove or fix:\n${stale.join("\n")}`);
});

test("the lanes are disjoint — each write is in exactly one", () => {
  const overlap = [
    ...[...LANE1].filter((r) => LANE2.has(r) || BESPOKE_WRITES.has(r)),
    ...[...LANE2].filter((r) => BESPOKE_WRITES.has(r)),
  ].sort();
  assert.deepEqual(overlap, [], `route(s) in more than one lane:\n${overlap.join("\n")}`);
});
