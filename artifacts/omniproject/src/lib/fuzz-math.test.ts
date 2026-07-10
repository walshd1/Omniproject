import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Project, PortfolioHealthSummary, ResourceCapacity } from "@workspace/api-client-react";
import { check, gen, type Rng } from "../test/proptest";

import { simulate, mulberry32, type RiskTask } from "./monte-carlo";
import {
  spreadWeights,
  monthBuckets,
  scheduleWindow,
  timePhasedForecast,
  SPREAD_PROFILES,
  type SpreadProfile,
} from "./forecast-curve";
import {
  summariseFunding,
  evaluateFundingScenario,
  autoFundByRank,
  diffFundingTotals,
  fundAll,
  decisionFor,
  type FundingDecision,
  type FundingDecisions,
} from "./funding-scenario";
import {
  scorePortfolio,
  moscowWeight,
  DEFAULT_PRIORITY_WEIGHTS,
  type ProjectPriorityInput,
  type PriorityInput,
  type PriorityWeights,
  type ProjectPriorityScore,
} from "./portfolio-priority";
import {
  levelPortfolio,
  flattenAllocations,
  skillsSupplyDemand,
  residencyGate,
  simulateMove,
  type ResidencyPosture,
} from "./resource-levelling";
import type { ProjectCapacity } from "./capacity-rollup";
import {
  buildScheduleItems,
  computeSchedule,
  startOfDay,
  type ScheduleInput,
  type DepEdge,
} from "./schedule-scenario";
import { applyScenario, summarize, diffSummary, type ScenarioAdjustments } from "./scenario";
import { convertAmount, currencyList, firstCurrency, LocalTracker } from "./currency";

/**
 * NUMERIC / FINANCIAL-MATH FUZZ suite. The invariant every function here rests on: given arbitrary
 * FINITE numeric inputs (incl. 0, negatives, very large magnitudes) these pure derivations never THROW
 * and never silently emit a NaN/Infinity into a figure the UI renders — they clamp/guard/coerce instead.
 * NaN/Infinity *inputs* are injected separately, where the only claim is "does not throw" (a function may
 * legitimately pass a NaN input through, but must not crash on it).
 *
 * Deterministic: the seeded `proptest` harness drives generation; a failure prints PROPTEST_SEED=<n> to
 * replay the exact offending input. Runs kept modest so the vitest suite stays fast.
 */

const RUNS = 250;

// ── Finite / hostile number generators ───────────────────────────────────────
/** A finite number spanning 0, negatives, decimals and large-but-non-overflowing magnitudes. */
function finiteNum(r: Rng): number {
  const roll = gen.int(r, 0, 6);
  switch (roll) {
    case 0: return 0;
    case 1: return gen.int(r, 1, 1000);
    case 2: return -gen.int(r, 1, 1000);
    case 3: return (gen.int(r, -100000, 100000)) / 100; // decimals incl negatives
    case 4: return gen.int(r, 0, 1_000_000); // large, but summing a handful stays < Number.MAX
    case 5: return -gen.int(r, 0, 1_000_000);
    default: return gen.int(r, -50, 50);
  }
}
/** finiteNum plus the NaN/Infinity edge injections (for the "never throws" claim only). */
function nastyNum(r: Rng): number {
  const roll = gen.int(r, 0, 9);
  if (roll === 0) return NaN;
  if (roll === 1) return Infinity;
  if (roll === 2) return -Infinity;
  return finiteNum(r);
}
/** Assert every own numeric leaf of `v` is finite (nulls allowed; strings/booleans ignored). */
function assertFiniteDeep(v: unknown, path = "root"): void {
  if (typeof v === "number") {
    assert.ok(Number.isFinite(v), `non-finite number leaked at ${path}: ${v}`);
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => assertFiniteDeep(x, `${path}[${i}]`)); return; }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) assertFiniteDeep(val, `${path}.${k}`);
  }
}

const idGen = (r: Rng): string => gen.string(r, "abcABC012_-", 6) || "x";
const PROFILES: readonly SpreadProfile[] = SPREAD_PROFILES.map((p) => p.id);

