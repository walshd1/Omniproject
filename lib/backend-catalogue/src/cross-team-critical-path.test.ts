import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCrossTeamCriticalPath } from "./cross-team-critical-path";

// A linear chain A→B→C→D (all critical): durations 2,3,4,1 ⇒ projectDuration 10.
const chain = {
  nodes: [
    { id: "A", duration: 2 },
    { id: "B", duration: 3 },
    { id: "C", duration: 4 },
    { id: "D", duration: 1 },
  ],
  edges: [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "C", to: "D" },
  ],
};

test("annotates the critical path with teams and flags the cross-team hand-off", () => {
  const r = analyzeCrossTeamCriticalPath(chain.nodes, chain.edges, { A: "alpha", B: "alpha", C: "beta", D: "beta" });
  assert.deepEqual(r.criticalPath.map((a) => [a.id, a.team]), [["A", "alpha"], ["B", "alpha"], ["C", "beta"], ["D", "beta"]]);
  assert.equal(r.handoffCount, 1);
  assert.deepEqual(r.handoffs, [{ fromId: "B", toId: "C", fromTeam: "alpha", toTeam: "beta" }]);
  assert.equal(r.projectDuration, 10);
});

test("per-team share sums the critical activities' durations, guarded pct", () => {
  const r = analyzeCrossTeamCriticalPath(chain.nodes, chain.edges, { A: "alpha", B: "alpha", C: "beta", D: "beta" });
  assert.deepEqual(r.byTeam, [
    { team: "alpha", activities: 2, duration: 5, durationPct: 0.5 }, // 2 + 3
    { team: "beta", activities: 2, duration: 5, durationPct: 0.5 }, // 4 + 1
  ]);
  assert.deepEqual(r.teamsOnPath, ["alpha", "beta"]);
});

test("a single-team critical path has zero hand-offs", () => {
  const r = analyzeCrossTeamCriticalPath(chain.nodes, chain.edges, { A: "solo", B: "solo", C: "solo", D: "solo" });
  assert.equal(r.handoffCount, 0);
  assert.deepEqual(r.handoffs, []);
  assert.deepEqual(r.teamsOnPath, ["solo"]);
});

test("multiple alternating hand-offs are all captured in path order", () => {
  const r = analyzeCrossTeamCriticalPath(chain.nodes, chain.edges, { A: "alpha", B: "beta", C: "alpha", D: "beta" });
  assert.deepEqual(r.handoffs.map((h) => [h.fromTeam, h.toTeam]), [["alpha", "beta"], ["beta", "alpha"], ["alpha", "beta"]]);
  assert.equal(r.handoffCount, 3);
});

test("a node with no team mapping is labelled 'unassigned'", () => {
  const r = analyzeCrossTeamCriticalPath(chain.nodes, chain.edges, { A: "alpha", B: "alpha", C: "beta" }); // D unmapped
  assert.equal(r.criticalPath.find((a) => a.id === "D")!.team, "unassigned");
  assert.ok(r.teamsOnPath.includes("unassigned"));
});

test("non-critical activities (and their teams) are excluded from the analysis", () => {
  // A→B→D is the long path (1+5+1=7); A→C→D is short (1+1+1=3). C is NOT critical.
  const r = analyzeCrossTeamCriticalPath(
    [
      { id: "A", duration: 1 },
      { id: "B", duration: 5 },
      { id: "C", duration: 1 },
      { id: "D", duration: 1 },
    ],
    [
      { from: "A", to: "B" },
      { from: "A", to: "C" },
      { from: "B", to: "D" },
      { from: "C", to: "D" },
    ],
    { A: "alpha", B: "alpha", C: "gamma", D: "alpha" },
  );
  assert.deepEqual(r.criticalPath.map((a) => a.id), ["A", "B", "D"]);
  assert.equal(r.teamsOnPath.includes("gamma"), false); // C's team never reaches the path
  assert.equal(r.handoffCount, 0); // all-alpha critical path
});

test("all-zero durations ⇒ durationPct guarded to null (never NaN)", () => {
  const r = analyzeCrossTeamCriticalPath(
    [{ id: "A", duration: 0 }, { id: "B", duration: 0 }],
    [{ from: "A", to: "B" }],
    { A: "alpha", B: "beta" },
  );
  assert.equal(r.projectDuration, 0);
  for (const t of r.byTeam) assert.equal(t.durationPct, null);
});

test("empty input ⇒ empty path, no hand-offs", () => {
  const r = analyzeCrossTeamCriticalPath([], [], {});
  assert.deepEqual(r.criticalPath, []);
  assert.deepEqual(r.handoffs, []);
  assert.equal(r.handoffCount, 0);
  assert.deepEqual(r.byTeam, []);
  assert.deepEqual(r.teamsOnPath, []);
});
