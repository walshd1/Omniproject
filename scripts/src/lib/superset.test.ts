import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuperset, backendFieldRefs } from "./superset";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("loadSuperset loads the base vocabulary without conflicts and includes core fields", () => {
  const { fields, keys } = loadSuperset(ROOT);
  assert.ok(fields.length >= 100, "expected the full canonical vocabulary");
  assert.equal(fields.length, keys.size, "keys set should match the deduped field count");
  for (const k of ["title", "status", "assignee", "programmeId"]) assert.ok(keys.has(k), `superset should contain ${k}`);
});

test("backendFieldRefs returns one entry per backend, defaulting to no refs", () => {
  const refs = backendFieldRefs(ROOT);
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(r.file.endsWith(".json"));
    assert.ok(Array.isArray(r.keys));
  }
});

test("every backend's fieldKeys are a subset of the superset (the enforced invariant)", () => {
  const { keys } = loadSuperset(ROOT);
  for (const { file, keys: fieldKeys } of backendFieldRefs(ROOT)) {
    for (const k of fieldKeys) assert.ok(keys.has(k), `${file} references "${k}" which is not in the superset`);
  }
});