// ── monte-carlo.ts ────────────────────────────────────────────────────────────
describe("fuzz: monte-carlo simulate", () => {
  const tasksGen = (numFn: (r: Rng) => number) => (r: Rng): RiskTask[] =>
    gen.array(r, (rr) => ({ id: idGen(rr), label: gen.string(rr, "abc ", 8), estimate: numFn(rr) }), 8);

  it("finite estimates ⇒ every rendered scalar/curve/correlation is finite and in-range (never NaN)", () => {
    check(
      (r) => ({ tasks: tasksGen(finiteNum)(r), seed: gen.int(r, 1, 1e9), iters: gen.int(r, 200, 400), u: (gen.int(r, 5, 100) / 100) }),
      ({ tasks, seed, iters, u }) => {
        const res = simulate(tasks, { iterations: iters, uncertainty: u, rng: mulberry32(seed) });
        assertFiniteDeep(res);
        assert.ok(res.planConfidence >= 0 && res.planConfidence <= 1, "planConfidence out of [0,1]");
        for (const pt of res.curve) assert.ok(pt.probability >= 0 && pt.probability <= 1, "curve prob out of [0,1]");
        for (const s of res.sensitivity) assert.ok(s.correlation >= -1.0000001 && s.correlation <= 1.0000001, "corr out of [-1,1]");
        assert.ok(res.min <= res.max);
      },
      { runs: RUNS },
    );
  });

  it("NaN/Infinity estimates ⇒ never throws", () => {
    check(
      (r) => ({ tasks: tasksGen(nastyNum)(r), seed: gen.int(r, 1, 1e9) }),
      ({ tasks, seed }) => { assert.doesNotThrow(() => simulate(tasks, { rng: mulberry32(seed), iterations: 200 })); },
      { runs: RUNS },
    );
  });
});

// ── forecast-curve.ts ─────────────────────────────────────────────────────────
describe("fuzz: forecast-curve", () => {
  it("spreadWeights: finite weights that sum to 1 for n>=1 (any profile, incl n<=0/huge)", () => {
    check(
      (r) => ({ profile: gen.pick(r, PROFILES), n: gen.oneOf(r, (rr) => gen.int(rr, -5, 60), () => 0, () => 1) }),
      ({ profile, n }) => {
        const w = spreadWeights(profile, n);
        assert.ok(Array.isArray(w));
        w.forEach((x) => assert.ok(Number.isFinite(x), `weight NaN for ${profile}/${n}`));
        if (n >= 1 && w.length) assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9, "weights don't sum to 1");
        if (n <= 0) assert.equal(w.length, 0);
      },
      { runs: RUNS },
    );
  });

  it("monthBuckets: non-empty list of finite UTC month-starts for finite epoch inputs", () => {
    check(
      (r) => ({ start: gen.int(r, -3e11, 2e12), end: gen.int(r, -3e11, 2e12), max: gen.int(r, 1, 48) }),
      ({ start, end, max }) => {
        const b = monthBuckets(start, end, max);
        assert.ok(b.length >= 1 && b.length <= max);
        b.forEach((ms) => assert.ok(Number.isFinite(ms), "bucket NaN"));
      },
      { runs: RUNS },
    );
  });

  it("scheduleWindow: null or a finite ordered window even with garbage date strings", () => {
    const dateCell = (r: Rng): string | null =>
      gen.oneOf<string | null>(r,
        (rr) => new Date(gen.int(rr, 0, 2e12)).toISOString(),
        () => "not-a-date",
        () => "",
        () => null);
    check(
      (r) => ({
        items: gen.array(r, (rr) => ({ startDate: dateCell(rr), dueDate: dateCell(rr) }), 8),
        asOf: gen.int(r, 0, 2e12),
      }),
      ({ items, asOf }) => {
        const w = scheduleWindow(items, asOf);
        if (w === null) return;
        assert.ok(Number.isFinite(w.start) && Number.isFinite(w.end), "window has NaN bound");
      },
      { runs: RUNS },
    );
  });

  it("timePhasedForecast: every planned/actual/forecast + rollup scalar is finite (finite money inputs)", () => {
    check(
      (r) => {
        const start = gen.int(r, 0, 2e12);
        return {
          bac: finiteNum(r), eac: finiteNum(r), actualToDate: finiteNum(r),
          start,
          end: start + gen.int(r, 0, 400) * 86_400_000,
          asOf: start + gen.int(r, -50, 450) * 86_400_000,
          profile: gen.pick(r, PROFILES),
        };
      },
      (input) => {
        const fc = timePhasedForecast(input);
        assert.ok(Number.isFinite(fc.bac) && Number.isFinite(fc.eac) && Number.isFinite(fc.vac));
        assert.ok(Number.isFinite(fc.plannedToDate) && Number.isFinite(fc.actualToDate));
        for (const p of fc.periods) {
          assert.ok(Number.isFinite(p.planned), "planned NaN");
          if (p.actual !== null) assert.ok(Number.isFinite(p.actual), "actual NaN");
          if (p.forecast !== null) assert.ok(Number.isFinite(p.forecast), "forecast NaN");
        }
      },
      { runs: RUNS },
    );
  });
});

