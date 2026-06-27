import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseStatus,
  statusClassOf,
  isDone,
  isClosed,
  ragFor,
  financialHealthFrom,
  ragBuckets,
  type StatusVocabulary,
} from "../broker/vocabulary";

/**
 * Canonical vocabulary tests — the cross-backend status/priority/RAG meanings,
 * the synonym folding, the data-driven StatusVocabulary override, and the RAG /
 * financial-health policies the roll-ups depend on.
 */

test("status synonyms fold onto canonical statuses (case/space-insensitive)", () => {
  assert.equal(normaliseStatus("Done"), "done");
  assert.equal(normaliseStatus("CLOSED"), "done");
  assert.equal(normaliseStatus("Completed"), "done");
  assert.equal(normaliseStatus("In Progress"), "in_progress");
  assert.equal(normaliseStatus("review"), "in_review");
  assert.equal(normaliseStatus("Open"), "todo");
  assert.equal(normaliseStatus("something-bespoke"), null);
  assert.equal(normaliseStatus(""), null);
  assert.equal(normaliseStatus(undefined), null);
});

test("a backend's declared StatusVocabulary overrides the shared synonyms", () => {
  // A backend whose "open" actually means in-progress, declared as data not code.
  const vocab: StatusVocabulary = { toCanonical: { open: "in_progress", shipped: "done" } };
  assert.equal(normaliseStatus("open", vocab), "in_progress"); // override wins
  assert.equal(normaliseStatus("shipped", vocab), "done"); // vendor-specific term
  assert.equal(normaliseStatus("closed", vocab), "done"); // falls through to synonyms
});

test("statusClassOf / isDone / isClosed classify correctly", () => {
  assert.equal(statusClassOf("done"), "done");
  assert.equal(statusClassOf("in_progress"), "active");
  assert.equal(statusClassOf("todo"), "open");
  assert.equal(statusClassOf("cancelled"), "cancelled");
  assert.equal(statusClassOf("totally-unknown"), "open"); // unknown → open (not done)

  assert.equal(isDone("resolved"), true);
  assert.equal(isDone("in_progress"), false);
  assert.equal(isClosed("cancelled"), true); // terminal but not done
  assert.equal(isClosed("done"), true);
  assert.equal(isClosed("todo"), false);
});

test("ragFor applies the completion thresholds (≥60 green, ≥25 amber)", () => {
  assert.equal(ragFor(100), "GREEN");
  assert.equal(ragFor(60), "GREEN");
  assert.equal(ragFor(59), "AMBER");
  assert.equal(ragFor(25), "AMBER");
  assert.equal(ragFor(24), "RED");
  assert.equal(ragFor(0), "RED");
});

test("financialHealthFrom prefers CPI, falls back to spend ratio", () => {
  assert.equal(financialHealthFrom(1.1, 100, 50), "GREEN"); // CPI ≥ 1
  assert.equal(financialHealthFrom(0.95, 100, 50), "AMBER"); // 0.9 ≤ CPI < 1
  assert.equal(financialHealthFrom(0.8, 100, 50), "RED"); // CPI < 0.9
  assert.equal(financialHealthFrom(null, 0, 0), "GREEN"); // no budget → green
  assert.equal(financialHealthFrom(null, 100, 50), "GREEN"); // ratio 0.5
  assert.equal(financialHealthFrom(null, 100, 95), "AMBER"); // ratio ≥ 0.9
  assert.equal(financialHealthFrom(null, 100, 120), "RED"); // overspent
});

test("ragBuckets returns a fresh zeroed tally", () => {
  const b = ragBuckets();
  assert.deepEqual(b, { GREEN: 0, AMBER: 0, RED: 0 });
  b.GREEN += 1;
  assert.equal(ragBuckets().GREEN, 0, "buckets must not share state");
});
