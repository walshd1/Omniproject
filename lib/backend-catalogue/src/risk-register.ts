/**
 * RISK REGISTER / EXPOSURE-HEATMAP ENGINE — a pure, STATELESS analyser for a project's RAID register
 * (roadmap §4.8, "Risk + issue register with scoring/heatmaps"). RAID entries are a first-class brokered
 * record (`RaidEntry`: type risk/assumption/issue/dependency, a declared severity, an optional
 * likelihood + impact, a status, an owner, a mitigation due date), and `summariseRaid` already gives a
 * COUNT roll-up above the seam — but nothing scores the register by **exposure** or lays it out as a
 * likelihood×impact **heatmap grid**. This does: per-entry exposure = its LIKELIHOOD ordinal × its IMPACT
 * ordinal (the classic P×I), banded onto the canonical severity scale, plus a filled heatmap, an
 * exposure-weighted roll-up (by type / status / severity band, open vs closed, overdue mitigations), and a
 * worst-first top-risk ranking.
 *
 * REUSES the shipped graded vocabularies rather than re-deriving bands: `LIKELIHOOD_LEVEL` / `IMPACT_LEVEL`
 * / `SEVERITY_LEVEL` (the same ordinals the sibling above-seam `artifacts/api-server/src/lib/risk-exposure.ts`
 * P×I resolver keys off — this is its below-seam register counterpart, working over the shipped canonical
 * grades, so no anchor-snapping is needed and the two never contradict), and the `num` guarded-coercion
 * helpers. Mirrors `health-score` / `task-workload` — input records → pure scorer → sorted roll-up, a local
 * `byId` string tiebreak, divide-guarded. DETERMINISTIC: it never calls `Date`; `now` and the mitigation
 * due dates are epoch-ms numbers passed in, and every ranking is id-tiebroken. Validation-first and
 * fail-closed: ids coerced, non-object entries dropped, unknown/dirty grades yield a null (uncomputable)
 * exposure rather than a NaN, dirty due dates handled — it never throws. Empty ⇒ empty.
 */
import { numLoose, optNum, round2 } from "./num";
import { SEVERITY_LEVEL, CANONICAL_SEVERITY, type CanonicalSeverity } from "./severity-vocabulary";
import { IMPACT_LEVEL, CANONICAL_IMPACT, type CanonicalImpact } from "./impact-vocabulary";
import { LIKELIHOOD_LEVEL, CANONICAL_LIKELIHOOD, type CanonicalLikelihood } from "./likelihood-vocabulary";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The RAID entry statuses that count as CLOSED (no longer live risk). Matches the `RaidEntryStatus` enum. */
const CLOSED_STATUS = "closed";
/** The RAID entry types we bucket by (anything else falls in "other"). Matches the `RaidEntryType` enum. */
const KNOWN_TYPES = ["risk", "assumption", "issue", "dependency"] as const;
/** The RAID entry statuses we bucket by (anything else falls in "other"). */
const KNOWN_STATUSES = ["open", "mitigating", "closed"] as const;

/** A RAID/register entry. Only `id` is required; every other field is read defensively. */
export interface RegisterEntry {
  id: string;
  /** risk | assumption | issue | dependency (else bucketed as "other"). */
  type?: string | null;
  /** open | mitigating | closed (a closed entry is not live risk). */
  status?: string | null;
  /** The declared severity band (low|medium|high|critical) — the fallback when likelihood/impact are absent. */
  severity?: string | null;
  /** Likelihood grade (low|medium|high); combined with impact for the P×I exposure. */
  likelihood?: string | null;
  /** Impact grade (low|medium|high); combined with likelihood for the P×I exposure. */
  impact?: string | null;
  /** Who owns the mitigation (informational). */
  owner?: string | null;
  /** Mitigation due date (epoch ms); past + still-open ⇒ an overdue mitigation. */
  dueDate?: number | null;
}

