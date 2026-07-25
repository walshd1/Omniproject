import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeImpactVocabularyOverride } from "./impact-vocabulary-config";

/**
 * Scope-overridable RAID/risk impact vocabulary. Grades are org-owned (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, ordinal-level-required). The sanitiser (pure) enforces those boundaries; the resolver
 * folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "impact-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing grade, add a new one, remove a shipped one", () => {
  const out = sanitizeImpactVocabularyOverride({
    levels: [
      { id: "low", label: "Negligible", order: 0 }, // relabel existing
      { id: "severe", label: "Severe", level: 4, order: 3, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove shipped
      { id: "high" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.levels, [
    { id: "low", label: "Negligible", order: 0 },
    { id: "severe", label: "Severe", level: 4, order: 3, methodologies: ["prince2"] },
    { id: "medium", removed: true },
  ]);
});

test("sanitizer: a NEW grade must carry label + ordinal level + order", () => {
  assert.throws(() => sanitizeImpactVocabularyOverride({ levels: [{ id: "severe", label: "Severe" }] }), /needs a label, an ordinal level and an order/);
  assert.throws(() => sanitizeImpactVocabularyOverride({ levels: [{ id: "severe", label: "Severe", level: 0, order: 3 }] }), /level must be a positive integer/);
});

test("sanitizer: removing an unknown grade is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeImpactVocabularyOverride({ levels: [{ id: "nope", removed: true }] }), /cannot remove unknown grade/);
  assert.deepEqual(sanitizeImpactVocabularyOverride({ levels: [{ id: "low", color: "#123abc" }] }).levels, [{ id: "low", color: "#123abc" }]);
  assert.throws(() => sanitizeImpactVocabularyOverride({ levels: [{ id: "low", color: "green" }] }), /must be a 6-digit hex/);
});

test("resolver: shipped default is the 3 RAID impact grades in order", async () => {
  const { resolveImpactVocabulary } = await import("./impact-vocabulary-config");
  const base = resolveImpactVocabulary();
  assert.deepEqual(base.levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(base.levels.find((l) => l.id === "low")!.level, 1);
});

test("resolver: an org can add, remove and relabel grades; methodology tags filter", async () => {
  const { resolveImpactVocabulary, IMPACT_VOCABULARY_CONFIG_ID, ORG_IMPACT_VOCABULARY_ID } = await import("./impact-vocabulary-config");
  const { impactLevelsForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_IMPACT_VOCABULARY_ID, kind: "config", name: "Impact vocabulary",
    payload: { id: IMPACT_VOCABULARY_CONFIG_ID, values: { levels: [
      { id: "low", label: "Negligible" }, // relabel
      { id: "severe", label: "Severe", level: 4, order: 25, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveImpactVocabulary();
  const ids = resolved.levels.map((l) => l.id);
  assert.ok(!ids.includes("medium"), "removed grade is gone");
  assert.ok(ids.includes("severe"), "added grade is present");
  assert.equal(resolved.levels.find((l) => l.id === "low")!.label, "Negligible");
  assert.equal(resolved.levels.find((l) => l.id === "severe")!.level, 4);

  assert.ok(impactLevelsForMethodology("prince2", resolved.levels).some((l) => l.id === "severe"));
  assert.ok(!impactLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "severe"));
});
