/**
 * OKR ↔ DELIVERY LINKAGE — roll a set of objectives up from BOTH their key results and the delivery items
 * (epics/initiatives) wired to them (roadmap §4.5, "OKR ↔ delivery linkage — Goals exist; wire objectives to
 * brokered epics/initiatives + auto-roll-up progress"). The Goals/OKR cadence already models objectives + key
 * results (Phase 3.2); this engine is the pure roll-up that turns a key result's start/target/current into a
 * progress fraction, averages them into an objective's OKR progress, averages the linked delivery items into a
 * delivery progress, and surfaces the two side by side so a divergence (KRs say 80%, delivery says 30%) is
 * visible rather than hidden behind one blended number.
 *
 * Reuses the Goals key-result vocabulary ({@link KeyResultKind} / {@link isBinaryKeyResultKind}) — a milestone
 * key result is binary (met or not), every other kind is a linear start→target ramp. Delivery items are plain
 * {id, progress 0…1, weight} links, so the engine stays vendor-neutral above the broker seam.
 *
 * Pure, no I/O. Deterministic (objectives + key results in input order, portfolio counts fixed; no Math.random).
 * Validation first: every value coerced via numLoose, progress clamped to [0,1], weight to ≥ 0. Every divide is
 * guarded — a key result with an empty target range (target === start) and an objective with no weighted inputs
 * both yield `null`, never NaN/±Infinity.
 */
import { numLoose, clamp } from "./num";
import { type KeyResultKind, isBinaryKeyResultKind } from "./goal-catalogue";

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export interface KeyResult {
  id: string;
  kind: KeyResultKind;
  /** Baseline value progress ramps from; default 0. */
  start?: number;
  /** Target value that counts as 100%. */
  target: number;
  /** Current measured value. */
  current: number;
  /** Weight in the objective's OKR progress; coerced to ≥ 0, default 1. */
  weight?: number;
}

export interface DeliveryLink {
  id: string;
  /** Completion of the linked delivery item, 0…1. Coerced + clamped. */
  progress: number;
  /** Weight in the objective's delivery progress; coerced to ≥ 0, default 1. */
  weight?: number;
}

export interface Objective {
  id: string;
  keyResults?: KeyResult[];
  deliveryItems?: DeliveryLink[];
}

export interface LinkageThresholds {
  /** Progress ≥ onTrackMin ⇒ on-track. Default 0.7. */
  onTrackMin?: number;
  /** Progress ≥ atRiskMin (and < onTrackMin) ⇒ at-risk; below ⇒ off-track. Default 0.4. */
  atRiskMin?: number;
}

export type ObjectiveStatus = "on-track" | "at-risk" | "off-track" | "unknown";

export interface KeyResultProgress {
  id: string;
  /** 0…1, or `null` when the target range is empty (target === start). */
  progress: number | null;
}

export interface ObjectiveProgress {
  id: string;
  /** Weighted mean of the key results' progress; `null` when none carry weight/measurable progress. */
  keyResultProgress: number | null;
  /** Weighted mean of the linked delivery items' progress; `null` when none carry weight. */
  deliveryProgress: number | null;
  /** Headline progress: OKR progress when key results exist, else delivery progress. */
  progress: number | null;
  /** How far delivery lags (−) or leads (+) the OKR progress; `null` when either side is null. */
  deliveryGap: number | null;
  linkedItems: number;
  keyResults: KeyResultProgress[];
  status: ObjectiveStatus;
}

/** Progress of one key result: binary for milestones, a clamped start→target ramp otherwise (guarded divide). */
export function keyResultProgress(kr: KeyResult): number | null {
  const target = numLoose(kr.target);
  const current = numLoose(kr.current);
  if (isBinaryKeyResultKind(kr.kind)) return current >= target ? 1 : 0;
  const start = numLoose(kr.start);
  const range = target - start;
  if (range === 0) return null; // empty target range ⇒ progress undefined, never a divide-by-zero
  return round4(clamp((current - start) / range, 0, 1));
}

/** Weighted mean of {value, weight} pairs, ignoring null values; `null` when no positive weight remains. */
function weightedMean(pairs: Array<{ value: number | null; weight: number }>): number | null {
  let sum = 0, totalWeight = 0;
  for (const p of pairs) {
    if (p.value === null || p.weight <= 0) continue;
    sum += p.value * p.weight;
    totalWeight += p.weight;
  }
  return totalWeight > 0 ? round4(sum / totalWeight) : null;
}

function classify(progress: number | null, thresholds: LinkageThresholds): ObjectiveStatus {
  if (progress === null) return "unknown";
  const onTrackMin = clamp(numLoose(thresholds.onTrackMin ?? 0.7), 0, 1);
  const atRiskMin = clamp(numLoose(thresholds.atRiskMin ?? 0.4), 0, 1);
  if (progress >= onTrackMin) return "on-track";
  if (progress >= Math.min(onTrackMin, atRiskMin)) return "at-risk";
  return "off-track";
}

/** Roll one objective up from its key results + linked delivery items. */
export function rollUpObjective(objective: Objective, thresholds: LinkageThresholds = {}): ObjectiveProgress {
  const krList = objective.keyResults ?? [];
  const keyResults: KeyResultProgress[] = krList.map((kr) => ({ id: String(kr.id), progress: keyResultProgress(kr) }));
  const keyResultProg = weightedMean(krList.map((kr, i) => ({
    value: keyResults[i]!.progress,
    weight: Math.max(0, numLoose(kr.weight ?? 1)),
  })));

  const links = objective.deliveryItems ?? [];
  const deliveryProg = weightedMean(links.map((d) => ({
    value: round4(clamp(numLoose(d.progress), 0, 1)),
    weight: Math.max(0, numLoose(d.weight ?? 1)),
  })));

  const progress = keyResultProg !== null ? keyResultProg : deliveryProg;
  const deliveryGap = keyResultProg !== null && deliveryProg !== null ? round4(deliveryProg - keyResultProg) : null;

  return {
    id: String(objective.id),
    keyResultProgress: keyResultProg,
    deliveryProgress: deliveryProg,
    progress,
    deliveryGap,
    linkedItems: links.length,
    keyResults,
    status: classify(progress, thresholds),
  };
}

export interface OkrPortfolioResult {
  objectives: ObjectiveProgress[];
  /** Mean headline progress across objectives with a measurable value; `null` when none. */
  meanProgress: number | null;
  /** Count of objectives in each status. */
  counts: Record<ObjectiveStatus, number>;
}

/** Roll up a set of objectives, preserving order, with a portfolio mean + status counts. Empty ⇒ null mean. */
export function rollUpObjectives(objectives: readonly Objective[], thresholds: LinkageThresholds = {}): OkrPortfolioResult {
  const rolled = objectives.map((o) => rollUpObjective(o, thresholds));
  const measured = rolled.map((o) => o.progress).filter((p): p is number => p !== null);
  const meanProgress = measured.length > 0 ? round4(measured.reduce((s, v) => s + v, 0) / measured.length) : null;
  const counts: Record<ObjectiveStatus, number> = { "on-track": 0, "at-risk": 0, "off-track": 0, unknown: 0 };
  for (const o of rolled) counts[o.status]++;
  return { objectives: rolled, meanProgress, counts };
}
