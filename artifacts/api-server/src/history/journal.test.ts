import { test } from "node:test";
import assert from "node:assert/strict";
import { diffToJournal } from "./journal";

const meta = { changedAt: "2026-01-01T00:00:00Z", changedBy: "u1", txnId: "t1" };

test("emits one entry per genuinely-changed field; unchanged fields produce nothing", () => {
  const entries = diffToJournal("issue", "1", { title: "A", budget: 5 }, { title: "B", budget: 5 }, meta);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.field, "title");
  assert.equal(entries[0]!.oldValue, "A");
  assert.equal(entries[0]!.newValue, "B");
  assert.equal(entries[0]!.txnId, "t1");
});

test("a field new to prev records oldValue null", () => {
  const entries = diffToJournal("issue", "1", {}, { title: "New" }, meta);
  assert.equal(entries[0]!.oldValue, null);
  assert.equal(entries[0]!.newValue, "New");
});

test("0 and false are real values — a change to/from them is journalled", () => {
  const entries = diffToJournal("issue", "1", { blocked: true }, { blocked: false, count: 0 }, meta);
  const fields = entries.map((e) => e.field).sort();
  assert.deepEqual(fields, ["blocked", "count"]);
});

test("structural values (arrays/objects) diff by deep equality, not reference", () => {
  const same = diffToJournal("issue", "1", { labels: ["a", "b"] }, { labels: ["a", "b"] }, meta);
  assert.equal(same.length, 0);
  const diff = diffToJournal("issue", "1", { labels: ["a"] }, { labels: ["a", "b"] }, meta);
  assert.equal(diff.length, 1);
});

test("a patch only touches the fields it names — absent fields are untouched", () => {
  const entries = diffToJournal("issue", "1", { title: "A", budget: 5 }, { budget: 9 }, meta);
  assert.deepEqual(entries.map((e) => e.field), ["budget"]);
});
