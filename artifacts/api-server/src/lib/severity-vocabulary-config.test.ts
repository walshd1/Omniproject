import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeSeverityVocabularyOverride } from "./severity-vocabulary-config";

/**
 * Scope-overridable RAID/risk severity vocabulary. Grades are org-owned (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, ordinal-level-required). The sanitiser (pure) enforces those boundaries; the resolver
 * folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "severity-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing grade, add a new one, remove a shipped one", () => {
  const out = sanitizeSeverityVocabularyOverride({
    levels: [
      { id: "low", label: "Minor", order: 0 }, // relabel existing
      { id: "catastrophic", label: "Catastrophic", level: 5, order: 4, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove shipped
      { id: "high" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.levels, [
    { id: "low", label: "Minor", order: 0 },
    { id: "catastrophic", label: "Catastrophic", level: 5, order: 4, methodologies: ["prince2"] },
    { id: "medium", removed: true },
  ]);
});

test("sanitizer: a NEW grade must carry label + ordinal level + order", () => {
  assert.throws(() => sanitizeSeverityVocabularyOverride({ levels: [{ id: "catastrophic", label: "Catastrophic" }] }), /needs a label, an ordinal level and an order/);
  assert.throws(() => sanitizeSeverityVocabularyOverride({ levels: [{ id: "catastrophic", label: "Catastrophic", level: 0, order: 4 }] }), /level must be a positive integer/);
  assert.throws(() => sanitizeSeverityVocabularyOverride({ levels: [{ id: "catastrophic", label: "Catastrophic", level: 1.5, order: 4 }] }), /level must be a positive integer/);
});

test("sanitizer: removing an unknown grade is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeSeverityVocabularyOverride({ levels: [{ id: "nope", removed: true }] }), /cannot remove unknown grade/);
  assert.deepEqual(sanitizeSeverityVocabularyOverride({ levels: [{ id: "low", color: "#123abc" }] }).levels, [{ id: "low", color: "#123abc" }]);
  assert.throws(() => sanitizeSeverityVocabularyOverride({ levels: [{ id: "low", color: "green" }] }), /must be a 6-digit hex/);
});

test("resolver: shipped default is the 4 RAID severity grades in order (incl. critical)", async () => {
  const { resolveSeverityVocabulary } = await import("./severity-vocabulary-config");
  const base = resolveSeverityVocabulary();
  assert.deepEqual(base.levels.map((l) => l.id), ["low", "medium", "high", "critical"]);
  assert.equal(base.levels.find((l) => l.id === "low")!.level, 1);
  assert.equal(base.levels.find((l) => l.id === "critical")!.level, 4);
});

test("resolver: an org can add, remove and relabel grades; methodology tags filter", async () => {
  const { resolveSeverityVocabulary, SEVERITY_VOCABULARY_CONFIG_ID, ORG_SEVERITY_VOCABULARY_ID } = await import("./severity-vocabulary-config");
  const { severityLevelsForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_SEVERITY_VOCABULARY_ID, kind: "config", name: "Severity vocabulary",
    payload: { id: SEVERITY_VOCABULARY_CONFIG_ID, values: { levels: [
      { id: "low", label: "Minor" }, // relabel
      { id: "catastrophic", label: "Catastrophic", level: 5, order: 25, methodologies: ["prince2"] }, // add
      { id: "medium", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveSeverityVocabulary();
  const ids = resolved.levels.map((l) => l.id);
  assert.ok(!ids.includes("medium"), "removed grade is gone");
  assert.ok(ids.includes("catastrophic"), "added grade is present");
  assert.equal(resolved.levels.find((l) => l.id === "low")!.label, "Minor");
  const cata = resolved.levels.find((l) => l.id === "catastrophic")!;
  assert.equal(cata.level, 5); // ordinal binding preserved
  assert.deepEqual(cata.methodologies, ["prince2"]);

  assert.ok(severityLevelsForMethodology("prince2", resolved.levels).some((l) => l.id === "catastrophic"));
  assert.ok(!severityLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "catastrophic"));
  assert.ok(severityLevelsForMethodology("scrum", resolved.levels).some((l) => l.id === "low")); // neutral applies everywhere
});
