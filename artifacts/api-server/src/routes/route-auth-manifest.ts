/**
 * ROUTE-AUTH MANIFEST — the declarative record of how every MUTATING route (POST/PUT/PATCH/DELETE) that does
 * NOT carry a per-route authorization middleware is nonetheless gated. It is the companion to
 * `scripts/src/guard-route-grants.ts`, which makes the "no mutating route silently escapes the auth net"
 * invariant (IAM assessment gap S6) checkable in CI.
 *
 * The vast majority of mutating routes declare their requirement inline — `requireRole("pmo")`,
 * `requireAuth`, `requireAnyRole(...)`, `requireStepUp`, etc. — as express middleware, which the guard reads
 * directly off the route table. A minority are gated a different, deliberate way (a pre-authentication entry
 * point, a signature-verified webhook, a mount-level token gate, an in-handler session/role check, or a
 * stateless verify/resolve that persists nothing). Those are enumerated here, each with a `posture` and a
 * human `reason`, so the exception is a CONSCIOUS, reviewed decision rather than an oversight. A NEW mutating
 * route that neither carries a recognised middleware gate nor appears here fails the guard until someone
 * classifies it — that is the whole point.
 *
 * This is pure data (no imports, no I/O) so both the guard and any future runtime self-check can consume it.
 * Keep it sorted by file then path. When you add/remove/relabel a route, update this list in the same change.
 */

/** How a manifest-listed mutating route is authorised, given it carries no per-route auth middleware. */
export type RouteAuthPosture =
  /** Pre-authentication entry point (login / logout / magic-link / SSO callback / first-run bootstrap): it
   *  CANNOT require a prior session because it is how a session is established (or torn down). */
  | "public"
  /** Inbound webhook authenticated by a payload signature (HMAC / provider secret), not a user session. */
  | "signature-webhook"
  /** Authorised by a router-level gate mounted with `router.use(...)` for the whole surface, rather than a
   *  per-route middleware (e.g. the SCIM bearer-token gate). */
  | "mount-gate"
  /** Enforces an authenticated session / role imperatively inside the handler (getSession/actorFor/readSession
   *  /hasRole → 401/403) instead of via a declarative middleware. */
  | "in-handler"
  /** Stateless: verifies / resolves / previews and returns a result but persists NOTHING, so it is not a
   *  privileged mutation despite the POST verb. */
  | "stateless";

export interface RouteAuthException {
  /** Route file basename under artifacts/api-server/src/routes (e.g. "auth.ts"). */
  file: string;
  /** HTTP method, lowercase. */
  method: "post" | "put" | "patch" | "delete";
  /** The route path literal exactly as written, or "(dynamic)" when the path is a variable. */
  path: string;
  posture: RouteAuthPosture;
  /** Why this mutating route is safe without a per-route auth middleware. */
  reason: string;
}

/**
 * The mutating routes that are intentionally gated OTHER than by a per-route auth middleware. Every entry is
 * reviewed; the guard fails if a mutating route is missing from BOTH this list and the middleware set, and
 * flags any entry here that has since grown a middleware gate or no longer exists (so the list cannot rot).
 */
