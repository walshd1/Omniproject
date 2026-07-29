/**
 * EXEC DIGEST / STATUS-REPORT ASSEMBLY — the capstone that turns Wave-5's analytic engines into ONE structured
 * portfolio digest an LLM (or a report surface) narrates (roadmap §4.4, "AI status-report + exec-digest
 * generation from brokered state"). There is NO LLM in this core and NO recomputation: it takes the RESULT
 * objects the other engines already produced — health-score's portfolio bands, okr-linkage's objective progress,
 * evm's variance, demand-dedup's duplicate pairs — and assembles a headline + ranked, top-N sections. Grounding
 * the narration in this structured output (rather than free-associating over raw records) is what keeps an
 * exec-digest faithful; the LLM only phrases what this engine selected.
 *
 * Every input is optional — a digest assembles from whatever the deployment can broker. Pure, no I/O.
 * Deterministic (sections use the engines' own already-deterministic ordering + a fixed top-N cut; no
 * Math.random). Validation first / guarded: a null metric stays null (never coerced to a misleading 0), an empty
 * portfolio yields an "unknown" headline, and top-N is clamped ≥ 0.
 */
import type { HealthPortfolioResult } from "./health-score";
import type { OkrPortfolioResult } from "./okr-linkage";
import type { EvmResult } from "./evm";
import type { DedupResult } from "./demand-dedup";
import type { CanonicalRag } from "./rag-vocabulary";

export interface DigestInput {
  health?: HealthPortfolioResult;
  okr?: OkrPortfolioResult;
  evm?: EvmResult;
  duplicates?: DedupResult;
}

export interface DigestOptions {
  /** How many items each ranked section keeps. Default 5; clamped to ≥ 0. */
  topN?: number;
}

export interface RiskLine {
  id: string;
  band: CanonicalRag;
  /** The initiative's worst plain-English reason, or null when it carried none. */
  reason: string | null;
}

export interface ObjectiveLine {
  id: string;
  progress: number | null;
  deliveryGap: number | null;
}

export interface FinanceSummary {
  estimateAtCompletion: number | null;
  varianceAtCompletion: number | null;
  costPerformanceIndex: number | null;
  schedulePerformanceIndex: number | null;
  /** From CPI: < 1 over budget, ≥ 1 on/under; null when CPI is null. */
  costStatus: "over-budget" | "on-or-under-budget" | null;
  /** From SPI: < 1 behind schedule, ≥ 1 on/ahead; null when SPI is null. */
  scheduleStatus: "behind-schedule" | "on-or-ahead" | null;
}

export interface ExecDigest {
  headline: {
    /** Worst band present across the health portfolio; "unknown" when no health input. */
    band: CanonicalRag | "unknown";
    /** One-line plain-English roll-up of the assembled facts. */
    summary: string;
  };
  /** Top-N red/amber initiatives from the health portfolio (its own worst-first order). */
  risks: RiskLine[];
  /** OKR roll-up, or null when no OKR input. */
  okr: { meanProgress: number | null; offTrack: number; worst: ObjectiveLine[] } | null;
  /** EVM variance highlights, or null when no EVM input. */
  finance: FinanceSummary | null;
  /** Duplicate-demand triage counts, or null when no dedup input. */
  duplicates: { pairs: number; clusters: number } | null;
}

const pct = (n: number | null): string => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

/** Worst band present: red if any red, else amber if any amber, else green if any green, else "unknown". */
function headlineBand(health: HealthPortfolioResult | undefined): CanonicalRag | "unknown" {
  if (!health) return "unknown";
  if (health.counts.red > 0) return "red";
  if (health.counts.amber > 0) return "amber";
  if (health.counts.green > 0) return "green";
  return "unknown";
}

/**
 * Assemble a structured exec digest from whatever engine results are supplied. Empty input ⇒ an "unknown"
 * headline with empty/null sections.
 */
export function assembleExecDigest(input: DigestInput, options: DigestOptions = {}): ExecDigest {
  const topN = Math.max(0, Math.round(Number.isFinite(options.topN as number) ? (options.topN as number) : 5));
  const band = headlineBand(input.health);

  const risks: RiskLine[] = input.health
    ? input.health.ranked
        .filter((r) => r.band !== "green")
        .slice(0, topN)
        .map((r) => ({ id: r.id, band: r.band, reason: r.reasons[0] ?? null }))
    : [];

  let okr: ExecDigest["okr"] = null;
  if (input.okr) {
    const offTrack = input.okr.counts["off-track"];
    // Worst objectives: lowest progress first (nulls last), then id — a stable, fixed cut.
    const worst = [...input.okr.objectives]
      .sort((a, b) => {
        const pa = a.progress, pb = b.progress;
        if (pa === null && pb === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa !== pb ? pa - pb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, topN)
      .map((o) => ({ id: o.id, progress: o.progress, deliveryGap: o.deliveryGap }));
    okr = { meanProgress: input.okr.meanProgress, offTrack, worst };
  }

  let finance: FinanceSummary | null = null;
  if (input.evm) {
    const cpi = input.evm.costPerformanceIndex;
    const spi = input.evm.schedulePerformanceIndex;
    finance = {
      estimateAtCompletion: input.evm.estimateAtCompletion,
      varianceAtCompletion: input.evm.varianceAtCompletion,
      costPerformanceIndex: cpi,
      schedulePerformanceIndex: spi,
      costStatus: cpi === null ? null : cpi < 1 ? "over-budget" : "on-or-under-budget",
      scheduleStatus: spi === null ? null : spi < 1 ? "behind-schedule" : "on-or-ahead",
    };
  }

  const duplicates = input.duplicates
    ? { pairs: input.duplicates.pairs.length, clusters: input.duplicates.clusters.length }
    : null;

  // Plain-English headline summary, assembled only from the parts that are present.
  const parts: string[] = [];
  if (input.health) {
    const c = input.health.counts;
    parts.push(`${c.red} red, ${c.amber} amber, ${c.green} green initiatives`);
  }
  if (okr) parts.push(`OKR progress ${pct(okr.meanProgress)} (${okr.offTrack} off-track)`);
  if (finance) {
    const cpiTxt = finance.costPerformanceIndex === null ? "n/a" : String(finance.costPerformanceIndex);
    parts.push(`EVM CPI ${cpiTxt}${finance.costStatus ? ` (${finance.costStatus})` : ""}`);
  }
  if (duplicates && duplicates.pairs > 0) parts.push(`${duplicates.pairs} duplicate-demand pair(s)`);
  const summary = parts.length > 0 ? parts.join("; ") : "no portfolio signals available";

  return { headline: { band, summary }, risks, okr, finance, duplicates };
}
