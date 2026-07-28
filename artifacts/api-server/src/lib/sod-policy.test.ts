import { test } from "node:test";
import assert from "node:assert/strict";
import { sodPolicyState, prospectiveRoleMap, roleMapToSoDAssignments } from "./sod-policy";

const env = (v?: string): NodeJS.ProcessEnv => (v === undefined ? {} : { SOD_POLICIES: v }) as NodeJS.ProcessEnv;
const POLICY = JSON.stringify([{ id: "sod-admin-pmo", label: "admin vs pmo", a: ["admin"], b: ["pmo"] }]);

test("sodPolicyState: unset ⇒ inert (no policies, no error)", () => {
  assert.deepEqual(sodPolicyState(env()), { policies: [], error: null });
  assert.deepEqual(sodPolicyState(env("   ")), { policies: [], error: null });
});

test("sodPolicyState: valid JSON array ⇒ parsed policies", () => {
  const s = sodPolicyState(env(POLICY));
  assert.equal(s.error, null);
  assert.equal(s.policies.length, 1);
  assert.equal(s.policies[0]!.id, "sod-admin-pmo");
  assert.deepEqual(s.policies[0]!.a, ["admin"]);
});

test("sodPolicyState: malformed JSON ⇒ fail-closed (error set, no policies)", () => {
  const s = sodPolicyState(env("{ not json"));
  assert.equal(s.policies.length, 0);
  assert.ok(s.error, "error should be set on unparseable JSON");
});

test("sodPolicyState: JSON that isn't an array ⇒ fail-closed", () => {
  const s = sodPolicyState(env('{"id":"x"}'));
  assert.equal(s.policies.length, 0);
  assert.ok(s.error);
});

test("prospectiveRoleMap: folds body overrides (normalised) onto current, keeps un-overridden roles", () => {
  const current = [
    { role: "admin", claims: ["corp-admins"] },
    { role: "pmo", claims: ["planners"] },
    { role: "viewer", claims: ["everyone"] },
  ];
  const next = prospectiveRoleMap(current, { admin: ["  OPS  ", ""], pmo: ["planners"] });
  // admin overridden + normalised (trim + lower-case, blanks dropped)
  assert.deepEqual(next.find((r) => r.role === "admin")!.claims, ["ops"]);
  // pmo overridden with the same value it had
  assert.deepEqual(next.find((r) => r.role === "pmo")!.claims, ["planners"]);
  // viewer not in body ⇒ unchanged
  assert.deepEqual(next.find((r) => r.role === "viewer")!.claims, ["everyone"]);
});

test("roleMapToSoDAssignments: inverts role→group into subject(group)→grants(roles), sorted", () => {
  const map = [
    { role: "admin", claims: ["ops", "sre"] },
    { role: "pmo", claims: ["ops"] },
    { role: "viewer", claims: ["everyone"] },
  ];
  const assignments = roleMapToSoDAssignments(map);
  // one subject per group, subject-id sorted
  assert.deepEqual(assignments.map((a) => a.subjectId), ["everyone", "ops", "sre"]);
  // "ops" holds BOTH admin and pmo → the toxic combination the engine will flag
  assert.deepEqual(assignments.find((a) => a.subjectId === "ops")!.grants, ["admin", "pmo"]);
  assert.deepEqual(assignments.find((a) => a.subjectId === "sre")!.grants, ["admin"]);
});