export interface RiskRegisterOptions {
  /** Current time as epoch ms — REQUIRED for overdue-mitigation detection (the engine never calls Date). */
  now: number;
  /** How many top risks to return, worst-first (≤ 0 ⇒ all). Default 10. */
  topN?: number;
  /** Exposure-band cutoffs: exposure ≤ lowMax ⇒ low, ≤ mediumMax ⇒ medium, ≤ highMax ⇒ high, else critical.
   *  Default { lowMax: 2, mediumMax: 4, highMax: 6 } — the standard 3×3 P×I matrix banding. */
  exposureThresholds?: { lowMax?: number; mediumMax?: number; highMax?: number };
}

export interface ScoredRisk {
  id: string;
  type: string;
  status: string;
  /** P×I exposure (likelihood ordinal × impact ordinal), or null when either grade is absent/unknown. */
  exposure: number | null;
  /** The severity band — computed from exposure when available, else the declared severity, else null. */
  band: CanonicalSeverity | null;
  /** True when the entry is open (not closed), its dueDate is in the past. */
  overdue: boolean;
}

export interface HeatmapCell {
  likelihood: CanonicalLikelihood;
  impact: CanonicalImpact;
  exposure: number;
  band: CanonicalSeverity;
  count: number;
}

export interface RiskRegisterResult {
  /** The top risks worst-first (exposure desc → declared severity desc → dueDate asc → id). */
  topRisks: ScoredRisk[];
  /** The likelihood×impact grid, worst cell first, each cell carrying its exposure, band and entry count. */
  heatmap: HeatmapCell[];
  rollup: {
    /** Entry count per RAID type (risk/assumption/issue/dependency/other). */
    byType: Record<string, number>;
    /** Entry count per status (open/mitigating/closed/other). */
    byStatus: Record<string, number>;
    /** Entry count per severity band (computed band preferred, else declared), plus "unbanded". */
    bySeverityBand: Record<string, number>;
  };
  summary: {
    total: number;
    /** Entries not in a closed status. */
    open: number;
    closed: number;
    /** Entries with a computable P×I exposure. */
    scored: number;
    /** Open entries whose mitigation due date is in the past. */
    overdueMitigations: number;
    /** The greatest exposure among scored entries (0 when none). */
    highestExposure: number;
    /** Sum of all scored exposures (guarded, 2dp). */
    totalExposure: number;
  };
}

