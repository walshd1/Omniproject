import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeRagVocabularyOverride } from "./rag-vocabulary-config";
import { classifyRag } from "../broker/vocabulary";

/**
 * Scope-overridable RAG/health band vocabulary. Bands are org-owned for DISPLAY (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, ordinal-required). The sanitiser (pure) enforces those boundaries; the resolver folds an
 * org override over the shipped default. The 3-way classifier (classifyRag) stays unchanged.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rag-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel a band (Green → On Track), add a band, remove a shipped one", () => {
  const out = sanitizeRagVocabularyOverride({
    bands: [
      { id: "green", label: "On Track", order: 2 }, // relabel existing
      { id: "blue", label: "Complete", level: 4, order: 3, methodologies: ["prince2"] }, // add
      { id: "amber", removed: true }, // remove shipped
      { id: "red" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.bands, [
    { id: "green", label: "On Track", order: 2 },
    { id: "blue", label: "Complete", level: 4, order: 3, methodologies: ["prince2"] },
    { id: "amber", removed: true },
  ]);
});

test("sanitizer: a NEW band must carry label + ordinal level + order", () => {
  assert.throws(() => sanitizeRagVocabularyOverride({ bands: [{ id: "blue", label: "Complete" }] }), /needs a label, an ordinal level and an order/);
  assert.throws(() => sanitizeRagVocabularyOverride({ bands: [{ id: "blue", label: "Complete", level: 0, order: 3 }] }), /level must be a positive integer/);
});

test("sanitizer: removing an unknown band is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeRagVocabularyOverride({ bands: [{ id: "nope", removed: true }] }), /cannot remove unknown band/);
  assert.deepEqual(sanitizeRagVocabularyOverride({ bands: [{ id: "green", color: "#123abc" }] }).bands, [{ id: "green", color: "#123abc" }]);
  assert.throws(() => sanitizeRagVocabularyOverride({ bands: [{ id: "green", color: "grün" }] }), /must be a 6-digit hex/);
});

test("resolver: shipped default is the 3 RAG bands in ascending health order", async () => {
  const { resolveRagVocabulary } = await import("./rag-vocabulary-config");
  const base = resolveRagVocabulary();
  assert.deepEqual(base.bands.map((b) => b.id), ["red", "amber", "green"]);
  assert.equal(base.bands.find((b) => b.id === "red")!.level, 1);
  assert.equal(base.bands.find((b) => b.id === "green")!.level, 3);
});

test("resolver: an org can relabel/add/remove bands — but classifyRag stays the 3-way classifier", async () => {
  const { resolveRagVocabulary, RAG_VOCABULARY_CONFIG_ID, ORG_RAG_VOCABULARY_ID } = await import("./rag-vocabulary-config");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_RAG_VOCABULARY_ID, kind: "config", name: "RAG vocabulary",
    payload: { id: RAG_VOCABULARY_CONFIG_ID, values: { bands: [
      { id: "green", label: "On Track" }, // relabel
      { id: "blue", label: "Complete", level: 4, order: 25 }, // add a band
      { id: "amber", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveRagVocabulary();
  const ids = resolved.bands.map((b) => b.id);
  assert.ok(!ids.includes("amber"), "removed band is gone");
  assert.ok(ids.includes("blue"), "added band is present");
  assert.equal(resolved.bands.find((b) => b.id === "green")!.label, "On Track");

  // The DISPLAY relabel does NOT change the classifier: classifyRag still maps to GREEN/AMBER/RED, and a
  // relabelled/added token is not one of the three canonical bands.
  assert.equal(classifyRag("GREEN"), "GREEN");
  assert.equal(classifyRag("AMBER"), "AMBER");
  assert.equal(classifyRag("RED"), "RED");
  assert.equal(classifyRag("On Track"), null);
  assert.equal(classifyRag("blue"), null);
});
