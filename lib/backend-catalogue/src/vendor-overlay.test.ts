import { test } from "node:test";
import assert from "node:assert/strict";
import { withOverlay, registerVendor, clearVendorOverlay, validateVendor, vendorOverlayCounts, vendorOverlayEntries } from "./vendor-overlay";
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
  verification: "catalogued",
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

test("validateVendor rejects an unknown plane and a schema-invalid vendor, accepts a good one", () => {
  clearVendorOverlay();
  const unknown = validateVendor("not-a-plane" as never, SAMPLE);
  assert.ok(unknown.some((e) => e.includes('unknown plane "not-a-plane"')));
  assert.deepEqual(validateVendor("backends", SAMPLE), [], "a well-formed backend passes");
  const bad = validateVendor("backends", { id: 123 });
  assert.ok(bad.length > 0, "a malformed backend fails its schema");
});

test("registerVendor throws with the schema errors when the candidate is invalid", () => {
  clearVendorOverlay();
  assert.throws(() => registerVendor("backends", { id: "broken" }), /invalid backends vendor "broken"/);
  clearVendorOverlay();
});

test("vendorOverlayCounts and vendorOverlayEntries report the registered overlay per plane", () => {
  clearVendorOverlay();
  assert.deepEqual(vendorOverlayCounts(), { backends: 0, brokers: 0, notifications: 0, outputs: 0 });
  assert.deepEqual(vendorOverlayEntries(), { backends: [], brokers: [], notifications: [], outputs: [] });

  registerVendor("backends", SAMPLE);
  registerVendor("backends", { ...SAMPLE, id: "perf-sample-2" });
  assert.deepEqual(vendorOverlayCounts(), { backends: 2, brokers: 0, notifications: 0, outputs: 0 });
  const entries = vendorOverlayEntries();
  assert.deepEqual(entries.brokers, []);
  assert.deepEqual(entries.backends.map((b) => b.id).sort(), ["perf-sample", "perf-sample-2"]);
  clearVendorOverlay();
});

test("catalogue lookups stay cheap (100k getBackend calls well under 1s)", () => {
  clearVendorOverlay();
  const start = performance.now();
  for (let i = 0; i < 100_000; i++) getBackend("jira");
  const ms = performance.now() - start;
  assert.ok(ms < 1000, `100k getBackend lookups should be well under 1s, took ${ms.toFixed(1)}ms`);
});
