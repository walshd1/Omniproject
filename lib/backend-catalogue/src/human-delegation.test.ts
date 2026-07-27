import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDelegatedAccess, activeDelegationsFor, cleanDelegation, type HumanDelegation } from "./human-delegation";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed epoch ms — no Date() anywhere
const daysFromNow = (n: number) => NOW + n * DAY;

const base: HumanDelegation = {
  id: "d1",
  fromSubjectId: "alice",
  toSubjectId: "bob",
  capabilities: ["approve_payment"],
  notBefore: daysFromNow(-1),
  notAfter: daysFromNow(13),
};

test("an active, in-scope delegation authorises the delegatee", () => {
  const r = resolveDelegatedAccess([base], { toSubjectId: "bob", capability: "approve_payment", now: NOW });
  assert.deepEqual(r, { allowed: true, delegationId: "d1", reason: null });
});

test("the wrong delegatee is denied (default-deny)", () => {
  const r = resolveDelegatedAccess([base], { toSubjectId: "carol", capability: "approve_payment", now: NOW });
  assert.equal(r.allowed, false);
  assert.equal(r.delegationId, null);
});

test("a capability outside the delegation is denied", () => {
  const r = resolveDelegatedAccess([base], { toSubjectId: "bob", capability: "delete_ledger", now: NOW });
  assert.equal(r.allowed, false);
});

test("a wildcard capability authorises anything", () => {
  const d: HumanDelegation = { ...base, capabilities: ["*"] };
  const r = resolveDelegatedAccess([d], { toSubjectId: "bob", capability: "anything_at_all", now: NOW });
  assert.equal(r.allowed, true);
});

test("a delegation not yet active, or already expired, is denied", () => {
  const notYet = resolveDelegatedAccess([{ ...base, notBefore: daysFromNow(1) }], { toSubjectId: "bob", capability: "approve_payment", now: NOW });
  assert.equal(notYet.allowed, false);
  assert.equal(notYet.reason, "no active delegation grants this capability");
  const expired = resolveDelegatedAccess([{ ...base, notAfter: daysFromNow(-1) }], { toSubjectId: "bob", capability: "approve_payment", now: NOW });
  assert.equal(expired.allowed, false);
});

test("a revoked delegation is denied at/after the revocation instant", () => {
  const d: HumanDelegation = { ...base, revokedAt: NOW };
  assert.equal(resolveDelegatedAccess([d], { toSubjectId: "bob", capability: "approve_payment", now: NOW }).allowed, false);
  // just before revocation it still authorises
  assert.equal(resolveDelegatedAccess([d], { toSubjectId: "bob", capability: "approve_payment", now: NOW - 1 }).allowed, true);
});

test("project scope limits where the delegation applies", () => {
  const d: HumanDelegation = { ...base, projects: ["proj-x"] };
  assert.equal(resolveDelegatedAccess([d], { toSubjectId: "bob", capability: "approve_payment", projectId: "proj-x", now: NOW }).allowed, true);
  assert.equal(resolveDelegatedAccess([d], { toSubjectId: "bob", capability: "approve_payment", projectId: "proj-y", now: NOW }).allowed, false);
  // omitted project scope ⇒ any project
  assert.equal(resolveDelegatedAccess([base], { toSubjectId: "bob", capability: "approve_payment", projectId: "proj-z", now: NOW }).allowed, true);
});

test("a use-capped delegation is denied once the cap is reached", () => {
  const underCap: HumanDelegation = { ...base, maxUses: 3, usesSoFar: 2 };
  assert.equal(resolveDelegatedAccess([underCap], { toSubjectId: "bob", capability: "approve_payment", now: NOW }).allowed, true);
  const atCap: HumanDelegation = { ...base, maxUses: 3, usesSoFar: 3 };
  assert.equal(resolveDelegatedAccess([atCap], { toSubjectId: "bob", capability: "approve_payment", now: NOW }).allowed, false);
});

test("among several authorising delegations the lowest id is picked (deterministic)", () => {
  const a: HumanDelegation = { ...base, id: "zeta" };
  const b: HumanDelegation = { ...base, id: "alpha" };
  const r = resolveDelegatedAccess([a, b], { toSubjectId: "bob", capability: "approve_payment", now: NOW });
  assert.equal(r.delegationId, "alpha");
});

test("empty set, and all-malformed set, deny", () => {
  assert.equal(resolveDelegatedAccess([], { toSubjectId: "bob", capability: "approve_payment", now: NOW }).allowed, false);
  const junk = [null, 42, { id: "no-delegatee" }, { toSubjectId: "bob" }] as unknown as HumanDelegation[];
  assert.equal(resolveDelegatedAccess(junk, { toSubjectId: "bob", capability: "approve_payment", now: NOW }).allowed, false);
});

test("malformed input never throws; ids/scopes coerced; dirty timestamps ignored", () => {
  const dirty = {
    id: "d",
    fromSubjectId: "alice",
    toSubjectId: "bob",
    capabilities: ["approve_payment", "", null, "approve_payment"], // blanks/nulls/dupes dropped
    projects: "not-an-array", // ⇒ [] ⇒ any
    notBefore: "garbage", // ⇒ null ⇒ no lower bound
    notAfter: NaN, // ⇒ null ⇒ no upper bound
    maxUses: "x", // ⇒ null ⇒ uncapped
  } as unknown as HumanDelegation;
  const r = resolveDelegatedAccess([dirty], { toSubjectId: "bob", capability: "approve_payment", now: NOW });
  assert.equal(r.allowed, true);
  const clean = cleanDelegation(dirty)!;
  assert.deepEqual(clean.capabilities, ["approve_payment"]);
  assert.deepEqual(clean.projects, []);
  assert.equal(clean.notBefore, null);
  assert.equal(clean.maxUses, null);
});

test("activeDelegationsFor lists only currently-active delegations for a delegatee, id-sorted", () => {
  const set: HumanDelegation[] = [
    { ...base, id: "b-active" },
    { ...base, id: "a-active" },
    { ...base, id: "expired", notAfter: daysFromNow(-1) },
    { ...base, id: "for-carol", toSubjectId: "carol" },
    { ...base, id: "revoked", revokedAt: daysFromNow(-1) },
  ];
  const active = activeDelegationsFor(set, "bob", NOW);
  assert.deepEqual(active.map((d) => d.id), ["a-active", "b-active"]);
});

test("resolver is deterministic across identical runs", () => {
  const req = { toSubjectId: "bob", capability: "approve_payment", projectId: "p", now: NOW };
  assert.deepEqual(resolveDelegatedAccess([base], req), resolveDelegatedAccess([base], req));
});