// ── funding-scenario.ts + portfolio-priority.ts share ProjectPriorityScore ──────
function scoreGen(numFn: (r: Rng) => number) {
  return (r: Rng): ProjectPriorityScore => ({
    projectId: idGen(r),
    projectName: gen.string(r, "abc ", 6),
    programmeId: gen.bool(r) ? idGen(r) : null,
    programmeName: gen.bool(r) ? "p" : null,
    rank: gen.int(r, 1, 50),
    riceScore: gen.bool(r) ? numFn(r) : null,
    wsjf: gen.bool(r) ? numFn(r) : null,
    moscowScore: gen.bool(r) ? numFn(r) : null,
    strategicScore: gen.bool(r) ? numFn(r) : null,
    benefitValue: numFn(r),
    compositeScore: gen.bool(r) ? numFn(r) : null,
    cost: numFn(r),
    capacityHours: numFn(r),
    valueDensity: gen.bool(r) ? numFn(r) : null,
  });
}
const DECISIONS: readonly FundingDecision[] = ["fund", "defer", "cut"];

describe("fuzz: funding-scenario", () => {
  it("summarise/evaluate/diff: all totals finite for finite + dirty (NaN) project figures", () => {
    check(
      (r) => {
        const scored = gen.array(r, scoreGen(nastyNum), 12);
        const decisions: FundingDecisions = {};
        for (const s of scored) if (gen.bool(r)) decisions[s.projectId] = gen.pick(r, DECISIONS);
        const budgetCap = gen.bool(r) ? finiteNum(r) : null;
        const capacityCap = gen.bool(r) ? finiteNum(r) : null;
        return { scored, decisions, budgetCap, capacityCap };
      },
      ({ scored, decisions, budgetCap, capacityCap }) => {
        const totals = summariseFunding(scored, decisions);
        assertFiniteDeep(totals); // num() coerces dirty figures ⇒ no NaN can escape
        const evald = evaluateFundingScenario(scored, decisions, budgetCap, capacityCap);
        assertFiniteDeep({ used: evald.budget.used, over: evald.budget.over, cUsed: evald.capacity.used, cOver: evald.capacity.over });
        if (evald.budget.remaining !== null) assert.ok(Number.isFinite(evald.budget.remaining));
        const delta = diffFundingTotals(summariseFunding(scored, fundAll(scored)), totals);
        assertFiniteDeep(delta);
      },
      { runs: RUNS },
    );
  });

  it("autoFundByRank: only ever emits fund/defer/cut, respects caps and preserves seeded cuts", () => {
    check(
      (r) => {
        const scored = gen.array(r, scoreGen(finiteNum), 12);
        const seed: FundingDecisions = {};
        for (const s of scored) if (gen.int(r, 0, 4) === 0) seed[s.projectId] = "cut";
        return { scored, seed, budgetCap: gen.bool(r) ? finiteNum(r) : null, capacityCap: gen.bool(r) ? finiteNum(r) : null };
      },
      ({ scored, seed, budgetCap, capacityCap }) => {
        const out = autoFundByRank(scored, budgetCap, capacityCap, seed);
        for (const v of Object.values(out)) assert.ok(DECISIONS.includes(v), `bad decision ${v}`);
        for (const [id, v] of Object.entries(seed)) if (v === "cut") assert.equal(decisionFor(out, id), "cut", "seeded cut not preserved");
      },
      { runs: RUNS },
    );
  });
});

