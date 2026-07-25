import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeEnergyVocabularyOverride } from "./energy-vocabulary-config";

/**
 * Scope-overridable GTD energy-level vocabulary. Levels are org-owned (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, ordinal-level-required). The sanitiser (pure) enforces those boundaries; the resolver
 * folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "energy-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing level, add a new one, remove a shipped one", () => {
  const out = sanitizeEnergyVocabularyOverride({
    levels: [
      { id: "low", label: "Chilled", order: 0 }, // relabel existing
      { id: "extreme", label: "Extreme", level: 4, order: 3, methodologies: ["gtd"] }, // add
      { id: "medium", removed: true }, // remove shipped
      { id: "high" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.levels, [
    { id: "low", label: "Chilled", order: 0 },
    { id: "extreme", label: "Extreme", level: 4, order: 3, methodologies: ["gtd"] },
    { id: "medium", removed: true },
  ]);
});

test("sanitizer: a NEW level must carry label + ordinal level + order", () => {
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "extreme", label: "Extreme" }] }), /needs a label, an ordinal level and an order/);
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "extreme", label: "Extreme", level: 0, order: 3 }] }), /level must be a positive integer/);
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "extreme", label: "Extreme", level: 1.5, order: 3 }] }), /level must be a positive integer/);
});

test("sanitizer: removing an unknown level is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "nope", removed: true }] }), /cannot remove unknown level/);
  assert.deepEqual(sanitizeEnergyVocabularyOverride({ levels: [{ id: "low", color: "#123abc" }] }).levels, [{ id: "low", color: "#123abc" }]);
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "low", color: "green" }] }), /must be a 6-digit hex/);
});

test("sanitizer: per-locale translations validate locale keys", () => {
  const out = sanitizeEnergyVocabularyOverride({ levels: [{ id: "low", labels: { de: "Niedrig", "en-GB": "Low" } }] });
  assert.deepEqual(out.levels, [{ id: "low", labels: { de: "Niedrig", "en-GB": "Low" } }]);
  assert.throws(() => sanitizeEnergyVocabularyOverride({ levels: [{ id: "low", labels: { German: "Niedrig" } }] }), /not a valid locale/);
});

test("resolver: shipped default is the 3 GTD energy levels in order", async () => {
  const { resolveEnergyVocabulary } = await import("./energy-vocabulary-config");
  const base = resolveEnergyVocabulary();
  assert.deepEqual(base.levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(base.levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(base.levels.find((l) => l.id === "high")!.color, "#ef4444"); // shipped hex colour
});

test("resolver: an org can add, remove and relabel levels; methodology tags filter", async () => {
  const { resolveEnergyVocabulary, ENERGY_VOCABULARY_CONFIG_ID, ORG_ENERGY_VOCABULARY_ID } = await import("./energy-vocabulary-config");
  const { energyLevelsForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_ENERGY_VOCABULARY_ID, kind: "config", name: "Energy vocabulary",
    payload: { id: ENERGY_VOCABULARY_CONFIG_ID, values: { levels: [
      { id: "low", label: "Chilled" }, // relabel
      { id: "extreme", label: "Extreme", level: 4, order: 25, methodologies: ["gtd"] }, // add (gtd-only)
      { id: "medium", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveEnergyVocabulary();
  const ids = resolved.levels.map((l) => l.id);
  assert.ok(!ids.includes("medium"), "removed level is gone");
  assert.ok(ids.includes("extreme"), "added level is present");
  assert.equal(resolved.levels.find((l) => l.id === "low")!.label, "Chilled");
  const extreme = resolved.levels.find((l) => l.id === "extreme")!;
  assert.equal(extreme.level, 4); // ordinal binding preserved
  assert.deepEqual(extreme.methodologies, ["gtd"]);

  // Methodology filter: the gtd-tagged "extreme" applies to gtd, not to scrum; neutral levels apply to both.
  assert.ok(energyLevelsForMethodology("gtd", resolved.levels).some((l) => l.id === "extreme"));
  assert.ok(!energyLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "extreme"));
  assert.ok(energyLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "low")); // neutral applies everywhere
});
