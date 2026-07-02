/**
 * Benefits realisation — a pure, STATELESS roll-up over the canonical `benefit*` fields.
 *
 * Given the work items already loaded for a project, it summarises planned-vs-actual benefit
 * value, the realisation %, the spread by RAG status, and a risk-adjusted expected value
 * (planned × confidence). Nothing is stored: the same issues always produce the same summary.
 */
import { num } from "./num";

export interface BenefitInput {
  id: string;
  title: string;
  plannedBenefitValue?: number | null;
  actualBenefitValue?: number | null;
  benefitStatus?: string | null;
  benefitType?: string | null;
  benefitOwner?: string | null;
  benefitMeasure?: string | null;
  benefitBaseline?: number | null;
  benefitTarget?: number | null;
  benefitDueDate?: string | null;
  benefitConfidence?: number | null;
}

/** Canonical realisation-health buckets the free-form `benefitStatus` is normalised into. */
export type BenefitBucket = "realised" | "on_track" | "at_risk" | "missed" | "not_started";

export interface BenefitRow extends BenefitInput {
  planned: number;
  actual: number;
  /** actual / planned, clamped to [0, …]; 0 when nothing is planned. */
  realisation: number;
  bucket: BenefitBucket;
}

export interface BenefitsSummary {
  count: number;
  totalPlanned: number;
  totalActual: number;
  /** totalActual / totalPlanned (0 when nothing planned). */
  realisation: number;
  /** Σ planned × (confidence/100) — the risk-adjusted forecast (falls back to planned when no confidence). */
  expectedValue: number;
  byStatus: Record<BenefitBucket, number>;
  rows: BenefitRow[];
}

const EMPTY_BUCKETS = (): Record<BenefitBucket, number> => ({
  realised: 0, on_track: 0, at_risk: 0, missed: 0, not_started: 0,
});

/** Map a backend's free-form status string to a canonical RAG bucket. */
export function benefitBucket(status?: string | null): BenefitBucket {
  const s = (status ?? "").toLowerCase();
  if (/realis|realiz|complete|achiev|deliver|green/.test(s)) return "realised";
  if (/miss|fail|lost|cancel|red/.test(s)) return "missed";
  if (/risk|amber|delay|slip/.test(s)) return "at_risk";
  if (/track|on.?plan|progress/.test(s)) return "on_track";
  return "not_started";
}

/** The modelled BenefitInput keys — the ONLY input fields a report row carries. */
const BENEFIT_INPUT_KEYS = [
  "id", "title", "plannedBenefitValue", "actualBenefitValue", "benefitStatus", "benefitType",
  "benefitOwner", "benefitMeasure", "benefitBaseline", "benefitTarget", "benefitDueDate", "benefitConfidence",
] as const;

/** Copy ONLY the modelled BenefitInput fields (omitting undefined, like a spread), so unmodelled
 *  dirty fields on the raw read-model row (e.g. a NaN opexAmount) can't leak into the report row. */
function pickBenefitInput(i: BenefitInput): BenefitInput {
  const src = i as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { id: i.id, title: i.title };
  for (const k of BENEFIT_INPUT_KEYS) {
    const v = src[k];
    if (v !== undefined) out[k] = v;
  }
  return out as unknown as BenefitInput;
}

/** A work item counts as a benefit when it carries a planned/actual value or a status. */
export function isBenefit(i: BenefitInput): boolean {
  return num(i.plannedBenefitValue) > 0 || num(i.actualBenefitValue) > 0 || !!(i.benefitStatus && i.benefitStatus.trim());
}

export function summariseBenefits(items: readonly BenefitInput[]): BenefitsSummary {
  const rows: BenefitRow[] = [];
  const byStatus = EMPTY_BUCKETS();
  let totalPlanned = 0;
  let totalActual = 0;
  let expectedValue = 0;

  for (const i of items) {
    if (!isBenefit(i)) continue;
    const planned = num(i.plannedBenefitValue);
    const actual = num(i.actualBenefitValue);
    const bucket = benefitBucket(i.benefitStatus);
    // Confidence defaults to 100% when the backend doesn't supply it (don't penalise silence).
    const confidence = i.benefitConfidence == null ? 100 : Math.min(100, Math.max(0, num(i.benefitConfidence)));
    totalPlanned += planned;
    totalActual += actual;
    expectedValue += planned * (confidence / 100);
    byStatus[bucket] += 1;
    // Carry ONLY the modelled BenefitInput fields (not a blind {...i} spread), so unmodelled dirty
    // fields on the raw read-model row (e.g. a NaN opexAmount) can't leak into the report row.
    rows.push({
      ...pickBenefitInput(i),
      planned,
      actual,
      realisation: planned > 0 ? actual / planned : 0,
      bucket,
    });
  }

  // Largest planned value first — the benefits that matter most lead the table.
  rows.sort((a, b) => b.planned - a.planned || b.actual - a.actual);

  return {
    count: rows.length,
    totalPlanned,
    totalActual,
    realisation: totalPlanned > 0 ? totalActual / totalPlanned : 0,
    expectedValue,
    byStatus,
    rows,
  };
}
