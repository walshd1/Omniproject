/**
 * EPIC / INITIATIVE HEALTH SCORING — a deterministic R/A/G health engine over the risk signals a portfolio
 * already exposes (roadmap §4.4, "Epic/initiative health scoring — R/Y/G across risk dimensions (dependencies,
 * blocked work, timeline, ownership) with plain-English reasoning"). This is the SCORING core the copilot story
 * needs, and it needs no LLM: given each initiative's per-dimension risk severities + weights, it computes a
 * weighted composite, maps it to a canonical RAG band, and emits plain-English reasons — so a surface can say
 * "AMBER — dependencies at risk (0.8), timeline slipping (0.6)" from brokered state, nothing cached.
 *
 * Bands come from the shared {@link CanonicalRag} vocabulary (red/amber/green) — this engine CLASSIFIES into the
 * existing bands, it never invents its own. Dimensions are caller-supplied (dependencies / blockedWork / timeline
 * / ownership are the §4.4 set, but any are accepted), keeping it vendor-neutral. Severity is a 0 (healthy) … 1
 * (critical) scale; the composite and every band decision are pure functions of it.
 *
 * Pure, no I/O. Deterministic: reasons and the portfolio ranking use a fixed severity-then-id order (no
 * Math.random). Validation first: severity coerced + clamped to [0,1], weight coerced to ≥ 0 (numLoose, so a
 * dirty read can't produce NaN). Every divide guarded — the composite is `null` when nothing carries weight, and
 * a null composite bands as green (no measured risk), never NaN.
 */
import { numLoose, clamp } from "./num";
import { type CanonicalRag, RAG_BAND_LEVEL, RAG_BAND_LABEL } from "./rag-vocabulary";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface HealthDimension {
  id: string;
  label?: string;
  /** Risk severity, 0 (healthy) … 1 (critical). Coerced + clamped to [0, 1]. */
  severity: number;
  /** Relative weight in the composite; coerced to a finite number ≥ 0, default 1. */
  weight?: number;
}

export interface HealthThresholds {
  /** Composite ≤ greenMax ⇒ green. Default 0.33. */
  greenMax?: number;
  /** Composite ≤ amberMax ⇒ amber; above ⇒ red. Default 0.66. */
  amberMax?: number;
}

export interface HealthInput {
  id: string;
  dimensions: HealthDimension[];
}

export interface DimensionResult {
  id: string;
  label?: string;
  severity: number;
  weight: number;
  band: CanonicalRag;
}

export interface HealthResult {
  id: string;
  /** Weighted composite severity, 0 … 1; `null` when total weight is 0 (nothing measured). */
  score: number | null;
  /** Canonical RAG band for the composite (green when the score is null — no measured risk). */
  band: CanonicalRag;
  dimensions: DimensionResult[];
  /** Plain-English reasons for every amber/red dimension, worst severity first (empty when all green). */
  reasons: string[];
}

/** Classify a 0…1 severity into a canonical RAG band using the (default 0.33 / 0.66) thresholds. */
export function classifyHealth(severity: number, thresholds: HealthThresholds = {}): CanonicalRag {
  const greenMax = clamp(numLoose(thresholds.greenMax ?? 0.33), 0, 1);
  const amberMax = clamp(numLoose(thresholds.amberMax ?? 0.66), 0, 1);
  const s = clamp(numLoose(severity), 0, 1);
  if (s <= greenMax) return "green";
  if (s <= Math.max(greenMax, amberMax)) return "amber";
  return "red";
}

/**
 * Score one initiative: weight-average its dimension severities into a composite, band it, and list the
 * amber/red dimensions as plain-English reasons (worst first). Empty dimensions ⇒ score null, band green.
 */
export function scoreHealth(input: HealthInput, thresholds: HealthThresholds = {}): HealthResult {
  const dimensions: DimensionResult[] = input.dimensions.map((d) => {
    const severity = clamp(numLoose(d.severity), 0, 1);
    return {
      id: String(d.id),
      ...(d.label !== undefined ? { label: d.label } : {}),
      severity: round2(severity),
      weight: round2(Math.max(0, numLoose(d.weight ?? 1))),
      band: classifyHealth(severity, thresholds),
    };
  });

  let weighted = 0, totalWeight = 0;
  for (const d of dimensions) { weighted += d.severity * d.weight; totalWeight += d.weight; }
  const score = totalWeight > 0 ? round2(weighted / totalWeight) : null;
  const band: CanonicalRag = score === null ? "green" : classifyHealth(score, thresholds);

  // Reasons: amber/red dimensions, worst severity first (id tiebreak) — the plain-English "why".
  const reasons = dimensions
    .filter((d) => d.band !== "green")
    .sort((a, b) => (b.severity !== a.severity ? b.severity - a.severity : byId(a.id, b.id)))
    .map((d) => `${d.label ?? d.id}: ${RAG_BAND_LABEL[d.band]} (${d.severity})`);

  return { id: String(input.id), score, band, dimensions, reasons };
}

export interface HealthPortfolioResult {
  /** Every initiative scored, ranked worst band first (red < amber < green), then highest score, then id. */
  ranked: HealthResult[];
  /** Count of initiatives in each band. */
  counts: Record<CanonicalRag, number>;
}

/**
 * Score a set of initiatives and rank them worst-health first. Deterministic: band level ascending (red is the
 * lowest level ⇒ first), then composite score descending, then id. Empty input ⇒ empty ranking + zero counts.
 */
export function scoreHealthPortfolio(inputs: readonly HealthInput[], thresholds: HealthThresholds = {}): HealthPortfolioResult {
  const ranked = inputs.map((i) => scoreHealth(i, thresholds));
  ranked.sort((a, b) => {
    const lvl = RAG_BAND_LEVEL[a.band] - RAG_BAND_LEVEL[b.band]; // red(1) < amber(2) < green(3) ⇒ worst first
    if (lvl !== 0) return lvl;
    const sa = a.score ?? 0, sb = b.score ?? 0;
    if (sa !== sb) return sb - sa; // higher composite severity first within a band
    return byId(a.id, b.id);
  });
  const counts: Record<CanonicalRag, number> = { red: 0, amber: 0, green: 0 };
  for (const r of ranked) counts[r.band]++;
  return { ranked, counts };
}
