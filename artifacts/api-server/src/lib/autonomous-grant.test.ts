import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAutonomousWrite, registerAutonomousGrant, setAutonomousGrants, actorIdOf,
  __resetAutonomousGrants, AutonomousWriteDenied,
} from "./autonomous-grant";
import { mintAutonomousContext } from "./autonomous";

/**
 * The anti-backdoor control: autonomous writes are default-deny and tightly scoped by
 * action, project, surface, field and time, with a rate cap and a fresh-session check.
 */
const NOW = 1_700_000_000_000;
afterEach(() => __resetAutonomousGrants());

function actor(role: "viewer" | "contributor" = "contributor", now = NOW) {
  return mintAutonomousContext({ id: "health-watch", role, onBehalfOf: undefined }, now);
}

test("actorIdOf parses the registry id from the principal sub", () => {
  assert.equal(actorIdOf({ sub: "automation:health-watch" }), "health-watch");
  assert.equal(actorIdOf({ sub: "agent:nl-action:alice" }), "nl-action");
  assert.equal(actorIdOf({ sub: "human-1" }), null);
});

test("DEFAULT DENY: an autonomous actor with no grant cannot write", () => {
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW }), AutonomousWriteDenied);
});

test("a human context is not subject to this gate (passes through)", () => {
  const human = { sub: "u1", role: "contributor", actorKind: "human" as const };
  assert.doesNotThrow(() => authorizeAutonomousWrite(human, { action: "update_issue", now: NOW }));
});

test("WHAT: only allow-listed actions are permitted", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  assert.doesNotThrow(() => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW }));
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "delete_issue", now: NOW }), AutonomousWriteDenied);
});

test("WHERE: project + surface scope is enforced", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["P1"], surfaces: ["delivery"] });
  assert.doesNotThrow(() => authorizeAutonomousWrite(actor(), { action: "update_issue", projectId: "P1", surface: "delivery", now: NOW }));
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", projectId: "P2", now: NOW }), AutonomousWriteDenied);
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", projectId: "P1", surface: "finance", now: NOW }), AutonomousWriteDenied);
});

test("WHAT (fine): field scope is enforced", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"], fields: ["status"] });
  assert.doesNotThrow(() => authorizeAutonomousWrite(actor(), { action: "update_issue", fields: ["status"], now: NOW }));
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", fields: ["status", "budget"], now: NOW }), AutonomousWriteDenied);
});

test("HOW LONG: a grant past notAfter is refused", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"], notAfter: NOW + 1000 });
  assert.doesNotThrow(() => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW }));
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW + 5000 }), AutonomousWriteDenied);
});

test("a STALE/expired autonomous session can never write (no old-token backdoor)", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  const old = actor("contributor", NOW); // minted at NOW, 30s TTL
  assert.throws(() => authorizeAutonomousWrite(old, { action: "update_issue", now: NOW + 60_000 }), AutonomousWriteDenied);
});

test("RBAC: a viewer-roled autonomous actor cannot write even with a grant", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  assert.throws(() => authorizeAutonomousWrite(actor("viewer"), { action: "update_issue", now: NOW }), AutonomousWriteDenied);
});

test("rate cap stops a runaway actor", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"], maxWrites: 2 });
  const a = () => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW });
  assert.doesNotThrow(a);
  assert.doesNotThrow(a);
  assert.throws(a, AutonomousWriteDenied); // third write over the cap
});

test("setAutonomousGrants replaces the whole set", () => {
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  setAutonomousGrants([{ actorId: "other", actions: ["update_issue"], projects: ["*"] }]);
  assert.throws(() => authorizeAutonomousWrite(actor(), { action: "update_issue", now: NOW }), AutonomousWriteDenied);
});
