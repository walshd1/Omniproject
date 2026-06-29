import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadGroup, emitRegistry, type AssetGroup } from "./gen-registry";
import type { JsonSchema } from "../../../lib/backend-catalogue/src/vendor-schema";

/**
 * The shared JSON-asset registry generator engine (behind gen-vendors / gen-views). These tests
 * pin its invariants: schema validation, filename===id, unique ids, id-sort, and the emitted module
 * shape — so a regression in the generator core is caught without running a specific gen-* CLI.
 */

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "label"],
  properties: { id: { type: "string" }, label: { type: "string" } },
  additionalProperties: false,
};

let dirs: string[] = [];
function tmpGroup(files: Record<string, unknown>): AssetGroup {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genreg-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
  }
  return { dir, schema: SCHEMA, label: "things", constName: "THINGS", typeName: "Thing", typeModule: "./types" };
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

test("loadGroup validates, dedupes by id and returns id-sorted rows", () => {
  const group = tmpGroup({
    "beta.json": { id: "beta", label: "B" },
    "alpha.json": { id: "alpha", label: "A" },
  });
  const rows = loadGroup(group);
  assert.deepEqual(rows.map((r) => r.id), ["alpha", "beta"]); // sorted
});

test("loadGroup rejects a file whose name does not equal its id", () => {
  const group = tmpGroup({ "wrong.json": { id: "right", label: "X" } });
  assert.throws(() => loadGroup(group), /filename must equal id/);
});

test("loadGroup rejects a schema violation", () => {
  const group = tmpGroup({ "x.json": { id: "x" } }); // missing required "label"
  assert.throws(() => loadGroup(group), /fails its schema/);
});

test("emitRegistry writes a typed module with header, import and a const per group", () => {
  const group = tmpGroup({ "a.json": { id: "a", label: "A" } });
  const rows = loadGroup(group);
  const out = path.join(group.dir, "out.generated.ts");
  emitRegistry(out, ["// AUTO-GENERATED"], [{ group, rows }]);
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /\/\/ AUTO-GENERATED/);
  assert.match(text, /import type \{ Thing \} from "\.\/types";/);
  assert.match(text, /export const THINGS: Thing\[\] =/);
  assert.match(text, /"id": "a"/);
});
