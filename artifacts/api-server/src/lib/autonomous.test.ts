import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintAutonomousContext, autonomousSub, actorKindOf, assertAutonomousCan, isAutonomous, AutonomousForbidden,
} from "./autonomous";
import { deriveSessionBrokerKey } from "./session-key";
import { sessionMac } from "./provenance";

/**
 * Autonomous actors are keyed, RBAC-roled principals — the same machinery as a human
 * session (per-session key + provenance binding + role gate), never anonymous calls.
 */
test("namespaced identity distinguishes automation from delegated agents", () => {
  assert.equal(autonomousSub({ id: "health-watch" }), "automation:health-watch");
  assert.equal(autonomousSub({ id: "nl-action", onBehalfOf: "alice" }), "agent:nl-action:alice");
  assert.equal(actorKindOf({}), "automation");
  assert.equal(actorKindOf({ onBehalfOf: "alice" }), "agent");
});

test("a minted context is KEYED: it carries a fresh per-session binding", () => {
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" });
  assert.equal(ctx.sub, "automation:health-watch");
  assert.equal(ctx.actorKind, "automation");
  assert.ok(ctx.sessionBind, "autonomous actors get a sessionBind");
  assert.equal(ctx.sessionBind!.sub, ctx.sub);
  // The binding drives a real per-session broker key + a provenance session fingerprint.
  assert.ok(deriveSessionBrokerKey(ctx.sessionBind!).length === 64);
  assert.ok(sessionMac(ctx.sessionBind!));
  assert.ok(isAutonomous(ctx));
});

test("each mint gets fresh entropy ⇒ a distinct key (no key reuse across runs)", () => {
  const a = mintAutonomousContext({ id: "health-watch", role: "viewer" });
  const b = mintAutonomousContext({ id: "health-watch", role: "viewer" });
  assert.notEqual(a.sessionBind!.salt, b.sessionBind!.salt);
  assert.notEqual(deriveSessionBrokerKey(a.sessionBind!), deriveSessionBrokerKey(b.sessionBind!));
});

test("RBAC applies: an actor cannot exceed the role it was granted", () => {
  const contributor = mintAutonomousContext({ id: "nl-action", role: "contributor", onBehalfOf: "alice" });
  // It can do contributor-level work…
  assert.doesNotThrow(() => assertAutonomousCan(contributor, "contributor"));
  // …but NOT admin/pmo-gated work.
  assert.throws(() => assertAutonomousCan(contributor, "admin"), AutonomousForbidden);
  assert.throws(() => assertAutonomousCan(contributor, "manager"), AutonomousForbidden);
});

test("an admin-roled automation clears admin but a pure admin is not a PMO", () => {
  const admin = mintAutonomousContext({ id: "reconciler", role: "admin" });
  assert.doesNotThrow(() => assertAutonomousCan(admin, "admin"));
  assert.doesNotThrow(() => assertAutonomousCan(admin, "manager"));
  assert.throws(() => assertAutonomousCan(admin, "pmo"), AutonomousForbidden);
});

test("a missing role defaults to least privilege (viewer)", () => {
  const ctx = { sub: "automation:x" } as Parameters<typeof assertAutonomousCan>[0];
  assert.doesNotThrow(() => assertAutonomousCan(ctx, "viewer"));
  assert.throws(() => assertAutonomousCan(ctx, "contributor"), AutonomousForbidden);
});
