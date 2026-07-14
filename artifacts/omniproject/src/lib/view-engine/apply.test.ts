import { describe, it, expect } from "vitest";
import { applyFiltersSort, groupRecords } from "./apply";
import type { EntityField, ViewRecord } from "./types";

interface W { id: string; status: string; prio: string; note?: string | null }
const F: EntityField<W>[] = [
  { key: "status", label: "Status", get: (w) => w.status },
  { key: "prio", label: "Priority", get: (w) => w.prio },
  { key: "note", label: "Note", get: (w) => w.note ?? null },
];
const rec = (id: string, status: string, prio: string): ViewRecord<W> => ({ id, title: id, status, priority: prio, chips: [], raw: { id, status, prio } });
const RECS = [rec("a", "next", "high"), rec("b", "waiting", "low"), rec("c", "next", "low")];

describe("applyFiltersSort", () => {
  it("AND-combines equality filters", () => {
    const out = applyFiltersSort(RECS, { id: "v", name: "v", filters: [{ field: "status", value: "next" }, { field: "prio", value: "low" }] }, F);
    expect(out.map((r) => r.id)).toEqual(["c"]);
  });

  it("ignores filters on unknown fields", () => {
    const out = applyFiltersSort(RECS, { id: "v", name: "v", filters: [{ field: "nope", value: "x" }] }, F);
    expect(out).toHaveLength(3);
  });

  it("sorts ascending and descending by a field", () => {
    const asc = applyFiltersSort(RECS, { id: "v", name: "v", sort: { field: "status", dir: "asc" } }, F);
    expect(asc.map((r) => r.status)).toEqual(["next", "next", "waiting"]);
    const desc = applyFiltersSort(RECS, { id: "v", name: "v", sort: { field: "status", dir: "desc" } }, F);
    expect(desc[0]!.status).toBe("waiting");
  });

  it("leaves the list untouched when sorting by an unknown field", () => {
    const out = applyFiltersSort(RECS, { id: "v", name: "v", sort: { field: "nope", dir: "asc" } }, F);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]); // original order preserved
  });

  it("keeps equal-keyed records in their original relative order (stable, returns 0)", () => {
    const out = applyFiltersSort(RECS, { id: "v", name: "v", sort: { field: "prio", dir: "asc" } }, F);
    // b and c both "low" — their input order (b before c) is preserved.
    expect(out.filter((r) => r.priority === "low").map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("coerces a null field value to '' when filtering (matches an empty target)", () => {
    const out = applyFiltersSort(RECS, { id: "v", name: "v", filters: [{ field: "note", value: "" }] }, F);
    expect(out).toHaveLength(3); // every note is null ⇒ "" ⇒ matches value ""
  });
});

describe("groupRecords", () => {
  it("returns a single group when no groupBy", () => {
    expect(groupRecords(RECS, undefined, F)).toHaveLength(1);
  });

  it("splits into labelled groups by a field", () => {
    const groups = groupRecords(RECS, "status", F);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.records.length]));
    expect(byKey).toEqual({ next: 2, waiting: 1 });
  });

  it("returns a single group when the groupBy field is unknown", () => {
    const groups = groupRecords(RECS, "nope", F);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("");
  });

  it("collapses falsy group values under '—'", () => {
    const recs = [rec("a", "", "high"), rec("b", "next", "low")];
    const groups = groupRecords(recs, "status", F);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.records.length]));
    expect(byKey).toEqual({ "—": 1, next: 1 });
  });
});
