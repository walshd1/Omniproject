import { describe, it, expect, vi } from "vitest";
import type { BuiltinArtifactDef } from "./builtin-defs";

// Mock the artifact catalogue so every branch of the adapter is reachable with hand-built specs,
// independent of which JSON files happen to ship under builtin/artifacts/*.
const ARTIFACTS: BuiltinArtifactDef[] = [
  // A non-view artifact for the target entity — must be filtered out by kind.
  { id: "report.x", kind: "report", label: "Report", builtin: true, spec: { entity: "task" } },
  // A view for a different entity — filtered out by entity.
  { id: "view.other", kind: "view", label: "Other", builtin: true, spec: { entity: "risk", viewKind: "table" } },
  // Known viewKind + a well-formed chart object + columns + dateField → all optional fields carried.
  {
    id: "view.full",
    kind: "view",
    label: "Full",
    builtin: true,
    spec: {
      entity: "task",
      viewKind: "timeline",
      chart: { type: "bar", groupField: "status" },
      columns: ["title", "status"],
      dateField: "dueDate",
    },
  },
  // Unknown viewKind → falls back to "list"; chart not an object; columns not an array;
  // dateField not a string → none of the optional fields are attached.
  {
    id: "view.fallback",
    kind: "view",
    label: "Fallback",
    builtin: true,
    spec: {
      entity: "task",
      viewKind: "wobble",
      chart: "nope",
      columns: "title,status",
      dateField: 42,
    },
  },
  // viewKind absent entirely → also falls back to "list".
  { id: "view.nokind", kind: "view", label: "No kind", builtin: true, spec: { entity: "task" } },
];

vi.mock("./index", () => ({ BUILTIN_ARTIFACTS: ARTIFACTS }));

const { builtinArtifactViewsFor } = await import("./artifact-views");

describe("builtinArtifactViewsFor (branch coverage via mocked catalogue)", () => {
  it("keeps only view-kind artifacts for the requested entity", () => {
    const views = builtinArtifactViewsFor("task");
    const ids = views.map((v) => v.id);
    expect(ids).toEqual(["view.full", "view.fallback", "view.nokind"]);
    expect(ids).not.toContain("report.x"); // wrong kind
    expect(ids).not.toContain("view.other"); // wrong entity
  });

  it("carries chart, columns and dateField when the spec is well-formed", () => {
    const v = builtinArtifactViewsFor("task").find((x) => x.id === "view.full")!;
    expect(v.kind).toBe("timeline");
    expect(v.name).toBe("Full");
    expect(v.entity).toBe("task");
    expect(v.builtin).toBe(true);
    expect(v.chart).toEqual({ type: "bar", groupField: "status" });
    expect(v.columns).toEqual(["title", "status"]);
    expect(v.dateField).toBe("dueDate");
  });

  it("falls back to 'list' for an unknown viewKind and drops malformed optional fields", () => {
    const v = builtinArtifactViewsFor("task").find((x) => x.id === "view.fallback")!;
    expect(v.kind).toBe("list");
    expect(v.chart).toBeUndefined(); // chart was a string, not an object
    expect(v.columns).toBeUndefined(); // columns was a string, not an array
    expect(v.dateField).toBeUndefined(); // dateField was a number, not a string
  });

  it("falls back to 'list' when viewKind is missing", () => {
    const v = builtinArtifactViewsFor("task").find((x) => x.id === "view.nokind")!;
    expect(v.kind).toBe("list");
  });

  it("returns [] for an entity with no view artifacts", () => {
    expect(builtinArtifactViewsFor("nope")).toEqual([]);
  });
});
