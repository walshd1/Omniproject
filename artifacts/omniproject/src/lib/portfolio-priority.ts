import { num } from "./num";
import { summariseBenefits, type BenefitInput } from "./benefits";

/**
 * Portfolio prioritisation scoring — a pure, STATELESS rank score per project, blending the existing
 * RICE / WSJF / MoSCoW (agile field group) + strategic-goal contribution (strategy field group) +
 * benefits realisation (benefits field group) canonical fields, weighted by admin-configurable
 * `PriorityWeights`. Nothing is persisted: given the same work items + weights, the same score comes
 * out every time — computed live over the read model on each request, mirroring the other portfolio
 * roll-ups (portfolio-finance, capacity-rollup, portfolio-value).
 *
 * RICE/WSJF/strategic-contribution are ISSUE-level canonical fields (a backend rarely scores the
 * "project" row itself), so a project's score is derived from the AVERAGE of its work items that
 * actually carry a value — mirroring how benefits.ts already rolls issue-level benefit rows up into a
 * project total. A project that doesn't report a dimension is not penalised for it (scored on what it
 * DOES report); a project with no signal on any dimension can't be ranked (`compositeScore: null`) and
 * sorts last rather than pretending to be "worthless".
 */

/** The per-issue input fields the prioritisation score reads, layered onto the benefit fields. */
export interface PriorityInput extends BenefitInput {
  riceScore?: number | null;
  wsjf?: number | null;
  moscow?: string | null;
  strategicContribution?: number | null;
}

/** Admin-configurable dimension weights (settings JSON — see routes/portfolio-priority-weights).
 *  Values are relative, not required to sum to 100: the composite renormalises over whichever
 *  dimensions a project actually has data for. A weight of 0 switches a dimension off entirely. */
