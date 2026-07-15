import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRaci, raciRows, RaciError } from "./raci";

test("validateRaci: accepts valid entries, upper-cases responsibility, emits rows", () => {
  const out = validateRaci([{ id: "r1", task: "Deploy", role: "Ops", responsibility: "a" }]);
  assert.equal(out[0]!.responsibility, "A");
  assert.deepEqual(raciRows(out), [{ task: "Deploy", role: "Ops", responsibility: "A" }]);
});
test("validateRaci: requires id/task/role and a valid responsibility, rejects dupes + non-array", () => {
  assert.throws(() => validateRaci([{ id: "r1", task: "", role: "x", responsibility: "R" }]), RaciError);
  assert.throws(() => validateRaci([{ id: "r1", task: "t", role: "x", responsibility: "Z" }]), RaciError);
  assert.throws(() => validateRaci([{ id: "r1", task: "t", role: "x", responsibility: "R" }, { id: "r1", task: "u", role: "y", responsibility: "C" }]), RaciError);
  assert.throws(() => validateRaci({}), RaciError);
});