// ── portfolio-priority.ts ───────────────────────────────────────────────────────
describe("fuzz: portfolio-priority", () => {
  it("moscowWeight: null or a finite weight in [0,100] for any string (incl injection)", () => {
    check(
      (r) => gen.oneOf<string>(r,
        (rr) => gen.pick(rr, ["Must have", "SHOULD", "could", "won't", "will not", "m", "", "garbage", "<script>"]),
        (rr) => gen.string(rr, "abc'<>{} ", 12)),
      (s) => {
        const w = moscowWeight(s);
        if (w === null) return;
        assert.ok(Number.isFinite(w) && w >= 0 && w <= 100, `moscow weight out of range: ${w}`);
      },
      { runs: RUNS },
    );
  });

  it("scorePortfolio: every score field finite-or-null, composite in [0,100], ranks 1..n", () => {
    const itemGen = (r: Rng): PriorityInput => ({
      id: idGen(r),
      title: "t",
      riceScore: gen.bool(r) ? nastyNum(r) : null,
      wsjf: gen.bool(r) ? nastyNum(r) : null,
      moscow: gen.bool(r) ? gen.pick(r, ["must", "should", "could", "won't", "junk"]) : null,
      strategicContribution: gen.bool(r) ? nastyNum(r) : null,
      plannedBenefitValue: gen.bool(r) ? nastyNum(r) : null,
      benefitConfidence: gen.bool(r) ? nastyNum(r) : null,
    });
    const projGen = (r: Rng): ProjectPriorityInput => ({
      projectId: idGen(r),
      projectName: gen.string(r, "abc ", 6) || "n",
      programmeId: null,
      programmeName: null,
      items: gen.array(r, itemGen, 6),
      cost: finiteNum(r),
      capacityHours: finiteNum(r),
    });
    check(
      (r) => ({
        inputs: gen.array(r, projGen, 10),
        weights: (gen.bool(r) ? DEFAULT_PRIORITY_WEIGHTS : {
          rice: nastyNum(r), wsjf: nastyNum(r), moscow: nastyNum(r), strategic: nastyNum(r), benefit: nastyNum(r),
        }) as PriorityWeights,
      }),
      ({ inputs, weights }) => {
        const scored = scorePortfolio(inputs, weights);
        assert.equal(scored.length, inputs.length);
        scored.forEach((s, i) => {
          assert.equal(s.rank, i + 1, "ranks not sequential");
          for (const f of [s.riceScore, s.wsjf, s.moscowScore, s.strategicScore, s.compositeScore, s.valueDensity]) {
            if (f !== null) assert.ok(Number.isFinite(f), "score field NaN");
          }
          assert.ok(Number.isFinite(s.benefitValue) && Number.isFinite(s.cost) && Number.isFinite(s.capacityHours));
          if (s.compositeScore !== null) assert.ok(s.compositeScore >= -0.0001 && s.compositeScore <= 100.0001, `composite out of [0,100]: ${s.compositeScore}`);
        });
      },
      { runs: RUNS },
    );
  });
});

