import { describe, it, expect } from "vitest";
import { brokeredToScheduleEdges, projectDependenciesQueryKey, type BrokeredDependency } from "./project-dependencies";
import { toCpmEdges } from "../components/reports/CriticalPath";
import { dependencyEdgesToTyped } from "./schedule-adapter";

/**
 * The durable/brokered dependency adapter (§5.5 slice 3). `brokeredToScheduleEdges` turns the broker's
 * within-project `{fromId,toId,kind}` links into the SAME `DependencyEdge` shape the schedulers already
 * consume, so CPM + the auto-scheduler run on durable precedence identically to the volatile overlay.
 */

const link = (fromId: string, toId: string, kind: BrokeredDependency["kind"] = "blocks"): BrokeredDependency => ({ fromId, toId, kind });

describe("brokeredToScheduleEdges", () => {
  it("maps a brokered link onto a DependencyEdge in this project (both endpoints projectRef=projectId)", () => {
    const [e] = brokeredToScheduleEdges([link("a", "b")], "p1");
    expect(e!.from).toEqual({ system: "brokered", projectRef: "p1", itemRef: "a" });
    expect(e!.to).toEqual({ system: "brokered", projectRef: "p1", itemRef: "b" });
    expect(e!.type).toBe("blocks");
    expect(e!.edgeKey).toBe("brokered:a:blocks:b");
  });

  it("carries an optional note and honours a supplied system label", () => {
    const [e] = brokeredToScheduleEdges([{ fromId: "a", toId: "b", kind: "depends_on", note: "schema first" }], "p1", "jira");
    expect(e!.note).toBe("schema first");
    expect(e!.from.system).toBe("jira");
  });

  it("feeds CPM identically to a volatile edge — blocks→forward, depends_on→reverse, relates_to→none", () => {
    const ids = new Set(["a", "b"]);
    const edges = brokeredToScheduleEdges([link("a", "b", "blocks"), link("a", "b", "depends_on"), link("a", "b", "relates_to")], "p1");
    // blocks a→b and depends_on a←b, relates_to dropped.
    expect(toCpmEdges(edges, "p1", ids)).toEqual([{ from: "a", to: "b" }, { from: "b", to: "a" }]);
  });

  it("feeds the auto-scheduler adapter as FS precedence within the project", () => {
    const ids = new Set(["a", "b"]);
    const typed = dependencyEdgesToTyped(brokeredToScheduleEdges([link("a", "b", "blocks")], "p1"), "p1", ids);
    expect(typed).toEqual([{ predecessorId: "a", successorId: "b", kind: "FS", lagWorkingDays: 0 }]);
  });
});

describe("projectDependenciesQueryKey", () => {
  it("is stable and project-scoped", () => {
    expect(projectDependenciesQueryKey("p1")).toEqual(["project-dependencies", "p1"]);
    expect(projectDependenciesQueryKey("p2")).not.toEqual(projectDependenciesQueryKey("p1"));
  });
});
