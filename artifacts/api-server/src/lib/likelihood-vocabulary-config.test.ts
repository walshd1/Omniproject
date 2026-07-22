import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeLikelihoodVocabularyOverride } from "./likelihood-vocabulary-config";

/**
 * Scope-overridable RAID/risk likelihood vocabulary. Grades are org-owned (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, ordinal-level-required). The sanitiser (pure) enforces those boundaries; the resolver
 * folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "likelihood-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing grade, add a new one, remove a shipped one", () => {
  const out = sanitizeLikelihoodVocabularyOverride({
    levels: [
      { id: "low", label: "Rare", order: 0 }, // relabel existing
      { id: "almost_certain", label: "Almost certain", level: 4, order: 3, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove shipped
      { id: "high" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.levels, [
    { id: "low", label: "Rare", order: 0 },
    { id: "almost_certain", label: "Almost certain", level: 4, order: 3, methodologies: ["prince2"] },
    { id: "medium", removed: true },
  ]);
});

test("sanitizer: a NEW grade must carry label + ordinal level + order", () => {
  assert.throws(() => sanitizeLikelihoodVocabularyOverride({ levels: [{ id: "almost_certain", label: "Almost certain" }] }), /needs a label, an ordinal level and an order/);
  assert.throws(() => sanitizeLikelihoodVocabularyOverride({ levels: [{ id: "almost_certain", label: "Almost certain", level: 0, order: 3 }] }), /level must be a positive integer/);
});

test("sanitizer: removing an unknown grade is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeLikelihoodVocabularyOverride({ levels: [{ id: "nope", removed: true }] }), /cannot remove unknown grade/);
  assert.deepEqual(sanitizeLikelihoodVocabularyOverride({ levels: [{ id: "low", color: "#123abc" }] }).levels, [{ id: "low", color: "#123abc" }]);
  assert.throws(() => sanitizeLikelihoodVocabularyOverride({ levels: [{ id: "low", color: "green" }] }), /must be a 6-digit hex/);
});

test("resolver: shipped default is the 3 RAID likelihood grades in order", async () => {
  const { resolveLikelihoodVocabulary } = await import("./likelihood-vocabulary-config");
  const base = resolveLikelihoodVocabulary();
  assert.deepEqual(base.levels.map((l) => l.id), ["low", "medium", "high"]);
  assert.equal(base.levels.find((l) => l.id === "low")!.level, 1);
});

test("resolver: an org can add, remove and relabel grades; methodology tags filter", async () => {
  const { resolveLikelihoodVocabulary, LIKELIHOOD_VOCABULARY_CONFIG_ID, ORG_LIKELIHOOD_VOCABULARY_ID } = await import("./likelihood-vocabulary-config");
  const { likelihoodLevelsForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_LIKELIHOOD_VOCABULARY_ID, kind: "config", name: "Likelihood vocabulary",
    payload: { id: LIKELIHOOD_VOCABULARY_CONFIG_ID, values: { levels: [
      { id: "low", label: "Rare" }, // relabel
      { id: "almost_certain", label: "Almost certain", level: 4, order: 25, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveLikelihoodVocabulary();
  const ids = resolved.levels.map((l) => l.id);
  assert.ok(!ids.includes("medium"), "removed grade is gone");
  assert.ok(ids.includes("almost_certain"), "added grade is present");
  assert.equal(resolved.levels.find((l) => l.id === "low")!.label, "Rare");
  assert.equal(resolved.levels.find((l) => l.id === "almost_certain")!.level, 4);

  assert.ok(likelihoodLevelsForMethodology("prince2", resolved.levels).some((l) => l.id === "almost_certain"));
  assert.ok(!likelihoodLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "almost_certain"));
});