// ── resource-levelling.ts ───────────────────────────────────────────────────────
describe("fuzz: resource-levelling", () => {
  const resGen = (numFn: (r: Rng) => number) => (r: Rng): ResourceCapacity => ({
    resourceId: idGen(r),
    resourceName: "r",
    role: "dev",
    allocationPercentage: numFn(r),
    assignedHours: numFn(r),
    availableHours: numFn(r),
    utilizationState: gen.pick(r, ["OVER_ALLOCATED", "OPTIMAL", "UNDER_ALLOCATED"] as const),
    country: gen.bool(r) ? gen.pick(r, ["GB", "US", "DE", "'; DROP", ""]) : null,
    skills: gen.array(r, (rr) => gen.pick(rr, ["ts", "go", "<script>", "sql"]), 3),
  });
  const projGen = (numFn: (r: Rng) => number) => (r: Rng): ProjectCapacity => ({
    projectId: gen.pick(r, ["p1", "p2", "p3"]),
    projectName: "proj",
    programmeId: gen.bool(r) ? gen.pick(r, ["prog1", "prog2"]) : null,
    programmeName: gen.bool(r) ? "P" : null,
    resources: gen.array(r, resGen(numFn), 5),
  });

  it("levelPortfolio + skillsSupplyDemand: all summed hours/percentages finite (numLoose coerces dirt)", () => {
    check(
      (r) => gen.array(r, projGen(nastyNum), 6),
      (projects) => {
        const lv = levelPortfolio(projects, gen.int(mulberry32(1), 0, 100));
        for (const p of lv.people) {
          assert.ok(Number.isFinite(p.totalAllocationPercentage) && Number.isFinite(p.totalAssignedHours) && Number.isFinite(p.totalAvailableHours), "person total NaN");
        }
        for (const s of skillsSupplyDemand(projects)) {
          assert.ok(Number.isFinite(s.supplyAvailableHours) && Number.isFinite(s.demandAssignedHours) && Number.isFinite(s.balanceHours), "skill balance NaN");
        }
        assert.ok(Array.isArray(flattenAllocations(projects)));
      },
      { runs: RUNS },
    );
  });

  it("residencyGate: always returns a boolean verdict for any country/region strings", () => {
    check(
      (r) => ({
        country: gen.bool(r) ? gen.pick(r, ["GB", "us", "'; DROP", "__proto__", ""]) : null,
        posture: { enabled: gen.bool(r), allowedRegions: gen.array(r, (rr) => gen.pick(rr, ["GB", "US", "<x>"]), 4) } as ResidencyPosture,
      }),
      ({ country, posture }) => {
        const v = residencyGate(country, posture);
        assert.equal(typeof v.allowed, "boolean");
      },
      { runs: RUNS },
    );
  });

  it("simulateMove: never throws, before/after rollup deltas finite-or-null", () => {
    check(
      (r) => ({
        projects: gen.array(r, projGen(finiteNum), 5),
        move: {
          resourceId: idGen(r),
          fromProjectId: gen.pick(r, ["p1", "p2", "p3", "ghost"]),
          toProjectId: gen.pick(r, ["p1", "p2", "p3", "ghost"]),
          movePercentage: nastyNum(r),
        },
        posture: { enabled: gen.bool(r), allowedRegions: ["GB", "US", "DE"] } as ResidencyPosture,
      }),
      ({ projects, move, posture }) => {
        let res!: ReturnType<typeof simulateMove>;
        assert.doesNotThrow(() => { res = simulateMove(projects, move, posture); });
        for (const side of [res.from, res.to]) {
          assert.ok(Number.isFinite(side.overAllocatedDelta), "overAllocatedDelta NaN");
          if (side.utilisationDelta !== null) assert.ok(Number.isFinite(side.utilisationDelta), "utilisationDelta NaN");
          for (const roll of [side.before, side.after]) {
            assert.ok(Number.isFinite(roll.assignedHours) && Number.isFinite(roll.availableHours));
          }
        }
      },
      { runs: RUNS },
    );
  });
});

