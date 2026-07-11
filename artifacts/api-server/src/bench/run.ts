/**
 * Compute benchmark harness — measures the CPU cost of the pure PORTFOLIO-SCALE fold/rollup functions
 * the gateway derives on every `GET /portfolio/summary` (and programme) request, at configurable
 * scale, with NO server boot and NO network. This is the "performance at scale" evidence the HTTP
 * stress test (stress-test.ts) can't give in isolation: per-function p50/p90/p99 latency + throughput
 * over a deterministic large fixture, so the cost of the on-the-fly derivation is measured directly.
 *
 * These are the functions whose cost grows with portfolio size (they fold every project's rows). The
 * SPA-side per-item analytics (Monte-Carlo risk, critical path, EVM, priority scoring, resource
 * levelling) are benchmarked in their own package with `vitest bench` — see
 * artifacts/omniproject/src/lib/analytics.bench.ts — because they live behind that package's tsconfig
 * rootDir and toolchain.
 *
 * Run:  pnpm --filter @workspace/api-server run bench
 * Env:
 *   BENCH_PROJECTS   portfolio size for the fold/rollup cases (default 200 — matches the CI stress fixture)
 *   BENCH_SAMPLES    timed samples per case (default 200)
 *   BENCH_WARMUP_MS  per-case JIT warmup budget in ms (default 150)
 *   BENCH_SEED       fixture PRNG seed (default 1) — runs are reproducible for a fixed seed
 *   BENCH_REPORT     path to write the structured JSON report (optional)
 *   BENCH_MAX_P99_MS if set, the run FAILS (exit 1) when any case's p99 exceeds this budget
 *
 * Methodology (why the numbers are trustworthy): each case is JIT-warmed, then an inner batch size is
 * auto-calibrated so one timed sample clears the timer's resolution (≥ the min-sample floor), and the
 * per-call time is elapsed/batch. Every result feeds an anti-dead-code-elimination sink so the JIT
 * can't optimise the call away. Percentiles are nearest-rank with no rounding, so sub-microsecond
 * folds keep precision.
 */
import { performance } from "node:perf_hooks";
import { portfolioHealthRows, financeRows, capacityRows, projectRows } from "./fixtures";
import { summarizeHealth, foldFinance, foldCapacity } from "../lib/portfolio-summary";
import { aggregateFinancials, groupProgrammes } from "../lib/programmes";
import type { Row, PortfolioRow } from "../broker/types";

/** Nearest-rank percentile over an ascending-sorted array (no rounding — keeps sub-microsecond
 *  precision for the fast folds). Same definition as scripts/lib/load-core, inlined so the bench
 *  doesn't create a backwards api-server → scripts dependency. */
function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, rank - 1))]!;
}

const numEnv = (k: string, d: number): number => {
  const raw = process.env[k]?.trim();
  if (!raw) return d;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const PROJECTS = Math.floor(numEnv("BENCH_PROJECTS", 200));
const SAMPLES = Math.floor(numEnv("BENCH_SAMPLES", 200));
const WARMUP_MS = numEnv("BENCH_WARMUP_MS", 150);
const SEED = Math.floor(numEnv("BENCH_SEED", 1));
const MIN_SAMPLE_MS = 1; // an inner batch must take at least this long, to clear timer resolution

/** One benchmark case. `run` performs a single invocation and returns a representative NUMBER from
 *  the result — the harness accumulates it into a sink so the call can never be dead-code-eliminated. */
interface BenchCase {
  name: string;
  scale: string; // human note on the input size, for the report
  run: () => number;
}

/** Pre-generate every fixture ONCE (outside the timed loops), then bind each case to its data. */
function buildCases(): BenchCase[] {
  const health = portfolioHealthRows(PROJECTS, SEED) as unknown as PortfolioRow[];
  const finance = financeRows(PROJECTS, SEED) as Row[];
  const capacity = capacityRows(PROJECTS, SEED) as Row[];
  const projects = projectRows(PROJECTS, SEED) as Row[];
  const fxRates = { GBP: 1, USD: 0.79, EUR: 0.85 };

  return [
    { name: "summarizeHealth", scale: `${PROJECTS} rows`, run: () => summarizeHealth(health).projects },
    { name: "foldFinance", scale: `${PROJECTS} rows`, run: () => foldFinance(finance, "GBP", fxRates).totals.budget },
    { name: "foldCapacity", scale: `${PROJECTS} rows`, run: () => foldCapacity(capacity).allocations },
    { name: "groupProgrammes", scale: `${PROJECTS} projects`, run: () => groupProgrammes(projects).length },
    { name: "aggregateFinancials", scale: `${PROJECTS} projects`, run: () => aggregateFinancials(projects)?.budget ?? 0 },
  ];
}

interface CaseResult {
  name: string;
  scale: string;
  samples: number;
  batch: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  opsPerSec: number;
}

let SINK = 0; // module-level so the optimiser can't prove the accumulation is unused

/** Auto-calibrate an inner batch size so one batch takes at least MIN_SAMPLE_MS (clears the timer). */
function calibrateBatch(run: () => number): number {
  let batch = 1;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) SINK += run();
    const dt = performance.now() - t0;
    if (dt >= MIN_SAMPLE_MS || batch >= 1 << 22) return batch;
    // Scale up toward the target; guard against a ~0ms reading (very fast fn) with an 8× floor.
    batch = dt <= 0.0005 ? batch * 8 : Math.max(batch + 1, Math.ceil((batch * (MIN_SAMPLE_MS / dt)) * 1.3));
  }
}

