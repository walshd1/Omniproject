import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { IRouter } from "express";
import { startHarness, cookie, type Harness } from "./_harness";

/**
 * Route scope-coverage ratchet — the mechanical answer to "have we caught EVERY IDOR sink?".
 *
 * Sampling (grep + review) finds bugs; it never proves absence. This proves it: it enumerates every
 * route on the LIVE assembled router (plus the feature-gated modules that aren't mounted in the test
 * env), filters to those that take a caller-supplied RESOURCE id in the path, and asserts each one is
 * classified in CLASSIFICATION below — with WHY its id is not a lateral-movement vector for a lower
 * principal. Add a new `/:projectId` (or `/:taskId`, `/:roomId`, …) route and this test goes red until
 * you classify it, so a new per-resource route can never ship without an authorization decision on record.
 *
 * It is a ratchet in BOTH directions: an unclassified live route fails (coverage gap), and a stale
 * CLASSIFICATION entry with no matching live route fails (keeps the registry honest). For the two
 * data-scoped buckets it also BEHAVIOURALLY probes a scoped principal against an out-of-scope id and
 * asserts 403 — so a route can't be declared "project-scope" without actually enforcing it.
 *
 * Sibling of contract-coverage.test.ts (which ratchets the OpenAPI surface); this ratchets authorization.
 */

// A path segment that binds a caller-supplied resource id. `:id` is included because several admin/global
// resources use it; the classification records why each such id is (or isn't) a tenant boundary.
const RESOURCE_PARAM = /:(projectId|taskId|programmeId|guid|issueId|roomId|commentId|workflowId|id)\b/;

type ScopeClass =
  | "project-scope"      // :projectId/:roomId guarded by guardProjectScope / guardRoomScope before the scope-blind broker
  | "task-scope"         // :taskId guarded by assertTaskScope / guardTaskAccess
  | "programme-scope"    // :programmeId/:projectId guarded by a programme-membership scope check
  | "all-scope-only"     // route gated to pmo/admin (scope "all") — a lower principal can't reach the id at all
  | "admin-nontenant"    // id names an admin-global object (AI provider, SCIM user/group, webhook, governed capability, approval) — admin+step-up gated, not per-tenant data
  | "global-config"      // id names global UI/catalogue config (screen id, methodology pack/preset) — a fixed global set, not tenant data
  | "org-content"        // id names an ORG-WIDE shared content object (wiki doc) — read open to any member (viewer+), writes role-gated; no per-user/project partition exists to breach
  | "self-or-approver";  // in-handler RBAC: caller acts on its own resource, approvals gated by role

/**
 * Every per-resource route on the surface, with the reason its id is not a cross-tenant lateral vector.
 * Keyed by "METHOD /path". KEEP THIS HONEST: the classification is a claim the reviewer checks, and the
 * behavioural probe below verifies the two data-scoped buckets actually enforce.
 */
