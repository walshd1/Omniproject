import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_RAG,
  RAG_BAND_LEVEL,
  RAG_BAND_LABEL,
  ragVocabulary,
  ragVocabularyValues,
  ragBandsForMethodology,
} from "./rag-vocabulary";

test("canonical RAG bands are in ascending health order with their internal ordinal band", () => {
  assert.deepEqual([...CANONICAL_RAG], ["red", "amber", "green"]);
  assert.deepEqual(RAG_BAND_LEVEL, { red: 1, amber: 2, green: 3 });
});

test("every RAG band carries a label", () => {
  for (const e of CANONICAL_RAG) assert.ok(RAG_BAND_LABEL[e], `band ${e} needs a label`);
});

test("ragVocabularyValues ships the 3 bands with ordinal band, order, methodology tags and colour", () => {
  const { bands } = ragVocabularyValues();
  assert.deepEqual(bands.map((b) => b.id), ["red", "amber", "green"]);
  assert.equal(bands.find((b) => b.id === "red")!.level, 1);
  assert.equal(bands.find((b) => b.id === "green")!.color, "#22c55e");
  // Shipped bands are neutral ("*") — they apply to every methodology.
  for (const b of bands) assert.deepEqual(b.methodologies, ["*"]);
});

test("ragBandsForMethodology surfaces neutral bands for any methodology", () => {
  const forGtd = ragBandsForMethodology("gtd");
  assert.ok(forGtd.some((b) => b.id === "green"));
  assert.equal(forGtd.length, CANONICAL_RAG.length);
});

test("band ids line up 1:1 with the classifier's fixed GREEN/AMBER/RED mapping (upper-cased)", () => {
  // The vocabulary re-skins the bands; the api-server classifyRag stays the 3-way classifier (asserted in
  // its own suite). Here we only assert the ids match the classifier's canonical tokens when upper-cased.
  assert.deepEqual([...CANONICAL_RAG].map((id) => id.toUpperCase()), ["RED", "AMBER", "GREEN"]);
});

test("ragVocabulary returns an independent defensive copy", () => {
  const a = ragVocabulary();
  a[0]!.label = "MUTATED";
  assert.notEqual(ragVocabulary()[0]!.label, "MUTATED");
});
