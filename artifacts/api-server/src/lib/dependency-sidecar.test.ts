import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env["OMNI_CONFIG_DIR"] ??= fs.mkdtempSync(path.join(os.tmpdir(), "dep-sidecar-"));
const { getSidecarDependencies, hasSidecarDependencies, setSidecarDependencies, upsertSidecarDependency, removeSidecarDependency } =
  await import("./dependency-sidecar");

/**
 * The sidecar dependency store (§5.5, slice 2): OmniProject's own sealed home for the dependency graph when the
 * backend broker fronts no native link API. Round-trips directed edges, upserts idempotently on from·kind·to,
 * removes by triple, and stores only id→id/kind (never item content) — the zero-at-rest posture for the built-in home.
 */

after(() => { try { fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); } catch { /* noop */ } });

test("empty until authored; setSidecarDependencies round-trips edges", () => {
  const pid = "p-dep-1";
  assert.equal(hasSidecarDependencies(pid), false);
  setSidecarDependencies(pid, [{ fromId: "a", toId: "b", kind: "depends_on", note: "schema first" }]);
  assert.equal(hasSidecarDependencies(pid), true);
  assert.deepEqual(getSidecarDependencies(pid), [{ fromId: "a", toId: "b", kind: "depends_on", note: "schema first" }]);
});

test("upsert is idempotent on from·kind·to (re-assert refreshes the note, never duplicates)", () => {
  const pid = "p-dep-2";
  upsertSidecarDependency(pid, { fromId: "x", toId: "y", kind: "blocks" });
  upsertSidecarDependency(pid, { fromId: "x", toId: "y", kind: "blocks", note: "added later" });
  const edges = getSidecarDependencies(pid);
  assert.equal(edges.filter((e) => e.fromId === "x" && e.toId === "y" && e.kind === "blocks").length, 1);
  assert.equal(edges[0]!.note, "added later");
  // A different kind between the same nodes is a distinct edge.
  upsertSidecarDependency(pid, { fromId: "x", toId: "y", kind: "relates_to" });
  assert.equal(getSidecarDependencies(pid).length, 2);
});

test("remove deletes by triple (a no-op when absent)", () => {
  const pid = "p-dep-3";
  upsertSidecarDependency(pid, { fromId: "a", toId: "b", kind: "depends_on" });
  upsertSidecarDependency(pid, { fromId: "b", toId: "c", kind: "depends_on" });
  removeSidecarDependency(pid, "a", "b", "depends_on");
  const edges = getSidecarDependencies(pid);
  assert.ok(!edges.some((e) => e.fromId === "a" && e.toId === "b"));
  assert.ok(edges.some((e) => e.fromId === "b" && e.toId === "c"));
  // Removing an edge that isn't there leaves the set intact.
  removeSidecarDependency(pid, "no", "such", "blocks");
  assert.equal(getSidecarDependencies(pid).length, 1);
});

test("only id→id/kind (+ note) survive sealing — stray fields and forbidden keys are stripped", () => {
  const pid = "p-dep-4";
  upsertSidecarDependency(pid, JSON.parse('{"fromId":"a","toId":"b","kind":"blocks","__proto__":"x","secret":"leak"}'));
  const edge = getSidecarDependencies(pid)[0]!;
  assert.deepEqual(Object.keys(edge).sort(), ["fromId", "kind", "toId"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(edge, "__proto__"));
  assert.ok(!Object.prototype.hasOwnProperty.call(edge, "secret"));
});
