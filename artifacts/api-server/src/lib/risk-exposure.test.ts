import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nearestBand, resolveRiskExposure } from "./risk-exposure";

/**
 * Risk-exposure (P×I) routed through the scope-resolved likelihood/impact vocabularies. The shipped grades are
 * anchors (identity → numbers never move); a scope-added grade snaps onto the nearest anchor so it still yields
 * a bounded number.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "risk-exposure-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("nearestBand snaps an ordinal onto the nearest anchor (ties → the higher band)", () => {
  assert.equal(nearestBand(2, [1, 2, 3]), 2); // exact anchor
  assert.equal(nearestBand(5, [1, 2, 3]), 3); // above every anchor → the top band
  assert.equal(nearestBand(0, [1, 2, 3]), 1); // below every anchor → the bottom band
});

test("shipped grades give the classic P×I product (numbers unchanged)", () => {
  assert.equal(resolveRiskExposure("high", "high"), 9); // 3 × 3
  assert.equal(resolveRiskExposure("medium", "medium"), 4); // 2 × 2
  assert.equal(resolveRiskExposure("low", "high"), 3); // 1 × 3
});

test("an unknown grade yields null (no exposure computable)", () => {
  assert.equal(resolveRiskExposure("turbo", "high"), null);
  assert.equal(resolveRiskExposure("high", "turbo"), null);
});

test("a SCOPE-ADDED grade still yields a bounded number (snapped onto the nearest shipped anchor)", async () => {
  const { LIKELIHOOD_VOCABULARY_CONFIG_ID, ORG_LIKELIHOOD_VOCABULARY_ID } = await import("./likelihood-vocabulary-config");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_LIKELIHOOD_VOCABULARY_ID, kind: "config", name: "Likelihood vocabulary",
    payload: { id: LIKELIHOOD_VOCABULARY_CONFIG_ID, values: { levels: [
      { id: "almost_certain", label: "Almost certain", level: 9, order: 25 }, // an exotic ordinal
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  // level 9 snaps onto the top likelihood anchor (3); impact "high" = 3 → 3 × 3 = 9. Still a number.
  const exposure = resolveRiskExposure("almost_certain", "high");
  assert.equal(typeof exposure, "number");
  assert.equal(exposure, 9);
});
