import { describe, it, expect, beforeEach } from "vitest";
import type { Project, PortfolioHealthSummary } from "@workspace/api-client-react";
import {
  createSnapshot,
  validateSnapshot,
  parseSnapshotFile,
  loadSnapshots,
  saveSnapshots,
  addSnapshots,
  removeSnapshot,
  buildBundle,
  portfolioCompletion,
  buildTrend,
  loadSchedule,
  saveSchedule,
  scheduleActive,
  captureDue,
  type AutoSchedule,
  type PortfolioSnapshot,
} from "./snapshots";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 10, completedCount: 5, memberCount: 1, updatedAt: "" },
  { id: "p2", name: "Beta", identifier: "BE", source: "jira", issueCount: 10, completedCount: 1, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

const portfolio = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "RED", scheduleVarianceDays: -4, budgetVariancePercentage: 8, activeBlockersCount: 2 },
  { projectId: "p2", projectName: "Beta", ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: -2, activeBlockersCount: 0 },
] as unknown as PortfolioHealthSummary[];

beforeEach(() => window.sessionStorage.clear());

describe("createSnapshot", () => {
  it("trims the live read-model into a snapshot with an injectable timestamp", () => {
    const snap = createSnapshot({ projects, portfolio, mode: "live", label: " Q1 " }, "2026-01-01T00:00:00.000Z");
    expect(snap.capturedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snap.label).toBe("Q1");
    expect(snap.mode).toBe("live");
    expect(snap.projects).toHaveLength(2);
    expect(snap.projects[0]).toEqual({ id: "p1", name: "Alpha", issueCount: 10, completedCount: 5 });
    expect(snap.portfolio[0].ragStatus).toBe("RED");
  });

  it("tolerates empty input", () => {
    const snap = createSnapshot({}, "2026-01-01T00:00:00.000Z");
    expect(snap.projects).toEqual([]);
    expect(snap.portfolio).toEqual([]);
  });
});

describe("portfolioCompletion", () => {
  it("computes Σdone / Σissues as a percentage", () => {
    const snap = createSnapshot({ projects }, "2026-01-01T00:00:00.000Z");
    expect(portfolioCompletion(snap)).toBe(30); // (5+1)/(10+10)
  });
  it("guards divide-by-zero", () => {
    const snap = createSnapshot({}, "2026-01-01T00:00:00.000Z");
    expect(portfolioCompletion(snap)).toBe(0);
  });
});