/** The finite ordinal of a canonical grade in a level map, or null when the id isn't a shipped grade. */
function levelOf(map: Record<string, number>, id: string | null | undefined): number | null {
  if (typeof id !== "string") return null;
  return Object.prototype.hasOwnProperty.call(map, id) ? numLoose(map[id]) : null;
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Bucket a raw value against a known set, else "other". */
function bucket(v: unknown, known: readonly string[]): string {
  return typeof v === "string" && known.includes(v) ? v : "other";
}

/**
 * Analyse a RAID register: score each entry's P×I exposure, band it, fill the likelihood×impact heatmap, and
 * roll up by type / status / severity band with open/overdue counts. `now` and mitigation due dates are
 * epoch-ms numbers supplied by the caller. Deterministic (id-tiebroken), fail-closed, empty ⇒ empty.
 */
export function analyzeRiskRegister(entries: readonly RegisterEntry[], options: RiskRegisterOptions): RiskRegisterResult {
  const now = numLoose(options?.now);
  const th = options?.exposureThresholds ?? {};
  const lowMax = th.lowMax === undefined ? 2 : numLoose(th.lowMax);
  const mediumMax = th.mediumMax === undefined ? 4 : numLoose(th.mediumMax);
  const highMax = th.highMax === undefined ? 6 : numLoose(th.highMax);

  /** Band an exposure onto the canonical severity scale using the (guarded) cutoffs. */
  const bandOf = (exposure: number): CanonicalSeverity =>
    exposure <= lowMax ? "low" : exposure <= mediumMax ? "medium" : exposure <= highMax ? "high" : "critical";

  const byType: Record<string, number> = { risk: 0, assumption: 0, issue: 0, dependency: 0, other: 0 };
  const byStatus: Record<string, number> = { open: 0, mitigating: 0, closed: 0, other: 0 };
  const bySeverityBand: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0, unbanded: 0 };
  const cellCounts = new Map<string, number>(); // "likelihood|impact" → count

  const scored: ScoredRisk[] = [];
  let open = 0;
  let closed = 0;
  let scoredCount = 0;
  let overdueMitigations = 0;
  let highestExposure = 0;
  let totalExposure = 0;

  if (Array.isArray(entries)) {
    for (const raw of entries) {
      if (raw === null || typeof raw !== "object") continue;
      const e = raw as RegisterEntry;
      const id = coerceId(e.id);
      if (id === null) continue;

      const type = bucket(e.type, KNOWN_TYPES);
      const status = bucket(e.status, KNOWN_STATUSES);
      const isClosed = e.status === CLOSED_STATUS;
      byType[type] = (byType[type] ?? 0) + 1;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (isClosed) closed++;
      else open++;

      const p = levelOf(LIKELIHOOD_LEVEL as Record<string, number>, e.likelihood);
      const i = levelOf(IMPACT_LEVEL as Record<string, number>, e.impact);
      const exposure = p !== null && i !== null ? p * i : null;

      let band: CanonicalSeverity | null = null;
      if (exposure !== null) {
        band = bandOf(exposure);
        scoredCount++;
        totalExposure += exposure;
        if (exposure > highestExposure) highestExposure = exposure;
        const key = `${e.likelihood}|${e.impact}`;
        cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
      } else if (typeof e.severity === "string" && Object.prototype.hasOwnProperty.call(SEVERITY_LEVEL, e.severity)) {
        band = e.severity as CanonicalSeverity;
      }
      const bandKey = band ?? "unbanded";
      bySeverityBand[bandKey] = (bySeverityBand[bandKey] ?? 0) + 1;

      const due = optNum(e.dueDate);
      const overdue = !isClosed && due !== null && due < now;
      if (overdue) overdueMitigations++;

      scored.push({ id, type, status, exposure, band, overdue });
    }
  }

  // Heatmap: every likelihood×impact cell, worst (highest-exposure) first, id-stable within equal exposure.
  const heatmap: HeatmapCell[] = [];
  for (const likelihood of CANONICAL_LIKELIHOOD) {
    for (const impact of CANONICAL_IMPACT) {
      const exposure = LIKELIHOOD_LEVEL[likelihood] * IMPACT_LEVEL[impact];
      heatmap.push({ likelihood, impact, exposure, band: bandOf(exposure), count: cellCounts.get(`${likelihood}|${impact}`) ?? 0 });
    }
  }
  heatmap.sort((a, b) => (b.exposure !== a.exposure ? b.exposure - a.exposure : a.likelihood < b.likelihood ? -1 : a.likelihood > b.likelihood ? 1 : byId(a.impact, b.impact)));

  // Top risks: exposure desc (null last) → declared severity desc → dueDate asc → id.
  const declaredLevel = (r: ScoredRisk): number => (r.band && Object.prototype.hasOwnProperty.call(SEVERITY_LEVEL, r.band) ? SEVERITY_LEVEL[r.band as CanonicalSeverity] : 0);
  const ranked = [...scored].sort((a, b) => {
    const ea = a.exposure ?? -1;
    const eb = b.exposure ?? -1;
    if (ea !== eb) return eb - ea;
    const la = declaredLevel(a);
    const lb = declaredLevel(b);
    if (la !== lb) return lb - la;
    return byId(a.id, b.id);
  });
  const topN = options?.topN === undefined ? 10 : Math.floor(numLoose(options.topN));
  const topRisks = topN > 0 ? ranked.slice(0, topN) : ranked;

  return {
    topRisks,
    heatmap,
    rollup: { byType, byStatus, bySeverityBand },
    summary: {
      total: scored.length,
      open,
      closed,
      scored: scoredCount,
      overdueMitigations,
      highestExposure,
      totalExposure: round2(totalExposure),
    },
  };
}

/** The canonical severity bands in ascending order — re-exported for a surface that renders the register key. */
export const RISK_SEVERITY_BANDS: readonly CanonicalSeverity[] = CANONICAL_SEVERITY;
