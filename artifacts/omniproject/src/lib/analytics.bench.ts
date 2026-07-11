import { bench, describe } from "vitest";
import { simulate, mulberry32, type RiskTask } from "./monte-carlo";
import { criticalPath, type CpmNode, type CpmEdge } from "./critical-path";

/**
 * Compute benchmarks for the heaviest SPA-side analytics — the per-project computations whose CPU
 * cost, not network, bounds report latency. Run with `pnpm --filter @workspace/omniproject run bench`
 * (vitest bench); they are NOT part of the normal `vitest run` test suite (that includes only
 * *.test.ts). Percentiles + hz come from vitest's own tinybench reporter.
 *
 * Fixtures are DETERMINISTIC (seeded mulberry32 — the same PRNG simulate uses), generated ONCE at
 * module load so only the function under test is timed. We measure COST, not outcome, so a fixed
 * seed keeps runs comparable machine-to-machine.
 *
 * Scaling variants are included so the numbers show how cost grows with input size — the "does it
 * scale?" evidence. To extend: the other ranked hot-paths (consolidateFinancials/portfolio-finance,
 * scorePortfolio/portfolio-priority, levelPortfolio/resource-levelling) follow the same pattern —
 * build a deterministic fixture of their input shape at module scope and add a `bench(...)` here.
 */

function riskTasks(n: number, seed = 5): RiskTask[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => ({ id: `task-${i}`, label: `Task ${i}`, estimate: 1 + rnd() * 40 }));
}

/** A mostly-linear dependency chain with occasional skip-merges; acyclic (edges always go forward). */
function cpmGraph(n: number, seed = 6): { nodes: CpmNode[]; edges: CpmEdge[] } {
  const rnd = mulberry32(seed);
  const nodes: CpmNode[] = Array.from({ length: n }, (_, i) => ({ id: `n-${i}`, duration: 1 + rnd() * 20 }));
  const edges: CpmEdge[] = [];
  for (let i = 1; i < n; i++) {
    edges.push({ from: `n-${i - 1}`, to: `n-${i}` });
    if (i > 2 && rnd() < 0.25) edges.push({ from: `n-${i - 3}`, to: `n-${i}` });
  }
  return { nodes, edges };
}

// Deterministic fixtures, built once.
const tasks25 = riskTasks(25);
const tasks100 = riskTasks(100);
const graph200 = cpmGraph(200);
const graph1000 = cpmGraph(1000);

describe("monte-carlo simulate (O(iterations × tasks) — the heaviest analytic)", () => {
  // Seeded RNG so cost is measured on identical work each run.
  bench("25 tasks × 2000 iters (default)", () => {
    simulate(tasks25, { iterations: 2000, rng: mulberry32(1) });
  });
  bench("100 tasks × 2000 iters", () => {
    simulate(tasks100, { iterations: 2000, rng: mulberry32(1) });
  });
  bench("25 tasks × 10000 iters", () => {
    simulate(tasks25, { iterations: 10000, rng: mulberry32(1) });
  });
});

describe("critical-path (CPM — O(V+E) topological solve)", () => {
  bench("200 nodes", () => {
    criticalPath(graph200.nodes, graph200.edges);
  });
  bench("1000 nodes", () => {
    criticalPath(graph1000.nodes, graph1000.edges);
  });
});