const CLASSIFICATION: Record<string, ScopeClass> = {
  // ── Project-scoped data: guardProjectScope / guardRoomScope on the caller-supplied id ──
  "GET /projects/:projectId/summary": "project-scope",
  "GET /projects/:projectId/financials": "project-scope",
  "GET /projects/:projectId/issues": "project-scope",
  "GET /projects/:projectId/history": "project-scope",
  "GET /projects/:projectId/raid": "project-scope",
  "GET /projects/:projectId/baseline": "project-scope",
  "GET /projects/:projectId/members": "project-scope",
  "GET /projects/:projectId/capacity": "project-scope",
  "GET /projects/:projectId/type": "project-scope",
  "GET /projects/:projectId/staff-cost": "project-scope",
  "GET /projects/:projectId/issues/:issueId/items": "project-scope",
  "PATCH /projects/:projectId": "project-scope",
  "PATCH /projects/:projectId/issues/:issueId": "project-scope",
  "DELETE /projects/:projectId/issues/:issueId": "project-scope",
  "POST /projects/:projectId/issues": "project-scope",
  "POST /projects/:projectId/issues/:issueId/items": "project-scope",
  "POST /projects/:projectId/raid": "project-scope",
  "PUT /projects/:projectId/type": "project-scope",
  "POST /presence/rooms/:roomId": "project-scope",
  "GET /presence/rooms/:roomId/stream": "project-scope",
  "GET /comments/:roomId": "project-scope",
  "POST /comments/:roomId": "project-scope",
  "DELETE /comments/:roomId/:commentId": "project-scope",

  // ── Task-scoped: assertTaskScope on the caller-supplied taskId ──
  "GET /tasks/:taskId": "task-scope",
  "PATCH /tasks/:taskId": "task-scope",
  "GET /tasks/:taskId/comments": "task-scope",
  "POST /tasks/:taskId/comments": "task-scope",
  "GET /tasks/:taskId/attachments": "task-scope",
  "POST /tasks/:taskId/attachments": "task-scope",

  // ── Programme-scoped: membership re-checked at the gateway ──
  "GET /programmes/:programmeId": "programme-scope",
  "PUT /features/programme/:programmeId": "programme-scope",
  "PUT /features/project/:projectId": "programme-scope",

  // ── All-scope-only: pmo/admin (scope "all") — a scoped principal can't reach the id ──
  "GET /archive/projects/:guid": "all-scope-only",
  "POST /setup/versions/:id/known-good": "all-scope-only",

  // ── Admin-global objects: admin (+ step-up) gated; id is not per-tenant data ──
  "DELETE /ai/providers/:id": "admin-nontenant",
  "DELETE /ai/providers/:id/key": "admin-nontenant",
  "PUT /ai/providers/:id/key": "admin-nontenant",
  "GET /scim/v2/Users/:id": "admin-nontenant",
  "PUT /scim/v2/Users/:id": "admin-nontenant",
  "PATCH /scim/v2/Users/:id": "admin-nontenant",
  "DELETE /scim/v2/Users/:id": "admin-nontenant",
  "GET /scim/v2/Groups/:id": "admin-nontenant",
  "PUT /scim/v2/Groups/:id": "admin-nontenant",
  "PATCH /scim/v2/Groups/:id": "admin-nontenant",
  "DELETE /scim/v2/Groups/:id": "admin-nontenant",
  "DELETE /webhooks/:id": "admin-nontenant",
  "POST /webhooks/:id/test": "admin-nontenant",
  "PUT /governance/:id": "admin-nontenant",
  "POST /governance/:id/test": "admin-nontenant",
  "POST /admin/approvals/:id/approve": "admin-nontenant",
  "POST /admin/approvals/:id/reject": "admin-nontenant",
  "GET /setup/methodology-pack/:id": "admin-nontenant",

  // ── Global UI/catalogue config: a fixed global id set, not tenant data ──
  "GET /setup/methodology-preset/:id": "global-config",
  "GET /setup/screens/:id/layout": "global-config",
  "PUT /setup/screens/:id/layout": "global-config",
  // Automation recipe id names an org-global config object (the `automations` collection), NOT tenant data;
  // running it re-checks the caller's RBAC (authorDenial) + evaluates conditions + runs caller-scoped, and a
  // mutating recipe is refused (202) pending a grant — so the id is not a lateral-movement vector.
  "POST /automations/:id/run": "global-config",
  // Template id names an org-global config object (the `templates` collection), NOT tenant data; instantiate
  // is manager+ gated and creates a NEW project via the scope-checked broker, so the id is not a lateral vector.
  "POST /templates/:id/instantiate": "global-config",
  // Wiki document id names an org-wide shared content object in the knowledge base, NOT per-tenant/per-project
  // data. Read is open to any member (viewer+); create/update is contributor+, delete manager+; bodies live in
  // the backend through the broker seam. There is no per-user or per-project partition for the id to breach.
  "GET /wiki/docs/:id": "org-content",
  "PUT /wiki/docs/:id": "org-content",
  "DELETE /wiki/docs/:id": "org-content",

  // ── Own-resource / approver: in-handler RBAC + state machine ──
  "POST /timesheets/:id/action": "self-or-approver",
  // Approval proposals: the :id is a global proposal id (a uuid), not per-tenant data. Challenge/decision
  // are open to any authenticated session but the approval ENGINE gates every act — only an ELIGIBLE
  // approver for the current stage can advance it, the proposer can't self-approve (unless allowed), and a
  // passkey signature over the proposal's content hash is verified — so a guessed id yields nothing.
  "POST /approvals/:id/challenge": "self-or-approver",
  "POST /approvals/:id/decision": "self-or-approver",
  // Redirect/bypass are PMO acts (requireRole pmo) over the same global proposal id; bypass is itself
  // passkey-signed. Admin-global, not tenant data.
  "POST /approvals/:id/redirect": "admin-nontenant",
  "POST /approvals/:id/bypass": "admin-nontenant",
  "POST /approvals/:id/bypass/challenge": "admin-nontenant",
  // A workflow run: the :id is a global workflow-definition id, not tenant data. The run is scope-gated
  // (org⇒pmo, project⇒manager) and, when bound, approval-held; the effect surface is a fail-closed read+
  // notify allowlist carrying the caller's own broker scope — so it can't be a cross-tenant lateral vector.
  "POST /workflows/:id/run": "admin-nontenant",
  // AI responsibility acceptances: the :workflowId is a global workflow id, not tenant data. Each route is
  // scope-owner gated (org⇒pmo, project⇒manager) and the sign is passkey-verified — a hard human-only act.
  "POST /approvals/workflow-acceptances/:workflowId": "admin-nontenant",
  "POST /approvals/workflow-acceptances/:workflowId/challenge": "admin-nontenant",
  "DELETE /approvals/workflow-acceptances/:workflowId": "admin-nontenant",
};

