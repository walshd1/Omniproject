import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortRows, filterRows, applyView, compareRows, ordinalLevel, ordinalSortKey,
  asNumber, asDateMs, ORDINAL_LEVELS_BY_KIND, type Row,
} from "./sort-filter";
import { PRIORITY_RANK } from "./work-vocabulary";

const ids = (rows: Row[]) => rows.map((r) => r["id"]);

// ── string ──────────────────────────────────────────────────────────────────
test("string sort is locale-aware (case/accent-insensitive), missing rows sort LAST in both directions", () => {
  const rows: Row[] = [{ id: 1, name: "banana" }, { id: 2, name: "Apple" }, { id: 3, name: "" }, { id: 4, name: "cherry" }];
  assert.deepEqual(ids(sortRows(rows, [{ field: "name", kind: "string", dir: "asc" }])), [2, 1, 4, 3]);
  // desc reverses the present values but keeps the blank last.
  assert.deepEqual(ids(sortRows(rows, [{ field: "name", kind: "string", dir: "desc" }])), [4, 1, 2, 3]);
});

// ── number / date ─────────────────────────────────────────────────────────────
test("number sort is numeric (not lexical) and parses numeric strings", () => {
  const rows: Row[] = [{ id: 1, n: "9" }, { id: 2, n: 100 }, { id: 3, n: "20" }];
  assert.deepEqual(ids(sortRows(rows, [{ field: "n", kind: "number", dir: "asc" }])), [1, 3, 2]);
});

test("date sort is date-aware, so ISO strings order chronologically", () => {
  const rows: Row[] = [{ id: 1, d: "2026-01-02" }, { id: 2, d: "2025-12-31" }, { id: 3, d: "not-a-date" }, { id: 4, d: "2026-01-10" }];
  // Unparseable date sorts last (missing).
  assert.deepEqual(ids(sortRows(rows, [{ field: "d", kind: "date", dir: "asc" }])), [2, 1, 4, 3]);
  assert.equal(asDateMs("2026-01-01"), Date.parse("2026-01-01"));
  assert.equal(asNumber("12"), 12);
  assert.equal(asNumber("x"), null);
});

// ── ordinal (the point: sort by internal level, not label) ─────────────────────
test("ordinal sort keys off the internal level, so priority orders by rank not alphabetically", () => {
  const rows: Row[] = [{ id: 1, priority: "low" }, { id: 2, priority: "urgent" }, { id: 3, priority: "medium" }];
  // desc = most-urgent first (urgent 4 > medium 2 > low 1) — NOT the alphabetical "low, medium, urgent".
  assert.deepEqual(ids(sortRows(rows, [ordinalSortKey("priority", "priority", "desc")])), [2, 3, 1]);
  assert.deepEqual(ids(sortRows(rows, [ordinalSortKey("priority", "priority", "asc")])), [1, 3, 2]);
});

test("ordinal sort works for status (board order), severity and RAG (band)", () => {
  const s: Row[] = [{ id: 1, status: "done" }, { id: 2, status: "backlog" }, { id: 3, status: "in_progress" }];
  assert.deepEqual(ids(sortRows(s, [ordinalSortKey("status", "status", "asc")])), [2, 3, 1]);
  const sev: Row[] = [{ id: 1, sev: "critical" }, { id: 2, sev: "low" }, { id: 3, sev: "high" }];
  assert.deepEqual(ids(sortRows(sev, [ordinalSortKey("sev", "severity", "desc")])), [1, 3, 2]);
  const rag: Row[] = [{ id: 1, rag: "green" }, { id: 2, rag: "red" }, { id: 3, rag: "amber" }];
  assert.deepEqual(ids(sortRows(rag, [ordinalSortKey("rag", "rag", "asc")])), [2, 3, 1]);
});

test("ordinal sort is relabel-proof: a custom level map orders by whatever ids it declares", () => {
  // A scope that relabelled + reordered its own tokens supplies its OWN level map — the sort follows it.
  const rows: Row[] = [{ id: 1, band: "gold" }, { id: 2, band: "silver" }, { id: 3, band: "bronze" }];
  const levels = { bronze: 1, silver: 2, gold: 3 };
  assert.deepEqual(ids(sortRows(rows, [{ field: "band", kind: "ordinal", dir: "desc", levels }])), [1, 2, 3]);
});

