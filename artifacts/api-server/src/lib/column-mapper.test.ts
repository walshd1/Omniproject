import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseHeader,
  suggestColumnMapping,
  coerceValue,
  applyColumnMapping,
  mappingFromSuggestions,
} from "./column-mapper";

test("normaliseHeader strips case + punctuation/whitespace", () => {
  assert.equal(normaliseHeader("Due Date"), "duedate");
  assert.equal(normaliseHeader("Story_Points!"), "storypoints");
});

test("exact key/label matches score 1.0", () => {
  const m = suggestColumnMapping(["Title", "status", "Due date"]);
  assert.equal(m[0]!.suggestedField, "title");
  assert.equal(m[0]!.basis, "exact");
  assert.equal(m[0]!.confidence, 1);
  assert.equal(m[1]!.suggestedField, "status");
  assert.equal(m[2]!.suggestedField, "dueDate");
});

test("synonyms map common spreadsheet headers", () => {
  const m = suggestColumnMapping(["Summary", "Owner", "Deadline", "Points", "Tags"]);
  const by = (c: string) => m.find((s) => s.column === c)!;
  assert.equal(by("Summary").suggestedField, "title");
  assert.equal(by("Owner").suggestedField, "assignee");
  assert.equal(by("Deadline").suggestedField, "dueDate");
  assert.equal(by("Points").suggestedField, "storyPoints");
  assert.equal(by("Tags").suggestedField, "labels");
  assert.ok(m.every((s) => s.basis !== "synonym" || s.confidence === 0.9));
});

test("fuzzy matches near-misses but stays below the curated tiers", () => {
  const m = suggestColumnMapping(["Assigne"]); // typo for assignee
  assert.equal(m[0]!.suggestedField, "assignee");
  assert.equal(m[0]!.basis, "fuzzy");
  assert.ok(m[0]!.confidence <= 0.85 && m[0]!.confidence >= 0.6);
});

test("unrecognised headers are left unmapped (nothing silently dropped)", () => {
  const m = suggestColumnMapping(["Wibble Quux Zorp"]);
  assert.equal(m[0]!.suggestedField, null);
  assert.equal(m[0]!.basis, "none");
});

test("two columns claiming the same field — highest confidence wins, other unmaps", () => {
  // "Title" (exact 1.0) and "Summary" (synonym 0.9) both want `title`.
  const m = suggestColumnMapping(["Summary", "Title"]);
  const title = m.find((s) => s.column === "Title")!;
  const summary = m.find((s) => s.column === "Summary")!;
  assert.equal(title.suggestedField, "title");
  assert.equal(summary.suggestedField, null, "the lower-confidence claimant is demoted");
});

test("coerceValue converts by field type", () => {
  assert.equal(coerceValue("42", "number"), 42);
  assert.equal(coerceValue("£1,200", "currency"), 1200);
  assert.equal(coerceValue("Yes", "boolean"), true);
  assert.equal(coerceValue("2026-03-01", "date"), "2026-03-01");
  assert.deepEqual(coerceValue("a, b ; c", "labels"), ["a", "b", "c"]);
  assert.equal(coerceValue("", "number"), null);
});

test("coerceValue is lossless when it cannot parse (never silently nulls a value)", () => {
  assert.equal(coerceValue("not-a-number", "number"), "not-a-number");
  assert.equal(coerceValue("maybe", "boolean"), "maybe");
});

test("applyColumnMapping builds canonical payloads, dropping unmapped columns", () => {
  const headers = ["Summary", "Owner", "Points", "Mystery"];
  const mapping = mappingFromSuggestions(suggestColumnMapping(headers));
  const rows = [
    { Summary: "Build login", Owner: "alice", Points: "5", Mystery: "ignore me" },
    { Summary: "Fix bug", Owner: "bob", Points: "3", Mystery: "also ignored" },
  ];
  const out = applyColumnMapping(rows, mapping);
  assert.deepEqual(out[0], { title: "Build login", assignee: "alice", storyPoints: 5 });
  assert.equal("Mystery" in out[1]!, false);
  assert.equal(out[1]!["storyPoints"], 3);
});