describe("buildTrend", () => {
  const mk = (at: string, done: number): PortfolioSnapshot =>
    createSnapshot({ projects: [{ ...projects[0], completedCount: done } as Project], portfolio }, at);

  it("orders points by capturedAt and computes the chosen metric", () => {
    const snaps = [mk("2026-03-01T00:00:00Z", 9), mk("2026-01-01T00:00:00Z", 1)];
    const trend = buildTrend(snaps, "completion");
    expect(trend.map((p) => p.capturedAt)).toEqual(["2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(trend[0].value).toBe(10); // 1/10
    expect(trend[1].value).toBe(90); // 9/10
  });

  it("supports the blockers and ragRed metrics", () => {
    const snap = createSnapshot({ projects, portfolio }, "2026-01-01T00:00:00Z");
    expect(buildTrend([snap], "blockers")[0].value).toBe(2);
    expect(buildTrend([snap], "ragRed")[0].value).toBe(1);
  });
});

describe("validateSnapshot / parseSnapshotFile", () => {
  it("accepts a structurally valid snapshot", () => {
    const snap = createSnapshot({ projects, portfolio }, "2026-01-01T00:00:00Z");
    expect(validateSnapshot(snap)).not.toBeNull();
  });

  it("rejects malformed objects", () => {
    expect(validateSnapshot(null)).toBeNull();
    expect(validateSnapshot({})).toBeNull();
    expect(validateSnapshot({ capturedAt: "not-a-date", projects: [], portfolio: [] })).toBeNull();
    expect(validateSnapshot({ capturedAt: "2026-01-01T00:00:00Z", projects: {}, portfolio: [] })).toBeNull();
  });

  it("parses a single snapshot and a bundle, ignoring junk", () => {
    const snap = createSnapshot({ projects }, "2026-01-01T00:00:00Z");
    expect(parseSnapshotFile(JSON.stringify(snap))).toHaveLength(1);
    expect(parseSnapshotFile(JSON.stringify(buildBundle([snap])))).toHaveLength(1);
    expect(parseSnapshotFile("not json")).toEqual([]);
    expect(parseSnapshotFile(JSON.stringify({ snapshots: [snap, { bad: true }] }))).toHaveLength(1);
  });

  it("caps an oversized snapshot's rows rather than accepting an unbounded array", () => {
    const huge = {
      capturedAt: "2026-01-01T00:00:00Z",
      projects: Array.from({ length: 10_000 }, (_, i) => ({ id: `p${i}`, name: "X", issueCount: 1, completedCount: 1 })),
      portfolio: Array.from({ length: 10_000 }, (_, i) => ({ projectId: `p${i}`, ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0 })),
    };
    const snap = validateSnapshot(huge);
    expect(snap?.projects.length).toBe(5_000);
    expect(snap?.portfolio.length).toBe(5_000);
  });

  it("caps the number of snapshots accepted from a single imported bundle", () => {
    const snap = createSnapshot({ projects }, "2026-01-01T00:00:00Z");
    const manySnapshots = Array.from({ length: 600 }, (_, i) => ({ ...snap, capturedAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` }));
    const bundle = JSON.stringify({ schema: 1, exportedAt: "2026-01-01T00:00:00Z", snapshots: manySnapshots });
    expect(parseSnapshotFile(bundle)).toHaveLength(500);
  });

  it("strips dangerous keys from an imported bundle via safeParseJson (prototype-pollution guard)", () => {
    const malicious = `{"snapshots":[{"capturedAt":"2026-01-01T00:00:00Z","projects":[],"portfolio":[],"__proto__":{"polluted":true}}]}`;
    parseSnapshotFile(malicious);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("auto-capture schedule", () => {
  const sched = (over: Partial<AutoSchedule> = {}): AutoSchedule => ({
    intervalMinutes: 30,
    endsAt: "2026-01-01T05:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  const at = (iso: string) => Date.parse(iso);

  it("is active before the end instant and inactive after", () => {
    expect(scheduleActive(sched(), at("2026-01-01T02:00:00Z"))).toBe(true);
    expect(scheduleActive(sched(), at("2026-01-01T05:00:00Z"))).toBe(false);
    expect(scheduleActive(sched(), at("2026-01-01T06:00:00Z"))).toBe(false);
    expect(scheduleActive(null, at("2026-01-01T02:00:00Z"))).toBe(false);
    expect(scheduleActive(sched({ intervalMinutes: 0 }), at("2026-01-01T02:00:00Z"))).toBe(false);
  });

  it("captureDue fires immediately, then once per interval, and never past the end", () => {
    const s = sched();
    expect(captureDue(s, null, at("2026-01-01T01:00:00Z"))).toBe(true); // no prior → due now
    expect(captureDue(s, at("2026-01-01T01:00:00Z"), at("2026-01-01T01:20:00Z"))).toBe(false); // 20m < 30m
    expect(captureDue(s, at("2026-01-01T01:00:00Z"), at("2026-01-01T01:30:00Z"))).toBe(true); // 30m elapsed
    expect(captureDue(s, at("2026-01-01T04:50:00Z"), at("2026-01-01T05:30:00Z"))).toBe(false); // past end
  });

  it("persists and clears the schedule in sessionStorage", () => {
    expect(loadSchedule()).toBeNull();
    saveSchedule(sched());
    expect(loadSchedule()?.intervalMinutes).toBe(30);
    saveSchedule(null);
    expect(loadSchedule()).toBeNull();
  });
});

describe("session persistence", () => {
  it("round-trips through sessionStorage", () => {
    const snap = createSnapshot({ projects }, "2026-01-01T00:00:00Z");
    saveSnapshots([snap]);
    expect(loadSnapshots()).toHaveLength(1);
  });

  it("addSnapshots de-dupes by id and keeps capturedAt order", () => {
    const a = createSnapshot({ projects }, "2026-02-01T00:00:00Z");
    const b = createSnapshot({ projects }, "2026-01-01T00:00:00Z");
    let list = addSnapshots([], [a]);
    list = addSnapshots(list, [b, a]); // a re-added → no dup
    expect(list).toHaveLength(2);
    expect(list[0].capturedAt).toBe("2026-01-01T00:00:00Z");
    expect(loadSnapshots()).toHaveLength(2); // persisted
  });

  it("removeSnapshot drops by id and persists", () => {
    const a = createSnapshot({ projects }, "2026-01-01T00:00:00Z");
    const list = addSnapshots([], [a]);
    expect(removeSnapshot(list, a.id)).toHaveLength(0);
    expect(loadSnapshots()).toHaveLength(0);
  });
});
