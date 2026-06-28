import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isActionApproved, approveAction, revokeApprovedAction, listApprovedActions, listApprovedActionRules,
  actionScope, approveTerm, listApprovedVocab, setApproved, __resetApproved, DEFAULT_APPROVED_ACTIONS,
} from "./approved-actions";

/**
 * Customer-wide allowlist: reads approved by default, writes must be explicitly approved.
 */
afterEach(() => __resetApproved());

test("default-safe: read actions approved, write actions NOT", () => {
  assert.equal(isActionApproved("list_projects"), true);
  assert.equal(isActionApproved("get_portfolio_health"), true);
  assert.equal(isActionApproved("update_issue"), false);
  assert.equal(isActionApproved("delete_issue"), false);
  assert.deepEqual(listApprovedActions().sort(), [...DEFAULT_APPROVED_ACTIONS].sort());
});

test("the read-only portfolio copilot action is approved out of the box", () => {
  // Published as an AI action, but read-only, so it ships on the default allowlist.
  assert.equal(isActionApproved("portfolio_copilot"), true);
});

test("an admin can approve (and revoke) a write action", () => {
  approveAction("update_issue");
  assert.equal(isActionApproved("update_issue"), true);
  revokeApprovedAction("update_issue");
  assert.equal(isActionApproved("update_issue"), false);
});

test("vocabulary is curated (trimmed, deduped)", () => {
  approveTerm("Sprint");
  approveTerm("  Sprint  ");
  approveTerm("Epic");
  assert.deepEqual(listApprovedVocab().sort(), ["Epic", "Sprint"]);
});

test("setApproved replaces the whole file (apply a customer-wide allowlist)", () => {
  setApproved({ actions: ["list_projects"], vocab: ["Ticket"] });
  assert.deepEqual(listApprovedActions(), ["list_projects"]);
  assert.equal(isActionApproved("get_portfolio_health"), false); // no longer approved
  assert.deepEqual(listApprovedVocab(), ["Ticket"]);
});

// ── Scoped approvals (the per-surface / per-role / per-backend matrix) ──────────

test("an unscoped approval is allowed in any context", () => {
  approveAction("update_issue"); // no scope = global
  assert.equal(isActionApproved("update_issue", { surface: "settings", role: "viewer", backend: "jira" }), true);
  assert.deepEqual(actionScope("update_issue"), {});
});

test("a surface-scoped approval is allowed only on those surfaces (fail-closed when unknown)", () => {
  approveAction("update_issue", { surfaces: ["projects"] });
  assert.equal(isActionApproved("update_issue", { surface: "projects" }), true);
  assert.equal(isActionApproved("update_issue", { surface: "settings" }), false);
  assert.equal(isActionApproved("update_issue"), false); // no surface in context → denied
});

test("a minRole-scoped approval needs at least that rank", () => {
  approveAction("delete_issue", { minRole: "manager" });
  assert.equal(isActionApproved("delete_issue", { role: "admin" }), true);   // above
  assert.equal(isActionApproved("delete_issue", { role: "manager" }), true); // at
  assert.equal(isActionApproved("delete_issue", { role: "contributor" }), false); // below
  assert.equal(isActionApproved("delete_issue", {}), false); // no role → denied
});

test("a backend-scoped approval is allowed only against those backends", () => {
  approveAction("create_issue", { backends: ["jira"] });
  assert.equal(isActionApproved("create_issue", { backend: "jira" }), true);
  assert.equal(isActionApproved("create_issue", { backend: "servicenow" }), false);
});

test("the full matrix must satisfy every constrained dimension", () => {
  approveAction("update_issue", { surfaces: ["projects"], minRole: "contributor", backends: ["jira"] });
  const ok = { surface: "projects", role: "contributor", backend: "jira" } as const;
  assert.equal(isActionApproved("update_issue", ok), true);
  assert.equal(isActionApproved("update_issue", { ...ok, surface: "reports" }), false);
  assert.equal(isActionApproved("update_issue", { ...ok, role: "viewer" }), false);
  assert.equal(isActionApproved("update_issue", { ...ok, backend: "excel" }), false);
});

test("scopes round-trip through listApprovedActionRules + setApproved(rules)", () => {
  approveAction("update_issue", { surfaces: ["projects"], minRole: "manager" });
  const rules = listApprovedActionRules();
  const rule = rules.find((r) => r.action === "update_issue");
  assert.deepEqual(rule?.scope, { surfaces: ["projects"], minRole: "manager" });
  // Re-apply via setApproved(rules) and confirm enforcement survives.
  setApproved({ rules });
  assert.equal(isActionApproved("update_issue", { surface: "projects", role: "manager" }), true);
  assert.equal(isActionApproved("update_issue", { surface: "projects", role: "viewer" }), false);
});

test("re-approving an action replaces its scope (narrow then widen back to global)", () => {
  approveAction("update_issue", { surfaces: ["projects"] });
  assert.equal(isActionApproved("update_issue", { surface: "settings" }), false);
  approveAction("update_issue"); // widen back to global
  assert.equal(isActionApproved("update_issue", { surface: "settings" }), true);
});

test("an invalid minRole / empty arrays are dropped, leaving an unconstrained scope", () => {
  approveAction("update_issue", { surfaces: [], minRole: "superuser" as never, backends: [] });
  assert.deepEqual(actionScope("update_issue"), {});
  assert.equal(isActionApproved("update_issue", { surface: "anything" }), true);
});
