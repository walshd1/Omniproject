import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess, evaluateAccessBatch, type AccessPolicy } from "./authz-policy";

test("a matching allow policy grants access", () => {
  const policies: AccessPolicy[] = [{ id: "p1", effect: "allow", action: "read" }];
  const r = evaluateAccess({ action: "read" }, policies);
  assert.equal(r.decision, "allow");
  assert.deepEqual(r.matchedPolicyIds, ["p1"]);
});

test("deny wins over a matching allow", () => {
  const policies: AccessPolicy[] = [
    { id: "allow-read", effect: "allow", action: "read" },
    { id: "deny-locked", effect: "deny", action: "read", when: { all: [{ field: "resource.locked", op: "truthy" }] } },
  ];
  const r = evaluateAccess({ action: "read", context: { "resource.locked": true } }, policies);
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.matchedPolicyIds, ["deny-locked"]);
});

test("action + resourceType selectors scope the policy", () => {
  const policies: AccessPolicy[] = [{ id: "p", effect: "allow", action: ["read", "list"], resourceType: "issue" }];
  assert.equal(evaluateAccess({ action: "read", resourceType: "issue" }, policies).decision, "allow");
  assert.equal(evaluateAccess({ action: "delete", resourceType: "issue" }, policies).decision, "deny"); // action not in set
  assert.equal(evaluateAccess({ action: "read", resourceType: "invoice" }, policies).decision, "deny"); // wrong resource
  assert.equal(evaluateAccess({ action: "read" }, policies).decision, "deny"); // constrained resource, request has none
});

test("an absent selector is a wildcard (matches any)", () => {
  const policies: AccessPolicy[] = [{ id: "any", effect: "allow" }]; // no action, no resourceType, no when
  assert.equal(evaluateAccess({ action: "anything", resourceType: "whatever" }, policies).decision, "allow");
});

test("condition-gated allow (ownership rule)", () => {
  // Allow edit only when the caller is the resource owner.
  const policies: AccessPolicy[] = [
    { id: "owner-edit", effect: "allow", action: "edit", when: { all: [{ field: "resource.ownerId", op: "eq", value: "u1" }] } },
  ];
  assert.equal(evaluateAccess({ action: "edit", context: { "resource.ownerId": "u1" } }, policies).decision, "allow");
  assert.equal(evaluateAccess({ action: "edit", context: { "resource.ownerId": "u2" } }, policies).decision, "deny"); // not owner ⇒ no match ⇒ default deny
});

test("no matching policy ⇒ deny by default", () => {
  const policies: AccessPolicy[] = [{ id: "p", effect: "allow", action: "read" }];
  const r = evaluateAccess({ action: "delete" }, policies);
  assert.equal(r.decision, "deny");
  assert.match(r.reason, /no matching policy/);
  assert.deepEqual(r.matchedPolicyIds, []);
});

test("empty policy set ⇒ deny", () => {
  assert.equal(evaluateAccess({ action: "read" }, []).decision, "deny");
  assert.equal(evaluateAccess({ action: "read" }).decision, "deny"); // policies omitted
});

test("null / malformed / effect-less policies contribute nothing (deny, never throws)", () => {
  const policies = [
    null,
    "nope",
    { id: "no-effect" }, // missing effect
    { id: "bad-effect", effect: "maybe", action: "read" }, // unknown effect
  ] as unknown as AccessPolicy[];
  const r = evaluateAccess({ action: "read" }, policies);
  assert.equal(r.decision, "deny");
  assert.deepEqual(r.matchedPolicyIds, []);
});

test("a malformed `when` never throws (predicate engine degrades safely)", () => {
  const policies = [{ id: "weird", effect: "allow", action: "read", when: { all: "not-an-array" } }] as unknown as AccessPolicy[];
  // Should not throw; decision is well-defined (allow, since predicate treats a malformed `all` as no-constraint).
  const r = evaluateAccess({ action: "read" }, policies);
  assert.equal(r.decision, "allow");
  assert.equal(Array.isArray(r.matchedPolicyIds), true);
});

test("matchedPolicyIds preserve declared order across multiple matching allows", () => {
  const policies: AccessPolicy[] = [
    { id: "a", effect: "allow", action: "read" },
    { id: "b", effect: "allow", action: "read" },
    { id: "c", effect: "allow", action: "read" },
  ];
  assert.deepEqual(evaluateAccess({ action: "read" }, policies).matchedPolicyIds, ["a", "b", "c"]);
});

test("batch evaluation preserves request order", () => {
  const policies: AccessPolicy[] = [{ id: "p", effect: "allow", action: "read" }];
  const out = evaluateAccessBatch([{ action: "read" }, { action: "write" }], policies);
  assert.deepEqual(out.map((d) => d.decision), ["allow", "deny"]);
});