// ── schedule-scenario.ts ─────────────────────────────────────────────────────────
describe("fuzz: schedule-scenario", () => {
  const validDate = (r: Rng): string => new Date(gen.int(r, 0, 2e12)).toISOString();

  it("computeSchedule: with valid dates + finite shifts, all day/summary numbers are finite (cycles/self-loops handled)", () => {
    check(
      (r) => {
        const inputs: ScheduleInput[] = gen.array(r, (rr) => {
          const hasStart = gen.bool(rr);
          return {
            id: idGen(rr),
            title: "t",
            status: "open",
            startDate: hasStart ? validDate(rr) : null,
            dueDate: gen.bool(rr) || !hasStart ? validDate(rr) : null,
          };
        }, 8);
        const items = buildScheduleItems(inputs);
        const ids = items.map((i) => i.id);
        const edges: DepEdge[] = gen.array(r, (rr) => ({
          predecessorId: ids.length ? gen.pick(rr, ids) : "x",
          successorId: ids.length ? gen.pick(rr, ids) : "y",
        }), 10);
        const shifts: Record<string, number> = {};
        for (const id of ids) if (gen.bool(r)) shifts[id] = gen.int(r, -500, 500);
        return { items, edges, shifts };
      },
      ({ items, edges, shifts }) => {
        const res = computeSchedule(items, edges, shifts);
        for (const it of res.items) {
          for (const n of [it.baseStartDay, it.baseEndDay, it.durationDays, it.resolvedStartDay, it.resolvedEndDay, it.totalShiftDays, it.cascadeShiftDays]) {
            assert.ok(Number.isFinite(n), "schedule day NaN");
          }
        }
        assertFiniteDeep(res.summary);
        assert.ok(Number.isFinite(res.rangeStartDay) && Number.isFinite(res.rangeEndDay));
        assert.equal(typeof res.summary.hasCycle, "boolean");
      },
      { runs: RUNS },
    );
  });

  it("buildScheduleItems: never throws on garbage/empty date strings", () => {
    const cell = (r: Rng): string | null => gen.oneOf<string | null>(r, () => "not-a-date", () => "", () => "2024-13-99", () => null, (rr) => validDate(rr));
    check(
      (r) => gen.array(r, (rr) => ({ id: idGen(rr), title: "t", status: "s", startDate: cell(rr), dueDate: cell(rr) }), 8),
      (inputs) => { assert.doesNotThrow(() => buildScheduleItems(inputs)); },
      { runs: RUNS },
    );
  });

  it("startOfDay: finite for any finite epoch", () => {
    check((r) => gen.int(r, -3e11, 2e12), (ms) => { assert.ok(Number.isFinite(startOfDay(new Date(ms)))); }, { runs: RUNS });
  });
});

// ── scenario.ts ───────────────────────────────────────────────────────────────
describe("fuzz: scenario", () => {
  const RAGS = ["RED", "AMBER", "GREEN", "red", "unknown", ""] as const;
  const projGen = (r: Rng): Project => ({
    id: idGen(r), name: "n", identifier: "ID", source: "plane",
    issueCount: Math.max(0, Math.round(finiteNum(r))), completedCount: Math.max(0, Math.round(finiteNum(r))),
    memberCount: 0, updatedAt: "2024-01-01T00:00:00Z",
  });
  const rowGen = (numFn: (r: Rng) => number) => (r: Rng): PortfolioHealthSummary => ({
    projectId: idGen(r), projectName: "n",
    ragStatus: gen.pick(r, RAGS) as PortfolioHealthSummary["ragStatus"],
    scheduleVarianceDays: numFn(r), budgetVariancePercentage: numFn(r), activeBlockersCount: Math.round(numFn(r)),
  });

  it("applyScenario→summarize→diffSummary: finite KPIs, integer RAG counts, no mutation, no throw", () => {
    check(
      (r) => {
        const projects = gen.array(r, projGen, 8);
        const portfolio = gen.array(r, rowGen(finiteNum), 8);
        const adj: ScenarioAdjustments = {};
        for (const p of projects) if (gen.bool(r)) adj[p.id] = {
          completionDeltaPct: gen.bool(r) ? finiteNum(r) : undefined,
          scheduleDeltaDays: gen.bool(r) ? finiteNum(r) : undefined,
          budgetDeltaPct: gen.bool(r) ? finiteNum(r) : undefined,
          blockersDelta: gen.bool(r) ? Math.round(finiteNum(r)) : undefined,
        };
        return { projects, portfolio, adj };
      },
      ({ projects, portfolio, adj }) => {
        const base = summarize(projects, portfolio);
        let scenario!: ReturnType<typeof summarize>;
        assert.doesNotThrow(() => {
          const applied = applyScenario(projects, portfolio, adj);
          scenario = summarize(applied.projects, applied.portfolio);
        });
        for (const s of [base, scenario]) {
          assert.ok(Number.isFinite(s.completionPct) && Number.isFinite(s.avgScheduleVarianceDays) && Number.isFinite(s.avgBudgetVariancePct) && Number.isFinite(s.totalBlockers));
          for (const c of Object.values(s.ragCounts)) assert.ok(Number.isInteger(c) && c >= 0, "rag count not a non-negative int");
        }
        assertFiniteDeep(diffSummary(base, scenario));
      },
      { runs: RUNS },
    );
  });
});