test("ordinalLevel resolves shipped tokens (and a status via its canonical binding); unknowns are null", () => {
  assert.equal(ordinalLevel("priority", "urgent"), PRIORITY_RANK["urgent"]);
  assert.equal(ordinalLevel("status", "backlog"), ORDINAL_LEVELS_BY_KIND.status["backlog"]);
  assert.equal(ordinalLevel("severity", "no-such"), null);
  assert.equal(ordinalLevel("priority", ""), null);
});

// ── multi-key + stability ─────────────────────────────────────────────────────
test("multi-key sort: earlier keys dominate, and a full tie preserves input order (stable)", () => {
  const rows: Row[] = [
    { id: 1, sev: "high", d: "2026-01-03" },
    { id: 2, sev: "high", d: "2026-01-01" },
    { id: 3, sev: "low", d: "2026-01-02" },
    { id: 4, sev: "high", d: "2026-01-01" },
  ];
  // Sort by severity desc, then date asc. id2 and id4 tie fully → keep input order (2 before 4).
  assert.deepEqual(ids(sortRows(rows, [ordinalSortKey("sev", "severity", "desc"), { field: "d", kind: "date", dir: "asc" }])), [2, 4, 1, 3]);
});

test("compareRows returns a usable comparator and sortRows never mutates its input", () => {
  const rows: Row[] = [{ id: 2, n: 2 }, { id: 1, n: 1 }];
  const before = ids(rows);
  const sorted = sortRows(rows, [{ field: "n", kind: "number" }]);
  assert.deepEqual(ids(rows), before);          // input untouched
  assert.deepEqual(ids(sorted), [1, 2]);
  assert.equal(typeof compareRows({ field: "n", kind: "number" }), "function");
});

// ── filters ───────────────────────────────────────────────────────────────────
test("filterRows: eq / in / contains, and ordering ops compare number- then date-aware", () => {
  const rows: Row[] = [
    { id: 1, status: "todo", title: "Fix the Bug", due: "2026-01-05" },
    { id: 2, status: "done", title: "Ship it", due: "2026-02-01" },
    { id: 3, status: "todo", title: "bug triage", due: "2026-01-20" },
  ];
  assert.deepEqual(ids(filterRows(rows, [{ field: "status", op: "eq", value: "todo" }])), [1, 3]);
  assert.deepEqual(ids(filterRows(rows, [{ field: "status", op: "in", value: ["done", "todo"] }])), [1, 2, 3]);
  assert.deepEqual(ids(filterRows(rows, [{ field: "title", op: "contains", value: "bug" }])), [1, 3]);
  assert.deepEqual(ids(filterRows(rows, [{ field: "due", op: "lt", value: "2026-01-31" }])), [1, 3]);
});

test("filterRows: an ordinal op compares by level (severity >= high keeps high + critical)", () => {
  const rows: Row[] = [{ id: 1, sev: "low" }, { id: 2, sev: "critical" }, { id: 3, sev: "high" }, { id: 4, sev: "medium" }];
  const kept = filterRows(rows, [{ field: "sev", op: "gte", value: "high", kind: "ordinal", levels: ORDINAL_LEVELS_BY_KIND.severity }]);
  assert.deepEqual(ids(kept).sort(), [2, 3]);
});

test("applyView filters THEN sorts in one pass", () => {
  const rows: Row[] = [
    { id: 1, status: "todo", priority: "low" },
    { id: 2, status: "done", priority: "urgent" },
    { id: 3, status: "todo", priority: "urgent" },
    { id: 4, status: "todo", priority: "medium" },
  ];
  const out = applyView(rows, {
    filters: [{ field: "status", op: "eq", value: "todo" }],
    sort: [ordinalSortKey("priority", "priority", "desc")],
  });
  assert.deepEqual(ids(out), [3, 4, 1]); // done row dropped; remaining by priority urgent→low
});
