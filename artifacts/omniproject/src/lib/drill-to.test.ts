import { describe, it, expect } from "vitest";
import type { DrillTo } from "@workspace/backend-catalogue";
import { resolveDrillTo, readDrillFilter, DRILL_FILTER_PARAMS } from "./drill-to";
import { matchRow } from "./custom-report";

/**
 * backlog #122 — the SPA drill-down resolver: DrillTo descriptor + clicked row → a concrete grid href,
 * and the inverse (URL → predicate) IssueGrid reads back. The round trip is what makes a red "N blocked"
 * figure a one-click path to the filtered grid.
 */

const BLOCKED_DRILL: DrillTo = {
  target: "grid",
  projectIdField: "projectId",
  predicate: { all: [{ field: "blocked", op: "truthy" }] },
  label: "Blocked items",
};

describe("resolveDrillTo", () => {
  it("resolves a static predicate against the clicked row into a project-scoped grid href", () => {
    const resolved = resolveDrillTo(BLOCKED_DRILL, { projectId: "alpha", activeBlockersCount: 4 });
    expect(resolved).not.toBeNull();
    expect(resolved!.predicate).toEqual({ all: [{ field: "blocked", op: "truthy" }] });
    expect(resolved!.label).toBe("Blocked items");
    expect(resolved!.href).toBe(
      `/projects/alpha?filter=${encodeURIComponent(JSON.stringify({ all: [{ field: "blocked", op: "truthy" }] }))}&filterLabel=Blocked+items`,
    );
  });

  it("returns null when the row is missing the field the project id comes from", () => {
    expect(resolveDrillTo(BLOCKED_DRILL, { activeBlockersCount: 4 })).toBeNull();
    expect(resolveDrillTo(BLOCKED_DRILL, { projectId: "" })).toBeNull();
  });

  it("returns null for a non-grid target (future-proofing, nothing implements it yet)", () => {
    const notYetSupported = { target: "kanban" } as unknown as DrillTo;
    expect(resolveDrillTo(notYetSupported, { projectId: "p1" })).toBeNull();
  });

  it("derives a predicate value from the clicked row via predicateFrom", () => {
    const drill: DrillTo = {
      target: "grid",
      projectIdField: "projectId",
      predicateFrom: [{ field: "assignee", op: "eq", fromField: "owner" }],
    };
    const resolved = resolveDrillTo(drill, { projectId: "p1", owner: "ada" });
    expect(resolved!.predicate).toEqual({ all: [{ field: "assignee", op: "eq", value: "ada" }] });
  });

  it("abandons the drill-through when a row-derived condition has nothing to read", () => {
    const drill: DrillTo = {
      target: "grid",
      projectIdField: "projectId",
      predicateFrom: [{ field: "assignee", op: "eq", fromField: "owner" }],
    };
    expect(resolveDrillTo(drill, { projectId: "p1" })).toBeNull();
  });

  it("returns null when the descriptor produces no conditions at all", () => {
    expect(resolveDrillTo({ target: "grid", projectIdField: "projectId" }, { projectId: "p1" })).toBeNull();
  });

  it("falls back to an auto-summary label when the descriptor declares none", () => {
    const drill: DrillTo = { target: "grid", predicate: { all: [{ field: "status", op: "eq", value: "done" }] } };
    const resolved = resolveDrillTo(drill, {});
    expect(resolved!.label).toBe("status = done");
  });

  it("ANDs a static predicate with row-derived conditions", () => {
    const drill: DrillTo = {
      target: "grid",
      predicate: { all: [{ field: "blocked", op: "truthy" }] },
      predicateFrom: [{ field: "priority", op: "eq", fromField: "priorityFilter" }],
    };
    const resolved = resolveDrillTo(drill, { priorityFilter: "urgent" });
    expect(resolved!.predicate).toEqual({
      all: [
        { field: "blocked", op: "truthy" },
        { field: "priority", op: "eq", value: "urgent" },
      ],
    });
  });

  it("navigates to /projects when the descriptor is not project-scoped", () => {
    const drill: DrillTo = { target: "grid", predicate: { all: [{ field: "blocked", op: "truthy" }] } };
    const resolved = resolveDrillTo(drill, {});
    expect(resolved!.href.startsWith("/projects?")).toBe(true);
  });
});

describe("readDrillFilter / resolveDrillTo round trip", () => {
  it("reads back exactly the predicate + label resolveDrillTo wrote", () => {
    const resolved = resolveDrillTo(BLOCKED_DRILL, { projectId: "alpha" })!;
    const url = new URL(resolved.href, "https://example.test");
    const read = readDrillFilter(url.searchParams);
    expect(read).toEqual({ predicate: resolved.predicate, label: resolved.label });
  });

  it("returns null when there is no filter param", () => {
    expect(readDrillFilter(new URLSearchParams())).toBeNull();
  });

  it("degrades to null on an unparsable filter param instead of throwing", () => {
    const params = new URLSearchParams({ filter: "{not-json" });
    expect(readDrillFilter(params)).toBeNull();
  });

  it("DRILL_FILTER_PARAMS names both params resolveDrillTo writes, for a caller to clear", () => {
    expect(DRILL_FILTER_PARAMS).toEqual(["filter", "filterLabel"]);
  });

  it("the resolved predicate actually filters rows via the shared matchRow engine", () => {
    const resolved = resolveDrillTo(BLOCKED_DRILL, { projectId: "alpha" })!;
    const rows = [{ id: "1", blocked: true }, { id: "2", blocked: false }, { id: "3", blocked: true }];
    expect(rows.filter((r) => matchRow(resolved.predicate, r)).map((r) => r.id)).toEqual(["1", "3"]);
  });
});