export interface PriorityWeights {
  rice: number;
  wsjf: number;
  moscow: number;
  strategic: number;
  benefit: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { rice: 25, wsjf: 25, moscow: 15, strategic: 15, benefit: 20 };

/** One project's inputs to the ranking: its work items (for RICE/WSJF/MoSCoW/strategic/benefit fields)
 *  plus the cost + capacity context to weight against, both pre-converted/pre-summed by the caller
 *  (mirroring ProjectFin / ProjectCapacity — the roll-up modules take already-consolidated numbers). */
export interface ProjectPriorityInput {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  items: readonly PriorityInput[];
  /** Budget ask for this project, already converted to the reporting currency. */
  cost: number;
  /** Resourcing footprint (assigned hours) if this project proceeds. */
  capacityHours: number;
}

export interface ProjectPriorityScore {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  /** 1-based rank by compositeScore desc (undated projects sort last). */
  rank: number;
  riceScore: number | null;
  wsjf: number | null;
  /** MoSCoW converted to a 0–100 weight (must=100 … won't=0), averaged across items that set it. */
  moscowScore: number | null;
  /** Average strategic-goal contribution, 0–100. */
  strategicScore: number | null;
  /** Σ planned benefit value × confidence — the risk-adjusted benefit case (raw currency). */
  benefitValue: number;
  /** 0–100 composite, weighted average of the normalised dimensions the project reports; null when the
   *  project reports NONE of the five dimensions (nothing to rank it on). */
  compositeScore: number | null;
  cost: number;
  capacityHours: number;
  /** compositeScore per £1k of cost — the "bang per buck" density used to break funding ties;
   *  null when cost is 0 or the project has no compositeScore. */
  valueDensity: number | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Map a free-form MoSCoW string to a 0–100 weight. Regex-matched (mirrors benefitBucket in
 *  benefits.ts) so "Must have", "MUST", "m" (Jira shorthand) etc. all resolve the same way. */
export function moscowWeight(value?: string | null): number | null {
  const s = (value ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/won.?t|will.?not/.test(s)) return 0; // check before "should"/"could" (no overlap risk, but explicit)
  if (/must/.test(s)) return 100;
  if (/should/.test(s)) return 66;
  if (/could/.test(s)) return 33;
  return null; // unrecognised free-form value — no signal, not a false "won't"
}

function average(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Finite numbers only — a dirty read-model value (string/null/NaN) drops out rather than poisoning
 *  the average (the same "coerce before aggregating" discipline as num(), but drop instead of zero:
 *  averaging in a false 0 would understate a project that just has one dirty field). */
function finiteValues(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

interface ProjectAggregate {
  rice: number | null;
  wsjf: number | null;
  moscow: number | null;
  strategic: number | null;
  benefitValue: number;
}

/** Roll one project's work items up into its raw (un-normalised) prioritisation signals. */
function aggregateProject(items: readonly PriorityInput[]): ProjectAggregate {
  const rice = average(finiteValues(items.map((i) => i.riceScore)));
  const wsjf = average(finiteValues(items.map((i) => i.wsjf)));
  const moscow = average(items.map((i) => moscowWeight(i.moscow)).filter((v): v is number => v != null));
  const strategic = average(finiteValues(items.map((i) => i.strategicContribution)).map((v) => Math.min(100, Math.max(0, v))));
  const benefitValue = summariseBenefits(items).expectedValue;
  return { rice, wsjf, moscow, strategic, benefitValue };
}

/** Min-max normalise a column of (possibly absent) values to 0–100 across the portfolio set, so
 *  unbounded fields (RICE, WSJF, currency benefit value) become comparable to the naturally-bounded
 *  percent fields. A single measured value (or a flat column) scores 100 rather than dividing by zero —
 *  one data point can't be "worst in the portfolio" on that axis. */
function minMaxNormalise(values: readonly (number | null)[]): (number | null)[] {
  const present = finiteValues(values);
  if (!present.length) return values.map(() => null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  return values.map((v) => (v == null ? null : hi === lo ? 100 : ((v - lo) / (hi - lo)) * 100));
}

/**
 * Score + rank every project. Pure and derive-only: same items + weights ⇒ same ranking, every time.
 * Sorted best-first (compositeScore desc, name breaks ties); projects with no signal on any dimension
 * sort last (name order among themselves) rather than being silently dropped, so the head of projects
 * still sees every project in the portfolio.
 */
export function scorePortfolio(
  inputs: readonly ProjectPriorityInput[],
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): ProjectPriorityScore[] {
  const rows = inputs.map((p) => ({ p, agg: aggregateProject(p.items) }));
  const riceNorm = minMaxNormalise(rows.map((r) => r.agg.rice));
  const wsjfNorm = minMaxNormalise(rows.map((r) => r.agg.wsjf));
  // Benefit value of exactly 0 means "nothing planned" (isBenefit() already excludes non-benefit
  // items from the sum) — treat it as absent so a project with no benefit case isn't scored 0 on it.
  const benefitNorm = minMaxNormalise(rows.map((r) => (r.agg.benefitValue > 0 ? r.agg.benefitValue : null)));

  const unranked: Omit<ProjectPriorityScore, "rank">[] = rows.map((r, i) => {
    const dims: { w: number; v: number | null }[] = [
      { w: weights.rice, v: riceNorm[i] ?? null },
      { w: weights.wsjf, v: wsjfNorm[i] ?? null },
      { w: weights.moscow, v: r.agg.moscow },
      { w: weights.strategic, v: r.agg.strategic },
      { w: weights.benefit, v: benefitNorm[i] ?? null },
    ];
    const active = dims.filter((d) => d.v != null && num(d.w) > 0);
    const weightSum = active.reduce((s, d) => s + d.w, 0);
    const composite = weightSum > 0 ? active.reduce((s, d) => s + d.w * (d.v as number), 0) / weightSum : null;
    const cost = num(r.p.cost);

    return {
      projectId: r.p.projectId,
      projectName: r.p.projectName,
      programmeId: r.p.programmeId,
      programmeName: r.p.programmeName,
      riceScore: r.agg.rice == null ? null : round1(r.agg.rice),
      wsjf: r.agg.wsjf == null ? null : round1(r.agg.wsjf),
      moscowScore: r.agg.moscow == null ? null : round1(r.agg.moscow),
      strategicScore: r.agg.strategic == null ? null : round1(r.agg.strategic),
      benefitValue: round1(r.agg.benefitValue),
      compositeScore: composite == null ? null : round1(composite),
      cost,
      capacityHours: num(r.p.capacityHours),
      valueDensity: composite != null && cost > 0 ? round1((composite / cost) * 1000) : null,
    };
  });

  unranked.sort((a, b) => {
    if (a.compositeScore == null && b.compositeScore == null) return a.projectName.localeCompare(b.projectName);
    if (a.compositeScore == null) return 1;
    if (b.compositeScore == null) return -1;
    return b.compositeScore - a.compositeScore || a.projectName.localeCompare(b.projectName);
  });

  return unranked.map((r, i) => ({ ...r, rank: i + 1 }));
}
