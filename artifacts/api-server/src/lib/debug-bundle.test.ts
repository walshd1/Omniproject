import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDebugBundleEntries, buildDebugBundleZip } from "./debug-bundle";

/**
 * Debug bundle assembly. A bundle must carry everything needed to reproduce an
 * issue elsewhere: config, the loaded vendors, the demo state, and the captured
 * traffic — indexed by a manifest.
 */

function names(now = "2026-01-01T00:00:00.000Z") {
  return buildDebugBundleEntries(now).entries.map((e) => e.name);
}

test("bundle always carries config, vendors, demo state, manifest + README", () => {
  const ns = names();
  for (const required of ["README.md", "manifest.json", "config.json", "vendors.json", "demo-state.json"]) {
    assert.ok(ns.includes(required), `bundle missing ${required}`);
  }
});

test("feature-modules.json carries the optional-module status", () => {
  const { entries } = buildDebugBundleEntries("2026-01-01T00:00:00.000Z");
  const fm = entries.find((e) => e.name === "feature-modules.json")!;
  assert.ok(fm, "bundle should include feature-modules.json");
  const parsed = JSON.parse(fm.data.toString("utf8"));
  assert.ok(Array.isArray(parsed) && parsed.length > 0, "expected feature-module status entries");
  for (const m of parsed) {
    assert.equal(typeof m.id, "string");
    assert.equal(typeof m.enabled, "boolean");
    assert.equal(typeof m.loaded, "boolean");
  }
  // The UX-parity modules should be represented.
  const ids = parsed.map((m: { id: string }) => m.id);
  for (const id of ["grid", "savedViews", "myWork", "dashboards"]) {
    assert.ok(ids.includes(id), `feature-modules.json omits ${id}`);
  }
});

test("vendors.json holds the loaded backend + broker catalogues", () => {
  const { entries } = buildDebugBundleEntries("2026-01-01T00:00:00.000Z");
  const vendors = entries.find((e) => e.name === "vendors.json")!;
  const parsed = JSON.parse(vendors.data.toString("utf8"));
  assert.ok(Array.isArray(parsed.backends) && parsed.backends.length > 0, "expected loaded backends");
  assert.ok(Array.isArray(parsed.brokers) && parsed.brokers.length > 0, "expected loaded brokers");
});

test("the manifest indexes exactly the bundle contents", () => {
  const { manifest, entries } = buildDebugBundleEntries("2026-01-01T00:00:00.000Z");
  assert.equal(manifest.schema, "omniproject/debug-bundle");
  const fileNames = entries.filter((e) => e.name !== "README.md" && e.name !== "manifest.json").map((e) => e.name);
  for (const f of fileNames) assert.ok(manifest.contents.includes(f), `manifest omits ${f}`);
});

test("the captured traffic tape is included when capture is armed", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-bundle-"));
  const tape = join(dir, "capture.jsonl");
  writeFileSync(tape, JSON.stringify({ seq: 0, plane: "broker", method: "listProjects" }) + "\n");
  const saved = { env: process.env["NODE_ENV"], cap: process.env["BROKER_CAPTURE"] };
  process.env["NODE_ENV"] = "development";
  process.env["BROKER_CAPTURE"] = tape;
  try {
    const { entries, manifest } = buildDebugBundleEntries("2026-01-01T00:00:00.000Z");
    const tapeEntry = entries.find((e) => e.name === "capture-tape.jsonl");
    assert.ok(tapeEntry, "capture-tape.jsonl should be bundled when armed");
    assert.match(tapeEntry!.data.toString("utf8"), /listProjects/);
    assert.ok(manifest.contents.includes("capture-tape.jsonl"));
    assert.equal(manifest.surfaces.capture, true);
  } finally {
    if (saved.env === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = saved.env;
    if (saved.cap === undefined) delete process.env["BROKER_CAPTURE"]; else process.env["BROKER_CAPTURE"] = saved.cap;
  }
});

test("buildDebugBundleZip produces a non-empty ZIP (PK header)", () => {
  const zip = buildDebugBundleZip("2026-01-01T00:00:00.000Z");
  assert.ok(zip.length > 0);
  assert.equal(zip.subarray(0, 2).toString("latin1"), "PK"); // ZIP local file header magic
});
