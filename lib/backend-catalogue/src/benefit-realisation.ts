/**
 * BENEFIT REALISATION ROLL-UP — a pure, STATELESS planned-vs-actual analyser over the benefit register a
 * portfolio already records (roadmap §4.1, "Benefits realization — record ✅, but the planned-vs-actual
 * roll-up + Goals/OKR linkage remain"). The `benefit` record stores each benefit's planned value, actual
 * value, lifecycle status and due date; `okr-linkage` already covers the Goals/OKR half, and
 * `benefit-monte-carlo` samples the probabilistic value spread — but nothing crossed PLANNED against ACTUAL
 * to say "we planned £2m, realised £1.2m — 60% and one benefit is overdue and unrealised". This does: per
 * benefit the variance, variance %, realisation ratio and an on-track / at-risk-overdue / realised /
 * abandoned classification, then a portfolio roll-up by category and status with the realised-vs-outstanding
 * value split.
 *
 * Mirrors `run-rate` / `task-workload` (records → pure compute → sorted roll-up), and REUSES the `num` guarded
 * helpers (`numLoose` / `round1` / `round2`) rather than re-deriving coercion. Pure, no I/O, DETERMINISTIC:
 * it never calls `Date` — `now` and the due dates are epoch-ms numbers passed in, and every ranking is
 * id-tiebroken. Validation-first and fail-closed: ids coerced, non-object rows dropped, dirty values coerce
 * to 0, the realisation ratio + variance % are null when the plan is 0 (never NaN/±Infinity), a dirty due
 * date is simply not overdue — it never throws. Empty ⇒ empty.
 */
import { numLoose, optNum, round1, round2 } from "./num";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Lifecycle statuses the classification keys off (the `benefit.benefitLifecycleStatus` enum). */
const REALISED_STATUS = "realised";
const ABANDONED_STATUS = "abandoned";
const UNCATEGORISED = "uncategorised";

/** How a benefit is tracking against its plan. */
export type BenefitClass = "realised" | "abandoned" | "overdue" | "on_track";

/** One benefit, read defensively (mirrors the `benefit` record's value/status/date fields). */
export interface BenefitRecord {
  id: string;
  /** Planned benefit value (`plannedBenefitValue`). Dirty/absent ⇒ 0. */
  plannedValue?: number | null;
  /** Actual value realised so far (`actualBenefitValue`). Dirty/absent ⇒ 0. */
  actualValue?: number | null;
  /** Lifecycle status (identified | planned | realising | realised | abandoned). */
  status?: string | null;
  /** Benefit category (financial | non_financial | cost_avoidance | revenue); blank ⇒ "uncategorised". */
  category?: string | null;
  /** Due date (epoch ms); past + not realised/abandoned ⇒ an overdue unrealised benefit. */
  dueDate?: number | null;
}

export interface BenefitRealisationOptions {
  /** Current time as epoch ms — REQUIRED for overdue detection (the engine never calls Date). */
  now: number;
}

export interface ScoredBenefit {
  id: string;
  planned: number;
  actual: number;
  /** actual − planned (positive = ahead of plan). */
  variance: number;
  /** variance / planned × 100, 1dp; null when planned is 0. */
  variancePct: number | null;
  /** actual / planned, 2dp; null when planned is 0. */
  realisationRatio: number | null;
  classification: BenefitClass;
  /** Not realised/abandoned and past its due date. */
  overdue: boolean;
  category: string;
  status: string;
}

export interface CategoryRollup {
  category: string;
  planned: number;
  actual: number;
  variance: number;
  realisationRatio: number | null;
  count: number;
}

