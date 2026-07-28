import { describe, it, expect } from "vitest";
import { toSwimlanes } from "./swimlane";
import type { EntityField, ViewRecord } from "./types";

type Raw = { id: string; owner?: string };
const rec = (id: string, owner?: string): ViewRecord<Raw> => ({ id, title: id, status: "todo", priority: null, chips: [], raw: { id, owner } });
const fields: EntityField<Raw>[] = [{ key: "owner", label: "Owner", get: (r) => r.owner }];

describe("toSwimlanes", () => {
  it("partitions records into lanes by the field, unset value in a trailing — lane", () => {
    const lanes = toSwimlanes([rec("a", "ada"), rec("b"), rec("c", "bob"), rec("d", "ada")], "owner", fields);
    expect(lanes.map((l) => l.key)).toEqual(["ada", "bob", "—"]); // — sorts last
    expect(lanes.find((l) => l.key === "ada")!.records.map((r) => r.id)).toEqual(["a", "d"]);
    expect(lanes.find((l) => l.key === "—")!.records.map((r) => r.id)).toEqual(["b"]);
  });

  it("resolves lane labels through the provided vocabulary mapper", () => {
    const label = (v: string) => (v === "ada" ? "Ada Lovelace" : v);
    const lanes = toSwimlanes([rec("a", "ada")], "owner", fields, label);
    expect(lanes[0]!.label).toBe("Ada Lovelace");
  });

  it("returns no lanes (flat board) when there is no groupBy or the field is unknown", () => {
    expect(toSwimlanes([rec("a", "ada")], undefined, fields)).toEqual([]);
    expect(toSwimlanes([rec("a", "ada")], "nope", fields)).toEqual([]);
  });
});
