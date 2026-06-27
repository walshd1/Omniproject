import { test } from "node:test";
import assert from "node:assert/strict";
import { withOverlay, registerVendor, clearVendorOverlay } from "./vendor-overlay";
import { BACKENDS, getBackend } from "./backend-catalogue";

/**
 * Vendor-overlay performance guard — proves the overlay merge is MEMOISED (not
 * rebuilt on every catalogue accessor call) and that catalogue lookups stay cheap.
 * The reference-identity checks are deterministic; the throughput bound is a
 * generous gross-regression catch (e.g. an accidental O(n²) or per-call re-parse).
 */

const SAMPLE = {
  id: "perf-sample",
  label: "Perf Sample",
  docsUrl: "https://example.test",
  via: "HTTP",
  requiredEnv: [],
  capabilities: { issues: true },
  authHeader: "=Bearer x",
  actions: { list_projects: { method: "GET", url: "https://example.test" } },
};

test("no overlay → withOverlay returns the base array itself (zero-copy fast path)", () => {
  clearVendorOverlay();
  assert.equal(withOverlay("backends", BACKENDS), BACKENDS);
});

test("with an overlay the merge is memoised (same instance across calls)", () => {
  clearVendorOverlay();
  registerVendor("backends", SAMPLE);
  const a = withOverlay("backends", BACKENDS);
  const b = withOverlay("backends", BACKENDS);
  assert.notEqual(a, BACKENDS, "an overlay must change the result");
  assert.equal(a, b, "repeated calls must return the SAME memoised array");
  assert.ok(a.some((x) => x.id === "perf-sample"));
  clearVendorOverlay();
});

test("registering / clearing invalidates the memoised merge", () => {
  clearVendorOverlay();
  registerVendor("backends", SAMPLE);
  const first = withOverlay("backends", BACKENDS);
  registerVendor("backends", { ...SAMPLE, id: "perf-sample-2" });
  const afterRegister = withOverlay("backends", BACKENDS);
  assert.notEqual(afterRegister, first, "registering must invalidate the cache");
  clearVendorOverlay();
  assert.equal(withOverlay("backends", BACKENDS), BACKENDS, "clearing returns the base");
});

test("catalogue lookups stay cheap (100k getBackend calls well under 1s)", () => {
  clearVendorOverlay();
  const start = performance.now();
  for (let i = 0; i < 100_000; i++) getBackend("jira");
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `100k getBackend lookups should be well under 1s, took ${ms.toFixed(1)}ms`);
});