export const ROUTE_AUTH_EXCEPTIONS: readonly RouteAuthException[] = [
  // AI surface — the AI-governance capability enforcer (enforceOr403) + provider allowlist gate every call
  // in-handler; there is no static role because eligibility is per-capability and per-surface.
  { file: "ai.ts", method: "post", path: "/ai/chat", posture: "in-handler", reason: "AI capability enforcer (enforceOr403) + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/nl-action", posture: "in-handler", reason: "AI capability enforcer + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/copilot", posture: "in-handler", reason: "AI capability enforcer + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/insights", posture: "in-handler", reason: "AI capability enforcer + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/estimate", posture: "in-handler", reason: "AI capability enforcer + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/rebalance", posture: "in-handler", reason: "AI capability enforcer + provider governance gate the call in-handler" },
  { file: "ai.ts", method: "post", path: "/ai/transcribe", posture: "in-handler", reason: "AI STT capability enforcer + provider governance gate the call in-handler" },

  // Approvals — each handler resolves the actor (getSession/actorFor) and 401s when unauthenticated; the
  // passkey/challenge flows additionally bind to that actor.
  { file: "approvals.ts", method: "post", path: "/approvals/passkey", posture: "in-handler", reason: "getSession → 401 when unauthenticated; binds the passkey to the session subject" },
  { file: "approvals.ts", method: "post", path: "/approvals/:id/challenge", posture: "in-handler", reason: "actorFor → 401 when unauthenticated" },
  { file: "approvals.ts", method: "post", path: "/approvals/workflow-acceptances/:workflowId/challenge", posture: "in-handler", reason: "actorFor → 401 when unauthenticated" },
  { file: "approvals.ts", method: "post", path: "/approvals/workflow-acceptances/:workflowId", posture: "in-handler", reason: "getSession → 401 when unauthenticated" },
  { file: "approvals.ts", method: "delete", path: "/approvals/workflow-acceptances/:workflowId", posture: "in-handler", reason: "workflow-scope gate in-handler" },

  // Auth surface — the entry/exit points of a session.
  { file: "auth.ts", method: "post", path: "/auth/saml/callback", posture: "public", reason: "SAML IdP POST-back — pre-session by definition; the assertion is the credential" },
  { file: "auth.ts", method: "post", path: "/auth/magic/request", posture: "public", reason: "magic-link request — pre-session; rate-limited, no session to require" },
  { file: "auth.ts", method: "post", path: "/auth/local", posture: "public", reason: "username/password login — pre-session; the credentials are the auth" },
  { file: "auth.ts", method: "post", path: "/auth/local/bootstrap", posture: "public", reason: "first-run admin bootstrap — gated by the no-users-yet precondition, pre-session" },
  { file: "auth.ts", method: "post", path: "/auth/passkey/step-up/challenge", posture: "in-handler", reason: "readSession → 401; steps up an EXISTING session" },
  { file: "auth.ts", method: "post", path: "/auth/passkey/step-up", posture: "in-handler", reason: "readSession → 401; steps up an EXISTING session" },
  { file: "auth.ts", method: "post", path: "/auth/logout", posture: "public", reason: "clears the session cookie — safe and idempotent with or without a session" },
  { file: "auth.ts", method: "post", path: "/auth/step-up", posture: "in-handler", reason: "readSession → 401; elevates an EXISTING session" },

  // Automations preview/run — the handler enforces the automation permission (denial → 403) and resolves the actor.
  { file: "automations.ts", method: "post", path: "/automations/preview", posture: "in-handler", reason: "automation-permission denial → 403 in-handler; preview only" },
  { file: "automations.ts", method: "post", path: "/automations/:id/run", posture: "in-handler", reason: "automation-permission denial → 403 in-handler" },

  // Billing webhook — inbound provider callback, authenticated by the payload signature, not a session.
  { file: "billing-webhook.ts", method: "post", path: "/invoices/billing-webhook", posture: "signature-webhook", reason: "inbound billing webhook — verified by payload signature, no user session" },
  { file: "billing-webhook.ts", method: "post", path: "(dynamic)", posture: "signature-webhook", reason: "the same webhook handler mounted at a configured path — signature-verified" },

  // Client-error + telemetry ingest — opt-in, best-effort, drops silently when disabled.
  { file: "client-errors.ts", method: "post", path: "/client-errors", posture: "public", reason: "opt-in client error telemetry ingest; accepted-and-dropped when the admin has not opted in" },

  // Comments delete — room/comment scoped in-handler.
  { file: "comments.ts", method: "delete", path: "/comments/:roomId/:commentId", posture: "in-handler", reason: "room + comment scope resolved and checked in-handler" },

  // Deployment-type resolve — a pure resolver (answers → deployment type); persists nothing.
  { file: "deployment-types.ts", method: "post", path: "/deployment-types/:id/resolve", posture: "stateless", reason: "pure resolver (answers → deployment type); returns a result, mutates nothing" },

  // Dev-mode stop-impersonation — behind the requireDevMode environment gate; reads the real session.
  { file: "dev-mode.ts", method: "delete", path: "/dev-mode/impersonate", posture: "in-handler", reason: "requireDevMode env gate + reads the real session; stops impersonation (de-escalation)" },

  // MCP endpoint — session OR a valid API token, checked in-handler.
  { file: "mcp.ts", method: "post", path: "/mcp", posture: "in-handler", reason: "getSession || valid API token → 401 in-handler" },

  // Presence heartbeat — ephemeral room presence; no durable record.
  { file: "presence.ts", method: "post", path: "/presence/rooms/:roomId", posture: "in-handler", reason: "ephemeral presence heartbeat; session + client id checked in-handler, nothing durable persisted" },

  // SCIM v2 — the whole /scim/v2 surface is behind a mount-level bearer-token gate (router.use scimAuth).
  { file: "scim.ts", method: "post", path: "/scim/v2/Users", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "put", path: "/scim/v2/Users/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "patch", path: "/scim/v2/Users/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "delete", path: "/scim/v2/Users/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "post", path: "/scim/v2/Groups", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "put", path: "/scim/v2/Groups/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "patch", path: "/scim/v2/Groups/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },
  { file: "scim.ts", method: "delete", path: "/scim/v2/Groups/:id", posture: "mount-gate", reason: "SCIM v2 bearer-token gate mounted via router.use(scimAuth)" },

  // Snapshot verify — verifies a supplied bundle's signature/manifest; persists nothing.
  { file: "snapshots.ts", method: "post", path: "/snapshots/verify", posture: "stateless", reason: "verifies a supplied snapshot bundle; returns a verdict, mutates nothing" },

  // Workflow run — role required is dynamic (per workflow scope), enforced in-handler.
  { file: "workflows.ts", method: "post", path: "/workflows/:id/run", posture: "in-handler", reason: "hasRole(req, need) → 403 and session sub → 401 in-handler; the required role is per-workflow-scope" },
];
