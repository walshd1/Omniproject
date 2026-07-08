import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSuperset } from "./superset";

/**
 * Fixture-root tests for loadSuperset's error branches (a non-array base and a
 * conflicting field redefinition), which the repo-root superset.test.ts can't
 * reach because the real catalogue is, by design, conflict-free.
 */

function makeRoot(base: unknown, backends: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "superset-"));
  const assets = path.join(root, "lib/backend-catalogue/assets");
  const backendsDir = path.join(root, "lib/backend-catalogue/vendors/backends");
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(backendsDir, { recursive: true });
  fs.writeFileSync(path.join(assets, "fields.json"), JSON.stringify(base));
  for (const [file, def] of Object.entries(backends)) {
    fs.writeFileSync(path.join(backendsDir, file), JSON.stringify(def));
  }
  return root;
}

test("loadSuperset merges base + backend-contributed fields and dedups matching keys", () => {
  const root = makeRoot(
    [{ key: "title", type: "string", group: "core" }],
    {
      "acme.json": { fields: [{ key: "title", type: "string", group: "core" }, { key: "custom", type: "number", group: "acme" }] },
      "beta.json": { fieldKeys: ["title"] }, // no fields[] contributed — the Array.isArray guard skips it
    },
  );
  try {
    const { fields, keys } = loadSuperset(root);
    assert.equal(keys.size, 2, "title deduped, custom added");
    assert.ok(keys.has("title") && keys.has("custom"));
    assert.equal(fields.length, keys.size);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadSuperset throws when fields.json is not an array", () => {
  const root = makeRoot({ not: "an array" }, {});
  try {
    assert.throws(() => loadSuperset(root), /fields\.json must be a JSON array/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadSuperset throws on a conflicting field redefinition", () => {
  const root = makeRoot(
    [{ key: "status", type: "string", group: "core" }],
    { "acme.json": { fields: [{ key: "status", type: "number", group: "core" }] } },
  );
  try {
    assert.throws(() => loadSuperset(root), /field "status" is redefined with a conflicting type\/group by backends\/acme\.json/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
