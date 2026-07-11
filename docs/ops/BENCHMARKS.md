# Compute benchmarks

OmniProject derives every portfolio, programme and report analytic **on the fly** from the rows a
backend returns — it stores no domain data, so there is no pre-aggregated table to read. That makes
the CPU cost of the pure fold/aggregate/analytics functions a first-class scaling question: *how much
does the derivation itself cost as a portfolio grows?*

The HTTP [load harness](LOAD-HARNESS.md) and the `stress` script answer the end-to-end question
(gateway → broker → backend, network included). These **compute benchmarks** answer the isolated one:
the per-call latency and throughput of the derivation functions themselves, with **no server boot and
no network**, over deterministic fixtures at configurable scale. Together they separate "the backend
is slow" from "the derivation is slow."

There are two harnesses, one per package (each benchmarks its own pure functions with its own
toolchain — no cross-package coupling):

## 1. Gateway portfolio folds — `pnpm --filter @workspace/api-server run bench`

Benchmarks the functions that run on every `GET /portfolio/summary` and programme rollup and whose
cost grows with portfolio size: `summarizeHealth`, `foldFinance`, `foldCapacity`, `groupProgrammes`,
`aggregateFinancials`.

```bash
BENCH_PROJECTS=1000 pnpm --filter @workspace/api-server run bench
```

Environment knobs: `BENCH_PROJECTS` (portfolio size, default 200 — matches the CI stress fixture),
`BENCH_SAMPLES` (timed samples/case, default 200), `BENCH_WARMUP_MS` (JIT warmup/case, default 150),
`BENCH_SEED` (fixture seed, default 1), `BENCH_REPORT=path.json` (structured dump), and
`BENCH_MAX_P99_MS=<ms>` — when set, the run **fails (exit 1)** if any case's p99 exceeds the budget,
so it can drop into CI as a regression gate.

Indicative result (200 projects, one developer laptop — **numbers are machine-dependent**; run it on
your own hardware for a real figure):

| function | scale | p50 | p99 | ops/sec |
|---|---|---|---|---|
| foldCapacity | 200 rows | ~0.0004 ms | ~0.0007 ms | ~2,300,000 |
| aggregateFinancials | 200 projects | ~0.003 ms | ~0.003 ms | ~360,000 |
| summarizeHealth | 200 rows | ~0.003 ms | ~0.005 ms | ~340,000 |
| foldFinance | 200 rows | ~0.003 ms | ~0.007 ms | ~290,000 |
| groupProgrammes | 200 projects | ~0.013 ms | ~0.019 ms | ~71,000 |

Reading it: the whole portfolio fold for 200 projects costs tens of microseconds — the derivation is
not the bottleneck; end-to-end latency is dominated by the backend query the broker forwards. The
folds are linear in project count, so a 10k-project portfolio is ~50× these figures (still sub-ms).

## 2. SPA per-item analytics — `pnpm --filter @workspace/omniproject run bench`

Benchmarks the heaviest client-side analytics with [`vitest bench`](https://vitest.dev/guide/features#benchmarking):
Monte-Carlo risk `simulate` (the single most expensive analytic, `O(iterations × tasks)`) and the
critical-path CPM solve (`O(V+E)`). Scaling variants are included so the output shows how cost grows
with input size.

Indicative result (same laptop):

| analytic | scale | mean | p99 | hz |
|---|---|---|---|---|
| criticalPath | 200 nodes | ~0.18 ms | ~0.6 ms | ~5,600 |
| monteCarlo simulate | 25 tasks × 2000 iters | ~2.1 ms | ~3.2 ms | ~475 |
| monteCarlo simulate | 100 tasks × 2000 iters | ~4.4 ms | ~5.9 ms | ~230 |
| monteCarlo simulate | 25 tasks × 10000 iters | ~8.4 ms | ~9.4 ms | ~120 |
| criticalPath | 1000 nodes | ~1.3 ms | ~2.1 ms | ~780 |

Reading it: the Monte-Carlo cost scales linearly in both tasks (2.08× for 4× tasks) and iterations
(3.99× for 5× iterations) exactly as `O(iterations × tasks)` predicts, and critical path scales with
graph size. A single risk simulation at the default 2000 iterations is a few milliseconds — cheap
enough to run interactively.

## Methodology (why the numbers are trustworthy)

- **Deterministic fixtures.** Rows are generated from the row index plus a seeded PRNG (`mulberry32`),
  so a given `(count, seed)` yields byte-identical input — runs are reproducible and comparable across
  machines. The generators are unit-tested for shape and determinism.
- **JIT warmup + inner-batch calibration.** Each case is warmed before timing; the gateway harness
  then auto-sizes an inner batch so a single timed sample clears the timer's resolution, and divides
  back out to a per-call figure. `vitest bench` (tinybench) applies its own warmup + sampling.
- **Anti-dead-code-elimination.** Every measured call's result feeds a sink the optimiser can't prove
  unused, so the compiler can't delete the work being timed.
- **Nearest-rank percentiles, unrounded**, so sub-microsecond folds keep precision.

Neither harness is part of the normal test suite (the gateway fixtures test runs, but the benchmark
runners are invoked only via their `bench` scripts), and neither requires a network, so both are safe
to run anywhere — including as a non-gating CI job, or as a gate via `BENCH_MAX_P99_MS`.