function measure(c: BenchCase): CaseResult {
  // Warm up: let the JIT specialise the call before we start timing.
  const warmEnd = performance.now() + WARMUP_MS;
  while (performance.now() < warmEnd) SINK += c.run();

  const batch = calibrateBatch(c.run);
  const perCall: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) SINK += c.run();
    perCall.push((performance.now() - t0) / batch);
  }
  const sorted = [...perCall].sort((a, b) => a - b);
  const mean = sorted.reduce((s, n) => s + n, 0) / sorted.length;
  return {
    name: c.name,
    scale: c.scale,
    samples: SAMPLES,
    batch,
    min: sorted[0]!,
    mean,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
    opsPerSec: mean > 0 ? 1000 / mean : Infinity,
  };
}

const ms = (n: number): string => (n >= 1 ? n.toFixed(3) : n.toFixed(4));
const ops = (n: number): string => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "∞");

function printTable(results: CaseResult[]): void {
  const rows = results.map((r) => ({
    fn: r.name,
    scale: r.scale,
    p50: ms(r.p50),
    p90: ms(r.p90),
    p99: ms(r.p99),
    mean: ms(r.mean),
    "ops/sec": ops(r.opsPerSec),
  }));
  const cols = ["fn", "scale", "p50", "p90", "p99", "mean", "ops/sec"] as const;
  const width = (c: (typeof cols)[number]) => Math.max(c.length, ...rows.map((r) => String(r[c]).length));
  const w = Object.fromEntries(cols.map((c) => [c, width(c)])) as Record<(typeof cols)[number], number>;
  const pad = (s: string, n: number, left = false) => (left ? s.padStart(n) : s.padEnd(n));
  const line = (r: Record<string, string>) =>
    cols.map((c) => pad(String(r[c]), w[c], c !== "fn" && c !== "scale")).join("  ");
  const header = Object.fromEntries(cols.map((c) => [c, c])) as Record<string, string>;
  console.log(line(header));
  console.log(cols.map((c) => "-".repeat(w[c])).join("  "));
  for (const r of rows) console.log(line(r));
  console.log("\n(latencies in ms per call; lower is better. p99 = 99th-percentile of the sampled per-call times.)");
}

async function main(): Promise<void> {
  console.log(
    `portfolio-fold bench — projects=${PROJECTS}, samples=${SAMPLES}, warmup=${WARMUP_MS}ms, seed=${SEED}\n`,
  );
  const cases = buildCases();
  const results = cases.map(measure);
  printTable(results);

  const reportPath = process.env["BENCH_REPORT"]?.trim();
  if (reportPath) {
    const { writeFileSync } = await import("node:fs");
    const report = {
      config: { projects: PROJECTS, samples: SAMPLES, warmupMs: WARMUP_MS, seed: SEED },
      results,
      // Emitting the sink keeps the anti-DCE accumulation observable (and confirms the runs happened).
      sink: SINK,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${reportPath}`);
  }

  const budget = process.env["BENCH_MAX_P99_MS"]?.trim();
  if (budget) {
    const max = Number(budget);
    const over = results.filter((r) => r.p99 > max);
    if (over.length) {
      console.error(`\nBUDGET FAIL: p99 > ${max}ms for: ${over.map((r) => `${r.name} (${ms(r.p99)}ms)`).join(", ")}`);
      process.exit(1);
    }
    console.log(`\nbudget OK: every case p99 ≤ ${max}ms`);
  }
}

void main();
