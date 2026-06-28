import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mintAutonomousContext, autonomousSub, actorKindOf, assertAutonomousCan, isAutonomous,
  assertMintFresh, autonomousTtlMs, registerAutonomousActor, authorizedRole, AutonomousForbidden, AutonomousMintDenied,
} from "./autonomous";
import { deriveSessionBrokerKey } from "./session-key";
import { sessionMac } from "./provenance";

/**
 * Autonomous actors are keyed, RBAC-roled principals — the same machinery as a human
 * session (per-session key + provenance binding + role gate), never anonymous calls.
 * The minter is privileged: allowlist-gated and time-bound.
 */
const NOW = 1_700_000_000_000;

test("namespaced identity distinguishes automation from delegated agents", () => {
  assert.equal(autonomousSub({ id: "health-watch" }), "automation:health-watch");
  assert.equal(autonomousSub({ id: "nl-action", onBehalfOf: "alice" }), "agent:nl-action:alice");
  assert.equal(actorKindOf({}), "automation");
  assert.equal(actorKindOf({ onBehalfOf: "alice" }), "agent");
});

test("a minted context is KEYED + time-stamped with the invocation time", () => {
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" }, NOW);
  assert.equal(ctx.sub, "automation:health-watch");
  assert.equal(ctx.actorKind, "automation");
  assert.equal(ctx.issuedAt, NOW);
  assert.ok(ctx.sessionBind, "autonomous actors get a sessionBind");
  assert.equal(ctx.sessionBind!.sub, ctx.sub);
  // The binding drives a real per-session broker key + a provenance session fingerprint.
  assert.ok(deriveSessionBrokerKey(ctx.sessionBind!).length === 64);
  assert.ok(sessionMac(ctx.sessionBind!));
  assert.ok(isAutonomous(ctx));
});

test("each mint gets fresh entropy ⇒ a distinct key (no key reuse across runs)", () => {
  const a = mintAutonomousContext({ id: "health-watch", role: "viewer" }, NOW);
  const b = mintAutonomousContext({ id: "health-watch", role: "viewer" }, NOW + 1);
  assert.notEqual(a.sessionBind!.salt, b.sessionBind!.salt);
  assert.notEqual(deriveSessionBrokerKey(a.sessionBind!), deriveSessionBrokerKey(b.sessionBind!));
});

test("KNOWN SOURCE ONLY: an unregistered actor id cannot be minted", () => {
  assert.equal(authorizedRole("totally-unknown"), undefined);
  assert.throws(() => mintAutonomousContext({ id: "totally-unknown", role: "viewer" }, NOW), AutonomousMintDenied);
});

test("the requested role may not exceed the registered cap", () => {
  // portfolio-copilot is capped at viewer.
  assert.equal(authorizedRole("portfolio-copilot"), "viewer");
  assert.throws(() => mintAutonomousContext({ id: "portfolio-copilot", role: "admin" }, NOW), AutonomousMintDenied);
  assert.doesNotThrow(() => mintAutonomousContext({ id: "portfolio-copilot", role: "viewer" }, NOW));
});

test("TIME-BOUND: an invalid/absent invocation time is refused", () => {
  assert.throws(() => mintAutonomousContext({ id: "health-watch", role: "viewer" }, 0), AutonomousMintDenied);
  assert.throws(() => mintAutonomousContext({ id: "health-watch", role: "viewer" }, NaN), AutonomousMintDenied);
});

test("assertMintFresh accepts a just-minted context and rejects stale/future ones", () => {
  const ctx = mintAutonomousContext({ id: "health-watch", role: "viewer" }, NOW);
  assert.doesNotThrow(() => assertMintFresh(ctx, NOW + 1_000)); // 1s later, fresh
  assert.throws(() => assertMintFresh(ctx, NOW + 60_000), AutonomousMintDenied); // 60s later, stale
  assert.throws(() => assertMintFresh(ctx, NOW - 1_000), AutonomousMintDenied); // before it was minted
  assert.throws(() => assertMintFresh({}, NOW), AutonomousMintDenied); // no stamp at all
});

test("autonomous sessions are SHORT by design: default 30s TTL + an expiry stamp", () => {
  assert.equal(autonomousTtlMs(), 30_000);
  const ctx = mintAutonomousContext({ id: "health-watch", role: "viewer" }, NOW);
  assert.equal(ctx.expiresAt, NOW + 30_000);
  // Past the expiry it is rejected even if a generous maxAge were passed.
  assert.throws(() => assertMintFresh(ctx, NOW + 31_000, 10 * 60_000), AutonomousMintDenied);
});

test("the TTL is configurable but hard-clamped so it can never be made long-lived", () => {
  process.env["AUTONOMOUS_SESSION_SECONDS"] = "10";
  assert.equal(autonomousTtlMs(), 10_000);
  process.env["AUTONOMOUS_SESSION_SECONDS"] = "99999"; // clamped down to the 5-min ceiling
  assert.equal(autonomousTtlMs(), 300_000);
  process.env["AUTONOMOUS_SESSION_SECONDS"] = "1"; // clamped up to the 5s floor
  assert.equal(autonomousTtlMs(), 5_000);
});

afterEach(() => { delete process.env["AUTONOMOUS_SESSION_SECONDS"]; });

test("registerAutonomousActor admits a new known source (admin/config)", () => {
  registerAutonomousActor("nightly-rollup", "manager");
  assert.doesNotThrow(() => mintAutonomousContext({ id: "nightly-rollup", role: "manager" }, NOW));
});

test("RBAC applies: an actor cannot exceed the role it was granted", () => {
  const contributor = mintAutonomousContext({ id: "nl-action", role: "contributor", onBehalfOf: "alice" }, NOW);
  assert.doesNotThrow(() => assertAutonomousCan(contributor, "contributor"));
  assert.throws(() => assertAutonomousCan(contributor, "admin"), AutonomousForbidden);
  assert.throws(() => assertAutonomousCan(contributor, "manager"), AutonomousForbidden);
});

test("a missing role defaults to least privilege (viewer)", () => {
  const ctx = { sub: "automation:x" } as Parameters<typeof assertAutonomousCan>[0];
  assert.doesNotThrow(() => assertAutonomousCan(ctx, "viewer"));
  assert.throws(() => assertAutonomousCan(ctx, "contributor"), AutonomousForbidden);
});