export interface BenefitRealisationResult {
  /** Per benefit, worst-realisation first (lowest ratio → id); a null ratio (no plan) sorts last. */
  benefits: ScoredBenefit[];
  /** Roll-up per category, category-id sorted. */
  byCategory: CategoryRollup[];
  /** Count per lifecycle status. */
  byStatus: Record<string, number>;
  summary: {
    total: number;
    realised: number;
    abandoned: number;
    /** Not realised/abandoned and past due. */
    overdue: number;
    onTrack: number;
    totalPlanned: number;
    totalActual: number;
    totalVariance: number;
    /** totalActual / totalPlanned, 2dp; null when nothing is planned. */
    overallRealisationRatio: number | null;
    /** Sum of actual value on realised benefits. */
    realisedValue: number;
    /** max(0, totalPlanned − totalActual) — the value still to be realised. */
    outstandingValue: number;
  };
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Roll a benefit register up planned-vs-actual. `now` and due dates are epoch-ms numbers supplied by the
 * caller. Deterministic (id-tiebroken), fail-closed, empty ⇒ empty.
 */
export function analyzeBenefitRealisation(benefits: readonly BenefitRecord[], options: BenefitRealisationOptions): BenefitRealisationResult {
  const now = numLoose(options?.now);

  const scored: ScoredBenefit[] = [];
  const catMap = new Map<string, { planned: number; actual: number; count: number }>();
  const byStatus: Record<string, number> = {};
  let totalPlanned = 0, totalActual = 0, realisedValue = 0;
  let realised = 0, abandoned = 0, overdue = 0, onTrack = 0;

  if (Array.isArray(benefits)) {
    for (const raw of benefits) {
      if (raw === null || typeof raw !== "object") continue;
      const b = raw as BenefitRecord;
      const id = coerceId(b.id);
      if (id === null) continue;

      const planned = numLoose(b.plannedValue);
      const actual = numLoose(b.actualValue);
      const status = typeof b.status === "string" && b.status.trim() ? b.status.trim() : "";
      const category = typeof b.category === "string" && b.category.trim() ? b.category.trim() : UNCATEGORISED;
      const variance = actual - planned;
      const realisationRatio = planned !== 0 ? round2(actual / planned) : null;
      const isRealised = status === REALISED_STATUS || (planned !== 0 && actual >= planned);
      const isAbandoned = status === ABANDONED_STATUS;
      const due = optNum(b.dueDate);
      const isOverdue = !isRealised && !isAbandoned && due !== null && due < now;

      const classification: BenefitClass = isAbandoned ? "abandoned" : isRealised ? "realised" : isOverdue ? "overdue" : "on_track";
      if (classification === "realised") { realised++; realisedValue += actual; }
      else if (classification === "abandoned") abandoned++;
      else if (classification === "overdue") overdue++;
      else onTrack++;

      totalPlanned += planned;
      totalActual += actual;
      byStatus[status || "unknown"] = (byStatus[status || "unknown"] ?? 0) + 1;
      const cat = catMap.get(category) ?? { planned: 0, actual: 0, count: 0 };
      cat.planned += planned; cat.actual += actual; cat.count += 1;
      catMap.set(category, cat);

      scored.push({
        id, planned: round2(planned), actual: round2(actual), variance: round2(variance),
        variancePct: planned !== 0 ? round1((variance / planned) * 100) : null,
        realisationRatio, classification, overdue: isOverdue, category, status: status || "unknown",
      });
    }
  }

  // Worst-realisation first: lowest ratio (a null ratio — no plan — sorts last), id-tiebroken.
  scored.sort((a, b) => {
    const ra = a.realisationRatio ?? Infinity;
    const rb = b.realisationRatio ?? Infinity;
    return ra !== rb ? ra - rb : byId(a.id, b.id);
  });

  const byCategory: CategoryRollup[] = [...catMap.entries()]
    .map(([category, c]) => ({
      category,
      planned: round2(c.planned),
      actual: round2(c.actual),
      variance: round2(c.actual - c.planned),
      realisationRatio: c.planned !== 0 ? round2(c.actual / c.planned) : null,
      count: c.count,
    }))
    .sort((a, b) => byId(a.category, b.category));

  return {
    benefits: scored,
    byCategory,
    byStatus,
    summary: {
      total: scored.length,
      realised,
      abandoned,
      overdue,
      onTrack,
      totalPlanned: round2(totalPlanned),
      totalActual: round2(totalActual),
      totalVariance: round2(totalActual - totalPlanned),
      overallRealisationRatio: totalPlanned !== 0 ? round2(totalActual / totalPlanned) : null,
      realisedValue: round2(realisedValue),
      outstandingValue: round2(Math.max(0, totalPlanned - totalActual)),
    },
  };
}
