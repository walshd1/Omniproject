import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithMessy, messyDataArmed } from "./messy-broker";
import { setMessyConfig, getMessyConfig } from "../lib/messy-data";
import { DemoBroker } from "./demo";
import type { ActorContext } from "./types";

/**
 * The messy-data decorator wraps a broker's READS with the imperfection transform,
 * leaves writes and derived/meta reads alone, and is inert unless dev mode is active.
 */

const ctx: ActorContext = { sub: "u-test" };

afterEach(() => {
  // Restore config + clear the dev-mode env the armed test sets.
  setMessyConfig({ on: false, intensity: 0.4, seed: "omni", gremlins: [] });
  delete process.env["OMNI_DEV_MODE"];
  delete process.env["NODE_ENV"];
});

test("messifies list reads (projects) but never mutates the backing store", async () => {
  setMessyConfig({ on: true, intensity: 1, seed: "s" });
  const base = new DemoBroker();
  const before = JSON.stringify(await base.listProjects());
  const wrapped = wrapWithMessy(base);
  const messy = await wrapped.listProjects(ctx);
  // The decorated read differs from the raw one (mess applied)…
  assert.notEqual(JSON.stringify(messy), before);
  // …but the underlying broker still returns the clean data (copy-on-mess).
  assert.equal(JSON.stringify(await base.listProjects()), before);
});

test("leaves our own derived/meta reads (summary) untouched", async () => {
  setMessyConfig({ on: true, intensity: 1, seed: "s" });
  const base = new DemoBroker();
  const wrapped = wrapWithMessy(base);
  const raw = await base.projectSummary(ctx, "proj-001");
  const via = await wrapped.projectSummary(ctx, "proj-001");
  assert.deepEqual(via, raw); // projectSummary is not in the messy set
});

test("passes writes straight through (only reads are messified)", async () => {
  setMessyConfig({ on: true, intensity: 1, seed: "s" });
  const wrapped = wrapWithMessy(new DemoBroker());
  const created = await wrapped.writeIssue(ctx, "create", { projectId: "proj-002", title: "clean write" });
  assert.equal(created?.["title"], "clean write");
});

test("messyDataArmed is false outside dev mode, true inside it when on", () => {
  process.env["NODE_ENV"] = "production";
  process.env["OMNI_DEV_MODE"] = "1";
  setMessyConfig({ on: true });
  assert.equal(messyDataArmed(), false); // hard-gated off in production

  process.env["NODE_ENV"] = "development";
  assert.equal(messyDataArmed(), true); // dev + on
  setMessyConfig({ on: false });
  assert.equal(messyDataArmed(), false); // dev but switched off
  assert.equal(getMessyConfig().on, false);
});
