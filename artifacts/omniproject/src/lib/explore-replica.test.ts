import { describe, it, expect } from "vitest";
import type { Issue } from "@workspace/api-client-react";
import {
  applyIssueOverlay,
  newOverlay,
  resolveReplica,
  type ExploreReplica,
} from "./explore-replica";

const issue = (id: string, over: Partial<Issue> = {}): Issue =>
  ({ id, projectId: "p1", title: id, status: "todo", priority: "medium", version: 1, ...over }) as unknown as Issue;

const replica = (): ExploreReplica => ({
  schema: 1,
  label: "test",
  capturedAt: "2026-06-26T00:00:00Z",
  responses: {
    "/api/projects": [{ id: "p1", name: "Alpha" }],
    "/api/projects/p1/issues": [issue("A"), issue("B")],
    "/api/projects/p1/summary": { completionPct: 50 },
  },
});

describe("applyIssueOverlay", () => {
  it("applies updates, deletes, and additions", () => {
    const ov = newOverlay();
    ov.updated["A"] = { status: "done" };
    ov.deleted.push("B");
    ov.added["p1"] = [issue("C")];
    const out = applyIssueOverlay([issue("A"), issue("B")], ov, "p1");
    expect(out.map((i) => i.id)).toEqual(["A", "C"]);
    expect(out.find((i) => i.id === "A")!.status).toBe("done");
  });
});

describe("resolveReplica — reads", () => {
  it("serves recorded GETs", () => {
    const r = resolveReplica(replica(), newOverlay(), { method: "GET", url: "/api/projects/p1/summary", body: null });
    expect(r).toEqual({ handled: true, data: { completionPct: 50 } });
  });

  it("serves issue lists with the overlay applied", () => {
    const ov = newOverlay();
    ov.deleted.push("B");
    const r = resolveReplica(replica(), ov, { method: "GET", url: "/api/projects/p1/issues", body: null });
    expect(r.handled).toBe(true);
    expect((r as { data: Issue[] }).data.map((i) => i.id)).toEqual(["A"]);
  });

  it("returns null for an unrecorded path (never the network)", () => {
    const r = resolveReplica(replica(), newOverlay(), { method: "GET", url: "/api/projects/zzz/issues", body: null });
    expect(r).toEqual({ handled: true, data: [] }); // issues collection → empty list
    const r2 = resolveReplica(replica(), newOverlay(), { method: "GET", url: "/api/nope", body: null });
    expect(r2).toEqual({ handled: true, data: null });
  });

  it("strips the query string before lookup", () => {
    const r = resolveReplica(replica(), newOverlay(), { method: "GET", url: "/api/projects/p1/summary?x=1", body: null });
    expect((r as { data: unknown }).data).toEqual({ completionPct: 50 });
  });
});

describe("resolveReplica — writes go to the overlay, not the network", () => {
  it("creates an issue into the overlay and returns it", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, {
      method: "POST",
      url: "/api/projects/p1/issues",
      body: JSON.stringify({ title: "New", status: "in_progress" }),
    });
    const created = (r as { data: Issue }).data;
    expect(created.title).toBe("New");
    expect(created.projectId).toBe("p1");
    expect(ov.added["p1"]).toHaveLength(1);
    // and it now shows up in the read
    const list = resolveReplica(replica(), ov, { method: "GET", url: "/api/projects/p1/issues", body: null });
    expect((list as { data: Issue[] }).data.map((i) => i.title)).toContain("New");
  });

  it("patches an issue (dropping expectedVersion) and returns the merged issue", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, {
      method: "PATCH",
      url: "/api/projects/p1/issues/A",
      body: JSON.stringify({ status: "done", expectedVersion: 1 }),
    });
    expect((r as { data: Issue }).data.status).toBe("done");
    expect(ov.updated["A"]).toEqual({ status: "done" });
  });

  it("deletes an issue into the overlay", () => {
    const ov = newOverlay();
    resolveReplica(replica(), ov, { method: "DELETE", url: "/api/projects/p1/issues/A", body: null });
    expect(ov.deleted).toContain("A");
    const list = resolveReplica(replica(), ov, { method: "GET", url: "/api/projects/p1/issues", body: null });
    expect((list as { data: Issue[] }).data.map((i) => i.id)).toEqual(["B"]);
  });
});
