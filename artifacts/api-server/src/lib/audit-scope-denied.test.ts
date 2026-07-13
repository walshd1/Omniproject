import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { auditScopeDenied, shouldAudit } from "./audit";
import { auditAnchor } from "./audit-chain";

/**
 * Scope-denial auditing (lateral-movement visibility). A cross-scope access attempt must be RECORDED,
 * not just refused with a silent 403, so an operator can alert on a burst of them from one actor.
 */

/** A minimal unauthenticated request shape — auditScopeDenied only reads method/originalUrl + session. */
function fakeReq(method: string, url: string): Request {
  return { method, originalUrl: url, signedCookies: {}, cookies: {} } as unknown as Request;
}

test("the 'security' category is always recorded, even at AUDIT_LEVEL=writes", () => {
  assert.equal(shouldAudit("writes", { category: "security" }), true);
  assert.equal(shouldAudit("off", { category: "security" }), false); // 'off' still silences everything
});

test("auditScopeDenied records an event: the tamper-evident chain advances", () => {
  // A scoped GET 403 records ONLY the security event (a non-write GET isn't audited at level 'writes'),
  // so the chain head advancing proves the denial was sealed into the audit trail.
  const before = auditAnchor().seq;
  auditScopeDenied(fakeReq("GET", "/api/projects/other-teams-project/summary"), "project", "other-teams-project", "project not in your scope");
  const after = auditAnchor().seq;
  assert.ok(after > before, `expected the audit chain to advance (${before} → ${after})`);
});

test("auditScopeDenied handles task and room kinds without throwing", () => {
  const s0 = auditAnchor().seq;
  auditScopeDenied(fakeReq("POST", "/api/comments/project:x"), "room", "project:x", "room not in your scope");
  auditScopeDenied(fakeReq("GET", "/api/tasks/task-x"), "task", "task-x", "task not in your scope");
  assert.ok(auditAnchor().seq >= s0 + 2);
});
