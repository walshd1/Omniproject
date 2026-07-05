import { describe, it, expect, afterEach, vi } from "vitest";
import type { Issue } from "@workspace/api-client-react";
import { mockFetchRouter, resetFetchMock, mockBlobDownload } from "../test/utils";
import {
  applyIssueOverlay,
  newOverlay,
  resolveReplica,
  captureReplica,
  exportReplica,
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

  it("leaves the list unchanged for a project with no overlay entries at all", () => {
    const out = applyIssueOverlay([issue("A"), issue("B")], newOverlay(), "p1");
    expect(out.map((i) => i.id)).toEqual(["A", "B"]);
  });

  it("excludes an added issue that was also deleted within the same session", () => {
    const ov = newOverlay();
    ov.added["p1"] = [issue("C")];
    ov.deleted.push("C");
    const out = applyIssueOverlay([issue("A")], ov, "p1");
    expect(out.map((i) => i.id)).toEqual(["A"]);
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

  it("creates an issue with default title/status/priority when the body omits them", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, { method: "POST", url: "/api/projects/p1/issues", body: "{}" });
    const created = (r as { data: Issue }).data;
    expect(created.title).toBe("Untitled");
    expect(created.status).toBe("todo");
    expect(created.priority).toBe("medium");
  });

  it("treats an unparseable body as empty rather than throwing", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, { method: "POST", url: "/api/projects/p1/issues", body: "not json" });
    expect((r as { data: Issue }).data.title).toBe("Untitled");
  });

  it("treats a null body as empty", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, { method: "POST", url: "/api/projects/p1/issues", body: null });
    expect((r as { data: Issue }).data.title).toBe("Untitled");
  });

  it("treats a parsed-but-non-object body (e.g. a bare number) as empty", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, { method: "POST", url: "/api/projects/p1/issues", body: "5" });
    expect((r as { data: Issue }).data.title).toBe("Untitled");
  });

  it("succeeds locally without touching the network for any other write", () => {
    const r = resolveReplica(replica(), newOverlay(), { method: "PUT", url: "/api/projects/p1", body: null });
    expect(r).toEqual({ handled: true, data: null });
  });

  it("succeeds locally for a non-PATCH/DELETE write to an issue item path", () => {
    const r = resolveReplica(replica(), newOverlay(), { method: "PUT", url: "/api/projects/p1/issues/A", body: null });
    expect(r).toEqual({ handled: true, data: null });
  });

  it("patches an issue in a project with no recorded issues list", () => {
    const ov = newOverlay();
    const r = resolveReplica(replica(), ov, {
      method: "PATCH",
      url: "/api/projects/zzz/issues/nope",
      body: JSON.stringify({ status: "done" }),
    });
    expect((r as { data: Issue | null }).data).toBeNull();
    expect(ov.updated["nope"]).toEqual({ status: "done" });
  });

  it("deleting the same issue twice doesn't duplicate the deleted-list entry", () => {
    const ov = newOverlay();
    resolveReplica(replica(), ov, { method: "DELETE", url: "/api/projects/p1/issues/A", body: null });
    resolveReplica(replica(), ov, { method: "DELETE", url: "/api/projects/p1/issues/A", body: null });
    expect(ov.deleted.filter((id) => id === "A")).toHaveLength(1);
  });

  it("falls back to a timestamp-based id when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    try {
      const ov = newOverlay();
      const r = resolveReplica(replica(), ov, { method: "POST", url: "/api/projects/p1/issues", body: "{}" });
      expect((r as { data: Issue }).data.id).toMatch(/^explore-/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("captureReplica", () => {
  afterEach(resetFetchMock);

  it("captures the portfolio-level reads and every project's sub-resources", async () => {
    mockFetchRouter({
      "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] },
      "/api/programmes": { ok: true, body: [{ id: "prog-1", name: "Platform" }] },
      "/api/portfolio/health": { ok: true, body: [{ projectId: "p1", ragStatus: "green" }] },
      "/api/activity": { ok: true, body: [{ id: "a1" }] },
      "/api/capabilities": { ok: true, body: { mode: "demo" } },
      "/api/projects/p1/issues": { ok: true, body: [{ id: "i1", title: "Task" }] },
      "/api/projects/p1/summary": { ok: true, body: { completionPct: 50 } },
      "/api/projects/p1/capacity": { ok: true, body: { available: 10 } },
      "/api/projects/p1/financials": { ok: true, body: { budget: 1000 } },
      "/api/projects/p1/history": { ok: true, body: [] },
      "/api/projects/p1/baseline": { ok: true, body: { startDate: "2026-01-01" } },
      "/api/projects/p1/raid": { ok: true, body: { risks: [] } },
    });

    const captured = await captureReplica("Sprint snapshot");

    expect(captured.schema).toBe(1);
    expect(captured.label).toBe("Sprint snapshot");
    expect(captured.responses["/api/projects"]).toEqual([{ id: "p1", name: "Alpha" }]);
    expect(captured.responses["/api/programmes"]).toEqual([{ id: "prog-1", name: "Platform" }]);
    expect(captured.responses["/api/portfolio/health"]).toEqual([{ projectId: "p1", ragStatus: "green" }]);
    expect(captured.responses["/api/activity"]).toEqual([{ id: "a1" }]);
    expect(captured.responses["/api/capabilities"]).toEqual({ mode: "demo" });
    expect(captured.responses["/api/projects/p1/issues"]).toEqual([{ id: "i1", title: "Task" }]);
    expect(captured.responses["/api/projects/p1/summary"]).toEqual({ completionPct: 50 });
    expect(captured.responses["/api/projects/p1/capacity"]).toEqual({ available: 10 });
    expect(captured.responses["/api/projects/p1/financials"]).toEqual({ budget: 1000 });
    expect(captured.responses["/api/projects/p1/history"]).toEqual([]);
    expect(captured.responses["/api/projects/p1/baseline"]).toEqual({ startDate: "2026-01-01" });
    expect(captured.responses["/api/projects/p1/raid"]).toEqual({ risks: [] });
  });

  it("omits a failing best-effort sub-resource instead of failing the whole capture", async () => {
    mockFetchRouter({
      "/api/projects": { ok: true, body: [{ id: "p1", name: "Alpha" }] },
      "/api/programmes": { ok: false, status: 500, body: { error: "boom" } },
      "/api/projects/p1/issues": { ok: true, body: [] },
      "/api/projects/p1/raid": { ok: false, status: 404, body: {} },
    });

    const captured = await captureReplica("Partial");

    expect(captured.responses["/api/projects"]).toEqual([{ id: "p1", name: "Alpha" }]);
    expect(captured.responses["/api/projects/p1/issues"]).toEqual([]);
    expect(captured.responses).not.toHaveProperty("/api/programmes");
    expect(captured.responses).not.toHaveProperty("/api/projects/p1/raid");
  });
});

describe("exportReplica", () => {
  it("triggers a download named after the capture date", () => {
    const { click, restore } = mockBlobDownload();
    try {
      exportReplica({ schema: 1, label: "test", capturedAt: "2026-06-26T00:00:00Z", responses: {} });
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