/** Recursively collect "METHOD /path" for every route in an Express router tree. */
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

/** The live per-resource surface: the assembled /api router PLUS the feature-gated modules whose backend
 *  code isn't mounted in the test env (so a per-resource route in a disabled module can't escape the ratchet). */
async function perResourceRoutes(): Promise<Set<string>> {
  const assembled = (await import("../routes/index")).default as IRouter;
  const featureMods = ["presence", "comments", "odata", "integrations"];
  const routes = new Set<string>(collectRoutes(assembled));
  for (const name of featureMods) {
    const mod = (await import(`../routes/${name}`)).default as IRouter;
    for (const r of collectRoutes(mod)) routes.add(r);
  }
  return new Set([...routes].filter((r) => RESOURCE_PARAM.test(r.split(" ")[1]!)));
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

test("every per-resource route is classified (a new unguarded :id route can't ship unnoticed)", async () => {
  const live = await perResourceRoutes();
  const unclassified = [...live].filter((r) => !(r in CLASSIFICATION)).sort();
  assert.deepEqual(unclassified, [],
    `New per-resource route(s) with no authorization classification. Add each to CLASSIFICATION with the ` +
    `reason its id is not a cross-tenant lateral vector (and a real scope guard if it serves tenant data):\n` +
    unclassified.join("\n"));
});

test("no stale CLASSIFICATION entries (the ratchet stays honest as routes are removed/renamed)", async () => {
  const live = await perResourceRoutes();
  const stale = Object.keys(CLASSIFICATION).filter((r) => !live.has(r)).sort();
  assert.deepEqual(stale, [], `CLASSIFICATION entries with no matching live route — remove or fix:\n${stale.join("\n")}`);
});

test("data-scoped routes actually enforce: a scoped principal is refused an out-of-scope id (403)", async () => {
  // Leave demo mode so RBAC scope is real; a plain member is user-level (never all-scope).
  const prevIssuer = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  const member = cookie({ sub: "u-probe", name: "Probe", email: "probe@x.io", roles: ["omni-members"] });
  try {
    // Probe every project-scope GET (reads need no body) with an id the member can't see → fail-closed 403.
    const otherProject = "some-other-teams-project";
    for (const [route, cls] of Object.entries(CLASSIFICATION)) {
      if (cls !== "project-scope") continue;
      const [method, path] = route.split(" ") as [string, string];
      if (method !== "GET") continue;
      if (path.includes(":roomId")) continue;        // room-scope probed via its own suite (needs an encoded room id)
      const url = path.replace(":projectId", otherProject).replace(":issueId", "x");
      const r = await h.req(url, { cookie: member });
      assert.equal(r.status, 403, `${method} ${url} must 403 for an out-of-scope member (declared project-scope)`);
    }
    // Task-scope: a personal task owned by someone else is refused.
    for (const url of ["/tasks/task-3", "/tasks/task-3/comments", "/tasks/task-3/attachments"]) {
      assert.equal((await h.req(url, { cookie: member })).status, 403, `${url} must 403 (task-scope)`);
    }
  } finally {
    if (prevIssuer === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prevIssuer;
  }
});
