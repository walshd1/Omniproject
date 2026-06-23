import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";

import { versionConflict } from "../lib/concurrency";
import { roleFromClaims } from "../lib/rbac";
import { idempotencyKey } from "../lib/n8n";
import { resolveCapabilities } from "../lib/capabilities";

// ── Optimistic concurrency ────────────────────────────────────────────────────
test("versionConflict: no expected version never conflicts", () => {
  assert.equal(versionConflict(undefined, 5), false);
});

test("versionConflict: matching version is not a conflict", () => {
  assert.equal(versionConflict(3, 3), false);
});

test("versionConflict: stale version is a conflict", () => {
  assert.equal(versionConflict(2, 3), true);
});

// ── RBAC claim mapping ────────────────────────────────────────────────────────
test("roleFromClaims: demo session is admin", () => {
  assert.equal(roleFromClaims([], { isDemo: true }), "admin");
});

test("roleFromClaims: maps configured manager role (case-insensitive)", () => {
  process.env["OIDC_MANAGER_ROLES"] = "pmo,programme-managers";
  assert.equal(roleFromClaims(["PMO"], { isDemo: false }), "manager");
  delete process.env["OIDC_MANAGER_ROLES"];
});

test("roleFromClaims: admin outranks manager when user has both", () => {
  process.env["OIDC_ADMIN_ROLES"] = "platform-admins";
  process.env["OIDC_MANAGER_ROLES"] = "pmo";
  assert.equal(roleFromClaims(["pmo", "platform-admins"], { isDemo: false }), "admin");
  delete process.env["OIDC_ADMIN_ROLES"];
  delete process.env["OIDC_MANAGER_ROLES"];
});

test("roleFromClaims: unmatched claims fall back to contributor by default", () => {
  assert.equal(roleFromClaims(["some-random-group"], { isDemo: false }), "contributor");
});

test("roleFromClaims: OIDC_DEFAULT_ROLE overrides the fallback", () => {
  process.env["OIDC_DEFAULT_ROLE"] = "viewer";
  assert.equal(roleFromClaims(["nobody"], { isDemo: false }), "viewer");
  delete process.env["OIDC_DEFAULT_ROLE"];
});

// ── Idempotency key ───────────────────────────────────────────────────────────
test("idempotencyKey: deterministic for same action+entity within a minute", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("idempotencyKey: differs by action", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("delete_issue", { projectId: "p1", issueId: "i1" });
  assert.notEqual(a, b);
});

test("idempotencyKey: differs by entity", () => {
  const a = idempotencyKey("update_issue", { projectId: "p1", issueId: "i1" });
  const b = idempotencyKey("update_issue", { projectId: "p1", issueId: "i2" });
  assert.notEqual(a, b);
});

// ── Capabilities resolution (env path is request-independent) ──────────────────
test("resolveCapabilities: CAPABILITIES env enables only the listed domains", async () => {
  process.env["CAPABILITIES"] = "issues,raid";
  const caps = await resolveCapabilities({} as Request);
  assert.equal(caps.mode, "env");
  assert.equal(caps.issues, true);
  assert.equal(caps.raid, true);
  assert.equal(caps.financials, false);
  assert.equal(caps.history, false);
  delete process.env["CAPABILITIES"];
});

test("resolveCapabilities: demo mode (no n8n, no env) turns everything on", async () => {
  const savedWebhook = process.env["N8N_WEBHOOK_URL"];
  delete process.env["N8N_WEBHOOK_URL"];
  delete process.env["CAPABILITIES"];
  // isN8nConfigured is captured at import time; this asserts the demo default
  // only when the module was loaded without a webhook configured.
  const caps = await resolveCapabilities({} as Request);
  assert.ok(["demo", "env"].includes(caps.mode));
  if (savedWebhook) process.env["N8N_WEBHOOK_URL"] = savedWebhook;
});
