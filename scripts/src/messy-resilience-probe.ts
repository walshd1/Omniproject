/**
 * Messy-data RESILIENCE PROBE — a throwaway-but-committed harness.
 *
 * Arms the dev-only messy-data generator (lib/messy-data) at high intensity across several seeds,
 * messifies the DEMO read model, then runs EVERY pure derivation / report builder over the dirty
 * rows and catalogues every unhandled throw / NaN / Infinity / invalid Date / silently-wrong output.
 *
 * It calls messifyRows directly on the demo rows (no server needed) so the mess is deterministic and
 * reproducible per seed. Run: `pnpm --filter @workspace/scripts exec tsx src/messy-resilience-probe.ts`.
 *
 * This is a diagnostic, not a gate — it prints a findings table. The hardening it motivated lives in
 * the consumer libs; the regression tests that lock it in live beside each hardened lib.
 */

import { messifyRows, type MessyConfig } from "../../artifacts/api-server/src/lib/messy-data";
import {
  SAMPLE_PROJECTS,
  SAMPLE_ISSUES,
  SAMPLE_RAID,
  SAMPLE_PORTFOLIO,
  SAMPLE_FINANCIALS,
  SAMPLE_CAPACITY,
  DEMO_FX,
} from "../../artifacts/api-server/src/broker/demo-data";
import type { Row } from "../../artifacts/api-server/src/broker/types";

// ── Derivation / report libs under test ─────────────────────────────────────────
import { buildExecHealth, execHeadline } from "../../artifacts/omniproject/src/lib/exec-pack";
import { realisationPipeline, realisationSchedule } from "../../artifacts/omniproject/src/lib/benefits-realisation";
import { rollupIncome, rollupBenefits, type ProjectItems } from "../../artifacts/omniproject/src/lib/portfolio-value";
import { consolidateFinancials, type ProjectFin } from "../../artifacts/omniproject/src/lib/portfolio-finance";
import { summariseRaid } from "../../artifacts/omniproject/src/lib/raid-register";
import { summariseFinancials } from "../../artifacts/omniproject/src/lib/financial-summary";
import { summariseBenefits } from "../../artifacts/omniproject/src/lib/benefits";
import { summariseIncome } from "../../artifacts/omniproject/src/lib/income";
import { summariseCapex } from "../../artifacts/omniproject/src/lib/capex";
import { rollupByProgramme, type ProjectCapacity } from "../../artifacts/omniproject/src/lib/capacity-rollup";
import { capacitySummary } from "../../artifacts/omniproject/src/lib/capacity";
import { buildRoadmap } from "../../artifacts/omniproject/src/lib/roadmap";
import { scheduleWindow, timePhasedForecast } from "../../artifacts/omniproject/src/lib/forecast-curve";
import { simulate } from "../../artifacts/omniproject/src/lib/monte-carlo";
import { resourceLoad } from "../../artifacts/omniproject/src/lib/resource-load";
import { effortProgress } from "../../artifacts/omniproject/src/lib/effort";

const SEEDS = ["omni", "chaos", "gremlin", "3", "zzz", "north-star"];
const INTENSITY = 1;

function cfg(seed: string): MessyConfig {
  return { on: true, seed, intensity: INTENSITY, gremlins: [] };
}

// ── Output sanity checks ────────────────────────────────────────────────────────

interface Finding {
  fn: string;
  seed: string;
  mode: "throw" | "NaN" | "Infinity" | "invalidDate" | "badType";
  detail: string;
}
const findings: Finding[] = [];

/** Walk an arbitrary value tree, flagging NaN / Infinity / invalid Date leaves. */
function scan(fn: string, seed: string, value: unknown, path = ""): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number") {
    if (Number.isNaN(value)) findings.push({ fn, seed, mode: "NaN", detail: `${path} is NaN` });
    else if (!Number.isFinite(value)) findings.push({ fn, seed, mode: "Infinity", detail: `${path} is ${value}` });
    return;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) findings.push({ fn, seed, mode: "invalidDate", detail: `${path} is Invalid Date` });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(fn, seed, v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) scan(fn, seed, v, path ? `${path}.${k}` : k);
  }
}

