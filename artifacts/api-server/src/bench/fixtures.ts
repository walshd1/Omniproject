/**
 * Deterministic fixtures for the portfolio-fold compute benchmark (run.ts).
 *
 * The gateway derives every portfolio/programme rollup ON THE FLY from broker-provided rows, so the
 * thing worth benchmarking is the pure fold/aggregate functions — not the network. These generators
 * produce realistically-shaped rows for those functions at arbitrary scale.
 *
 * DETERMINISTIC by construction: values come from the row index plus a seeded PRNG (mulberry32), so
 * a given (count, seed) always yields byte-identical fixtures — bench runs are reproducible run to
 * run and machine to machine, and a `.test.ts` can assert exact shapes. This mirrors the modulo-based
 * `seedScale()` demo generator (broker/demo-data.ts) but as PURE exported functions with no module
 * side-effects, so they can be called in isolation.
 *
 * Field keys match exactly what each consumer reads (see portfolio-summary.ts foldFinance/foldCapacity/
 * summarizeHealth, programmes.ts aggregateFinancials/groupProgrammes). Rows are intentionally
 * `Record<string, unknown>` where the consumer takes `Row`, so no cross-package type import is needed.
 */

/** A tiny seeded PRNG (mulberry32) — same algorithm the SPA's monte-carlo uses, inlined so fixtures
 *  carry no cross-package dependency. Returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CURRENCIES = ["GBP", "USD", "EUR"] as const;
const RAG = ["green", "green", "amber", "red"] as const; // ~50% green, 25% amber, 25% red
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Portfolio-health rows — what `summarizeHealth` folds. */
export function portfolioHealthRows(count: number, seed = 1): Record<string, unknown>[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    projectId: `proj-${i}`,
    projectName: `Project ${i}`,
    ragStatus: RAG[i % RAG.length],
    scheduleVarianceDays: Math.round((rnd() - 0.4) * 40), // ~[-16, +24] days
    budgetVariancePercentage: round2((rnd() - 0.5) * 60), // ~[-30%, +30%]
    activeBlockersCount: rnd() < 0.3 ? Math.ceil(rnd() * 4) : 0,
  }));
}

/** Finance rows — what `foldFinance` folds (currency-mixed to exercise the FX conversion path). */
export function financeRows(count: number, seed = 2): Record<string, unknown>[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const budget = round2(50_000 + rnd() * 950_000);
    const actual = round2(budget * (0.3 + rnd() * 0.8));
    return {
      currency: CURRENCIES[i % CURRENCIES.length],
      budgetAllocated: budget,
      actualBurn: actual,
      forecastCostAtCompletion: round2(budget * (0.9 + rnd() * 0.4)),
      earnedValue: round2(actual * (0.7 + rnd() * 0.6)),
    };
  });
}

/** Capacity rows — what `foldCapacity` folds. */
export function capacityRows(count: number, seed = 3): Record<string, unknown>[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const available = 20 + Math.round(rnd() * 20); // 20–40h/week
    return {
      allocationPercentage: Math.round(rnd() * 140), // some > 100 → over-allocated
      assignedHours: round2(available * (0.4 + rnd() * 0.9)),
      availableHours: available,
    };
  });
}

/** Project rows with programme membership + denormalised finance — what `groupProgrammes` and
 *  `aggregateFinancials` roll up. Projects are grouped into programmes of 10; every 7th is
 *  standalone (no programmeId), mirroring the demo generator's topology. */
export function projectRows(count: number, seed = 4): Record<string, unknown>[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const standalone = i % 7 === 0;
    const grp = Math.floor(i / 10);
    const budget = round2(50_000 + rnd() * 950_000);
    return {
      id: `proj-${i}`,
      name: `Project ${i}`,
      programmeId: standalone ? null : `prog-${grp}`,
      programmeName: standalone ? null : `Programme ${grp}`,
      currency: CURRENCIES[i % CURRENCIES.length],
      budget,
      actualCost: round2(budget * (0.3 + rnd() * 0.8)),
      committed: round2(budget * rnd() * 0.5),
      earnedValue: round2(budget * (0.2 + rnd() * 0.7)),
      issueCount: Math.ceil(rnd() * 40),
      completedCount: Math.floor(rnd() * 20),
      status: rnd() < 0.85 ? "active" : "closed",
      ragStatus: RAG[i % RAG.length],
      updatedAt: new Date(1_700_000_000_000 + i * 3_600_000).toISOString(),
    };
  });
}

