import { describe, it, expect } from "vitest";
import { rowsToScheduleEdges, dependencyRowId, projectDependenciesQueryKey, type DependencyRow } from "./project-dependencies";
import { toCpmEdges } from "../components/reports/CriticalPath";
import { dependencyEdgesToTyped } from "./schedule-adapter";

/**
 * The durable dependency adapter (§5.5). A dependency edge is a row in the generic `dependencies` mapping slot,
 * NOT a bespoke entity. `rowsToScheduleEdges` turns each `{fromId,toId,kind}` row into the SAME `DependencyEdge`
 * shape the schedulers already consume, so CPM + the auto-scheduler run on durable precedence identically to
 * the volatile overlay.
 */

const row = (fromId: string, toId: string, kind: DependencyRow["kind"] = "blocks"): DependencyRow => ({ fromId, toId, kind });

describe("rowsToScheduleEdges", () => {
  it("maps a slot row onto a DependencyEdge in this project (both endpoints projectRef=projectId)", () => {
    const [e] = rowsToScheduleEdges([row("a", "b")], "p1");
    expect(e!.from).toEqual({ system: "dependencies", projectRef: "p1", itemRef: "a" });
    expect(e!.to).toEqual({ system: "dependencies", projectRef: "p1", itemRef: "b" });
    expect(e!.type).toBe("blocks");
    expect(e!.edgeKey).toBe(dependencyRowId("a", "blocks", "b"));
  });

  it("carries an optional note and honours a supplied system label", () => {
    const [e] = rowsToScheduleEdges([{ fromId: "a", toId: "b", kind: "depends_on", note: "schema first" }], "p1", "jira");
    expect(e!.note).toBe("schema first");
    expect(e!.from.system).toBe("jira");
  });

  it("drops malformed rows (missing an endpoint)", () => {
    expect(rowsToScheduleEdges([{ fromId: "a", toId: "", kind: "blocks" }], "p1")).toEqual([]);
  });

  it("feeds CPM identically to a volatile edge — blocks→forward, depends_on→reverse, relates_to→none", () => {
    const ids = new Set(["a", "b"]);
    const edges = rowsToScheduleEdges([row("a", "b", "blocks"), row("a", "b", "depends_on"), row("a", "b", "relates_to")], "p1");
    expect(toCpmEdges(edges, "p1", ids)).toEqual([{ from: "a", to: "b" }, { from: "b", to: "a" }]);
  });

  it("feeds the auto-scheduler adapter as FS precedence within the project", () => {
    const ids = new Set(["a", "b"]);
    const typed = dependencyEdgesToTyped(rowsToScheduleEdges([row("a", "b", "blocks")], "p1"), "p1", ids);
    expect(typed).toEqual([{ predecessorId: "a", successorId: "b", kind: "FS", lagWorkingDays: 0 }]);
  });
});

describe("dependencyRowId", () => {
  it("is the composite from·kind·to key (idempotent on re-assert)", () => {
    expect(dependencyRowId("a", "blocks", "b")).toBe("a__blocks__b");
  });
});

describe("projectDependenciesQueryKey", () => {
  it("is the generic mapping-rows key for the dependencies slot, project-scoped", () => {
    expect(projectDependenciesQueryKey("p1")).toEqual(["mapping-rows", "dependencies", "p1"]);
    expect(projectDependenciesQueryKey("p2")).not.toEqual(projectDependenciesQueryKey("p1"));
  });
});
