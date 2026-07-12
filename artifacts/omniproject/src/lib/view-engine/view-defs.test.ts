import { describe, it, expect } from "vitest";
import { builtinViewsFor, savedViewToDefinition } from "./view-defs";
import type { EntityDescriptor } from "./types";
import type { SavedView } from "../saved-views";

const descriptor = {
  entity: "widget",
  noun: "widget",
  presets: [{ id: "board", label: "Board", columns: [{ status: "todo", label: "To do" }] }],
  fields: [
    { key: "status", label: "Status", get: () => "todo" },
    { key: "due", label: "Due", get: () => "2026-07-01", isDate: true },
  ],
  filterStatuses: ["todo"],
  closedStatuses: ["done"],
  doneStatus: "done",
  reopenStatus: "todo",
  useRecords: () => ({ records: [], isLoading: false, error: null }),
  useMove: () => () => {},
  usePriorityLabel: () => () => "",
} as unknown as EntityDescriptor;

describe("builtinViewsFor", () => {
  it("derives read-only list, table, timeline and one board per preset", () => {
    const defs = builtinViewsFor(descriptor);
    expect(defs.map((d) => d.name)).toEqual(["List", "Table", "Timeline", "Board"]);
    expect(defs.every((d) => d.builtin)).toBe(true);
    expect(defs.find((d) => d.kind === "list")!.statusFilter).toBe(true);
  });

  it("omits the timeline built-in when the entity has no date field", () => {
    const noDate = { ...descriptor, fields: [{ key: "status", label: "Status", get: () => "todo" }] } as unknown as EntityDescriptor;
    expect(builtinViewsFor(noDate).some((d) => d.kind === "timeline")).toBe(false);
  });
});

describe("savedViewToDefinition", () => {
  it("adapts a saved view into an editable (non-builtin) definition", () => {
    const sv: SavedView = { id: "s1", name: "Mine", entity: "task", viewKind: "table", columns: ["status"] };
    const def = savedViewToDefinition(sv);
    expect(def).toMatchObject({ id: "s1", name: "Mine", entity: "task", kind: "table", builtin: false, columns: ["status"] });
  });

  it("defaults an omitted viewKind to list", () => {
    expect(savedViewToDefinition({ id: "s2", name: "L", entity: "task" }).kind).toBe("list");
  });
});