/** Run one derive call: catch throws; scan the result for NaN/Infinity/Invalid Date. */
function probe(fn: string, seed: string, run: () => unknown): void {
  let out: unknown;
  try {
    out = run();
  } catch (e) {
    findings.push({ fn, seed, mode: "throw", detail: (e as Error)?.message ?? String(e) });
    return;
  }
  scan(fn, seed, out);
}

// ── Adapters: build each derive function's input from messified demo rows ─────────

function projectItemsFrom(seed: string): ProjectItems[] {
  const config = cfg(seed);
  const projects = messifyRows(SAMPLE_PROJECTS as Row[], config, "listProjects");
  return projects.map((p) => {
    const pid = String((p as { id?: unknown }).id ?? "");
    const issues = messifyRows((SAMPLE_ISSUES[pid] ?? []) as Row[], config, "listIssues");
    return {
      projectId: pid,
      projectName: String((p as { name?: unknown }).name ?? pid),
      programmeId: (p["programmeId"] as string | null) ?? null,
      programmeName: (p["programmeName"] as string | null) ?? null,
      currency: (p["currency"] as string) ?? "GBP",
      items: issues as unknown as ProjectItems["items"],
    };
  });
}

function projectFinFrom(seed: string): ProjectFin[] {
  const config = cfg(seed);
  const projects = messifyRows(SAMPLE_PROJECTS as Row[], config, "listProjects");
  const fin = messifyRows([SAMPLE_FINANCIALS as Row], config, "projectFinancials")[0]!;
  return projects.map((p) => ({
    projectId: String((p as { id?: unknown }).id ?? ""),
    projectName: String((p as { name?: unknown }).name ?? ""),
    programmeId: (p["programmeId"] as string | null) ?? null,
    programmeName: (p["programmeName"] as string | null) ?? null,
    fin: fin as never,
  }));
}

function projectCapacityFrom(seed: string): ProjectCapacity[] {
  const config = cfg(seed);
  const projects = messifyRows(SAMPLE_PROJECTS as Row[], config, "listProjects");
  const cap = messifyRows(SAMPLE_CAPACITY as Row[], config, "resourceCapacity");
  return projects.map((p) => ({
    projectId: String((p as { id?: unknown }).id ?? ""),
    projectName: String((p as { name?: unknown }).name ?? ""),
    programmeId: (p["programmeId"] as string | null) ?? null,
    programmeName: (p["programmeName"] as string | null) ?? null,
    resources: cap as never,
  }));
}

const rates = DEMO_FX.rates;
const asOf = Date.UTC(2026, 6, 1);