// ── currency.ts ───────────────────────────────────────────────────────────────
describe("fuzz: currency", () => {
  // Realistic currency codes (no Object.prototype member names) for the never-NaN invariant.
  const CCY = ["GBP", "USD", "EUR", "JPY", "'; DROP", "<x>", ""];

  it("convertAmount: finite result for finite amount + finite rate table (missing rate ⇒ passthrough)", () => {
    check(
      (r) => {
        const rates: Record<string, number> = {};
        for (const c of CCY) if (gen.bool(r)) rates[c] = gen.int(r, 1, 100000) / 100; // positive finite rates
        return { amount: finiteNum(r), from: gen.pick(r, CCY), to: gen.pick(r, CCY), rates: gen.bool(r) ? rates : undefined };
      },
      ({ amount, from, to, rates }) => {
        const out = convertAmount(amount, from, to, rates);
        assert.ok(Number.isFinite(out), `convertAmount produced ${out}`);
      },
      { runs: RUNS },
    );
  });

  // FINDING (pinned): a currency code that collides with an Object.prototype member ("__proto__",
  // "constructor", "toString", …) is NOT treated as a missing rate — `rates[from]` returns the inherited
  // prototype value (an object/function), so the `if (!rFrom || !rTo)` passthrough guard doesn't fire and
  // the multiply yields NaN. A backend/ERP that ever emitted such a "currency" code would render NaN.
  // Guarding would want an own-property / Number.isFinite check on the looked-up rate. Pinned here so the
  // weakness is visible and a future fix flips this expectation.
  it("convertAmount: a prototype-member currency code passes the amount through (no NaN leak)", () => {
    // convertAmount now uses Object.hasOwn + Number.isFinite on the looked-up rate, so a code like
    // "__proto__"/"constructor"/"toString" no longer reads an inherited member and produces NaN.
    for (const code of ["__proto__", "constructor", "toString", "valueOf"]) {
      assert.equal(convertAmount(100, code, "EUR", { EUR: 2 }), 100, `from=${code} must pass through`);
      assert.equal(convertAmount(100, "EUR", code, { EUR: 2 }), 100, `to=${code} must pass through`);
    }
  });

  it("firstCurrency / currencyList / LocalTracker: never throw, return well-typed values on hostile currency strings", () => {
    check(
      (r) => ({ items: gen.array(r, (rr) => ({ currency: gen.bool(rr) ? gen.pick(rr, CCY) : null }), 6), fallback: gen.pick(r, CCY) }),
      ({ items, fallback }) => {
        const fc = firstCurrency(items, fallback || undefined);
        assert.equal(typeof fc, "string");
        assert.ok(fc.length > 0, "firstCurrency returned empty");
        const list = currencyList(Object.fromEntries(items.filter((i) => i.currency).map((i) => [i.currency as string, 1])));
        assert.ok(Array.isArray(list) && list.every((c) => typeof c === "string"));
        const t = new LocalTracker();
        for (const i of items) if (i.currency) assert.equal(typeof t.add(i.currency), "boolean");
      },
      { runs: RUNS },
    );
  });
});
