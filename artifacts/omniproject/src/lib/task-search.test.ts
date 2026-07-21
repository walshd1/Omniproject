import { describe, it, expect } from "vitest";
import { parseTaskSearch } from "./task-search";
import { filterRowsBoolean, type Row } from "@workspace/backend-catalogue";

describe("parseTaskSearch", () => {
  it("splits free text from structured operators", () => {
    const { text, where } = parseTaskSearch("call bank #urgent @calls priority>=high");
    expect(text).toBe("call bank");
    expect(where).toEqual({
      all: [
        { field: "tags", op: "has", value: "urgent" },
        { field: "context", op: "eq", value: "calls" },
        { field: "priority", op: "gte", value: "high", kind: "ordinal", levels: expect.anything() },
      ],
    });
  });

  it("compiles to a tree the shared engine runs (over rows enriched with _urgency/_untouched)", () => {
    const rows: Row[] = [
      { id: 1, tags: ["home"], _urgency: "overdue", priority: "urgent", status: "next" },
      { id: 2, tags: ["home"], _urgency: "scheduled", priority: "low", status: "next" },
      { id: 3, tags: ["work"], _urgency: "overdue", priority: "high", status: "next" },
    ];
    const { where } = parseTaskSearch("#home is:overdue priority>=high");
    expect(filterRowsBoolean(rows, where).map((r) => r["id"])).toEqual([1]);
  });

  it("negates any operator with a leading -", () => {
    const rows: Row[] = [
      { id: 1, status: "done" },
      { id: 2, status: "next" },
    ];
    const { where } = parseTaskSearch("-is:done");
    expect(filterRowsBoolean(rows, where).map((r) => r["id"])).toEqual([2]);
  });

  it("maps is: aliases and status/priority equals", () => {
    expect(parseTaskSearch("is:today").where).toEqual({ all: [{ field: "_urgency", op: "eq", value: "due-today" }] });
    expect(parseTaskSearch("is:untouched").where).toEqual({ all: [{ field: "_untouched", op: "truthy" }] });
    expect(parseTaskSearch("status:waiting p:high").where).toEqual({
      all: [{ field: "status", op: "eq", value: "waiting" }, { field: "priority", op: "eq", value: "high" }],
    });
  });

  it("an empty query matches everything", () => {
    const { text, where } = parseTaskSearch("   ");
    expect(text).toBe("");
    expect(where).toEqual({ all: [] });
    const rows: Row[] = [{ id: 1 }, { id: 2 }];
    expect(filterRowsBoolean(rows, where).length).toBe(2);
  });
});