for (const seed of SEEDS) {
  const config = cfg(seed);
  const projectItems = projectItemsFrom(seed);
  const allItems = projectItems.flatMap((p) => p.items);
  const portfolio = messifyRows(SAMPLE_PORTFOLIO as Row[], config, "portfolioHealth");
  const raidAll = Object.values(SAMPLE_RAID).flatMap((rows) => messifyRows(rows as Row[], config, "listRaid"));
  const capacity = messifyRows(SAMPLE_CAPACITY as Row[], config, "resourceCapacity");
  const projects = messifyRows(SAMPLE_PROJECTS as Row[], config, "listProjects");
  const issuesByProject: Record<string, Row[]> = {};
  for (const p of projects) {
    const pid = String((p as { id?: unknown }).id ?? "");
    issuesByProject[pid] = messifyRows((SAMPLE_ISSUES[pid] ?? []) as Row[], config, "listIssues");
  }

  // exec-pack
  probe("buildExecHealth", seed, () => {
    const h = buildExecHealth(portfolio as never);
    execHeadline(h);
    return h;
  });

  // benefits-realisation
  probe("realisationPipeline", seed, () => realisationPipeline(projectItems, "GBP", rates));
  probe("realisationSchedule", seed, () => realisationSchedule(projectItems, "GBP", rates, asOf));

  // portfolio-value
  probe("rollupIncome", seed, () => rollupIncome(projectItems, "GBP", rates));
  probe("rollupBenefits", seed, () => rollupBenefits(projectItems, "GBP", rates));

  // portfolio-finance
  probe("consolidateFinancials", seed, () => consolidateFinancials(projectFinFrom(seed), "GBP", rates));

  // per-item summaries
  probe("summariseBenefits", seed, () => summariseBenefits(allItems as never));
  probe("summariseIncome", seed, () => summariseIncome(allItems as never));
  probe("summariseCapex", seed, () => summariseCapex(allItems as never));
  probe("summariseFinancials", seed, () => summariseFinancials(allItems as never));

  // raid
  probe("summariseRaid", seed, () => summariseRaid(raidAll as never));

  // capacity
  probe("rollupByProgramme", seed, () => rollupByProgramme(projectCapacityFrom(seed)));
  probe("capacitySummary", seed, () =>
    capacitySummary(
      capacity.map((r) => {
        const util = Number(r["allocationPercentage"]);
        return Number.isFinite(util) ? util : null;
      }),
      100,
    ),
  );

  // roadmap
  probe("buildRoadmap", seed, () => buildRoadmap(projects as never, issuesByProject as never));

  // forecast-curve
  probe("timePhasedForecast", seed, () => {
    const win = scheduleWindow(allItems as never, asOf);
    if (!win) return null;
    const fin = summariseFinancials(allItems as never);
    return timePhasedForecast({
      bac: fin.budget,
      eac: fin.budget * 1.1,
      actualToDate: fin.actual,
      start: win.start,
      end: win.end,
      asOf,
      profile: "scurve",
    });
  });

  // monte-carlo
  probe("simulate", seed, () =>
    simulate(
      allItems.map((it) => ({
        id: String((it as Row)["id"] ?? ""),
        label: String((it as Row)["title"] ?? ""),
        estimate: Number((it as Row)["estimateHours"]),
      })),
      { iterations: 500 },
    ),
  );

  // resource-load — the caller resolves dates → day numbers before this runs (mirrors the SPA).
  const DAY = 86_400_000;
  probe("resourceLoad", seed, () =>
    resourceLoad(
      (allItems as Row[]).map((it) => {
        const s = it["startDate"] ? Date.parse(String(it["startDate"])) : NaN;
        const d = it["dueDate"] ? Date.parse(String(it["dueDate"])) : NaN;
        const startDay = Number.isNaN(s) ? 0 : Math.floor(s / DAY);
        const endDay = Number.isNaN(d) ? startDay : Math.floor(d / DAY);
        return {
          id: String(it["id"] ?? ""),
          title: String(it["title"] ?? ""),
          assignee: (it["assignee"] as string | null) ?? null,
          startDay,
          endDay,
          active: !["done", "cancelled"].includes(String(it["status"] ?? "").toLowerCase()),
        };
      }),
    ),
  );

  // effort
  probe("effortProgress", seed, () => {
    for (const it of allItems as Row[]) effortProgress(it["estimateHours"] as never, it["loggedHours"] as never);
    return null;
  });
}

// ── Report ──────────────────────────────────────────────────────────────────────

const byFn = new Map<string, Finding[]>();
for (const f of findings) {
  const list = byFn.get(f.fn) ?? [];
  list.push(f);
  byFn.set(f.fn, list);
}

console.log(`\nMessy-data resilience probe — intensity ${INTENSITY}, seeds: ${SEEDS.join(", ")}\n`);
if (findings.length === 0) {
  console.log("No throws / NaN / Infinity / invalid dates observed across any seed. All consumers resilient.");
} else {
  console.log(`${findings.length} finding(s) across ${byFn.size} function(s):\n`);
  for (const [fn, list] of [...byFn.entries()].sort()) {
    const modes = new Map<string, { seeds: Set<string>; sample: string }>();
    for (const f of list) {
      const m = modes.get(f.mode) ?? { seeds: new Set<string>(), sample: f.detail };
      m.seeds.add(f.seed);
      modes.set(f.mode, m);
    }
    console.log(`  ${fn}`);
    for (const [mode, m] of modes) {
      console.log(`    - ${mode} [seeds: ${[...m.seeds].join(",")}]  e.g. ${m.sample}`);
    }
  }
}
console.log("");
