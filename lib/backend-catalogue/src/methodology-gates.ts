/**
 * PER-METHODOLOGY MANDATORY-GATE POLICY — a pure evaluator for "does this project clear the gates its
 * methodology REQUIRES?" (roadmap §4.8, "Policy-as-config guardrails — the per-methodology mandatory-gate
 * extension remains"). The `stage-gate` engine decides ONE gate's pass/fail from its criteria + approvals;
 * this is the layer above it — given a methodology's declared required gates (e.g. PRINCE2 mandates its
 * management-stage gates g0…g5 are cleared) and the project's ACTUAL gate records, it reports which mandatory
 * gates are unmet or missing, and whether the project is clear to proceed.
 *
 * REUSES `evaluateGate` rather than re-deciding a gate: when a required gate carries criteria, the effective
 * decision is (re)computed through the same engine (and the same `matches`/`ConditionSet` predicate the
 * automation + ruleset governance already speak); otherwise the project's recorded `gateStatus` is read
 * directly. The decision vocabulary IS `GateDecision` (pending/passed/failed/waived — the `stage_gate` field
 * enum), so nothing is re-listed here. The shipped default policy is a plain declarative constant (like
 * `task-workload`'s default aging bands), caller-overridable so a scope/methodology asset can supply its own.
 *
 * Pure, no I/O. DETERMINISTIC: gates are reported in policy order, blockers in a fixed order (no Math.random,
 * no Date). Validation-first and fail-closed: ids coerced, a missing actual gate is a blocker (never silently
 * satisfied), an unknown/dirty recorded status counts as NOT cleared, malformed criteria degrade to
 * "matches all" inside `matches` — it never throws. A methodology with no declared required gates mandates
 * nothing ⇒ vacuously satisfied. Empty ⇒ empty.
 */
import { evaluateGate, type GateDecision, type GateCriterion, type GateApproval } from "./stage-gate";
import type { Context } from "./predicate";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The gate decisions that count as CLEARING a required gate by default (passed or explicitly waived). */
const DEFAULT_CLEARED_BY: readonly GateDecision[] = ["passed", "waived"];
const VALID_DECISIONS: readonly GateDecision[] = ["pending", "passed", "failed", "waived"];

/** One gate a methodology requires be cleared. */
export interface RequiredGate {
  /** The gate id/type this maps to on the project's records (e.g. "g0"…"g5"). */
  id: string;
  label?: string;
  /** Which decisions clear this gate. Default ["passed", "waived"]. */
  clearedBy?: GateDecision[];
  /** Optional gate criteria — when present the effective decision is recomputed via `evaluateGate`. */
  criteria?: GateCriterion[];
}

/** A methodology's required-gate policy. */
export interface MethodologyGatePolicy {
  methodology: string;
  gates: RequiredGate[];
}

/** One project gate record (mirrors the `stage_gate` entity plus the optional inputs `evaluateGate` reads). */
export interface ProjectGate {
  /** Matches a {@link RequiredGate.id}. */
  id: string;
  /** The recorded decision (pending/passed/failed/waived); read when the required gate has no criteria. */
  status?: string | null;
  /** Measured context the criteria are evaluated against (only used when the required gate has criteria). */
  context?: Context;
  approvals?: GateApproval[];
  requiredApprovals?: number;
  /** An explicit governance waiver on the record. */
  waived?: boolean;
}

export interface GatePolicyResult {
  id: string;
  label?: string;
  /** The effective decision, or null when the project has no matching gate record. */
  decision: GateDecision | null;
  /** True when the gate is present and its decision clears it. */
  met: boolean;
  /** Why the gate blocks (empty when met): "missing" or "status:<decision>". */
  reason?: string;
}

export interface MethodologyGateEvaluation {
  methodology: string;
  /** True when every required gate is met (vacuously true when the policy mandates no gates). */
  satisfied: boolean;
  /** Per-required-gate result, in policy order. */
  gates: GatePolicyResult[];
  /** The blocking gates, worst-first (missing before merely-unmet), id-tiebroken. */
  blocking: { gate: string; reason: string }[];
  summary: { required: number; met: number; blocking: number; missing: number };
}

/** The shipped default per-methodology required gates. PRINCE2 is the canonically gated methodology; other
 *  methodologies mandate no gates by default (⇒ vacuously satisfied) until a scope supplies a policy. */
export const DEFAULT_METHODOLOGY_GATES: Readonly<Record<string, MethodologyGatePolicy>> = {
  prince2: {
    methodology: "prince2",
    gates: [
      { id: "g0", label: "Project mandate / start-up" },
      { id: "g1", label: "Initiation" },
      { id: "g2", label: "Stage boundary 2" },
      { id: "g3", label: "Stage boundary 3" },
      { id: "g4", label: "Stage boundary 4" },
      { id: "g5", label: "Project closure" },
    ],
  },
};

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Resolve the required-gate policy for a methodology — a caller override wins, else the shipped default, else
 * an empty policy (the methodology mandates no gates). Never throws.
 */
export function resolveMethodologyGatePolicy(
  methodology: string | null | undefined,
  overrides?: Record<string, MethodologyGatePolicy>,
): MethodologyGatePolicy {
  const id = typeof methodology === "string" ? methodology.trim() : "";
  const fromOverride = overrides && Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : undefined;
  const policy = fromOverride ?? DEFAULT_METHODOLOGY_GATES[id];
  return policy && Array.isArray(policy.gates) ? { methodology: id, gates: policy.gates } : { methodology: id, gates: [] };
}

/** The effective decision for a required gate given the project's matching record (null when absent). */
function decisionFor(required: RequiredGate, actual: ProjectGate | undefined): GateDecision | null {
  if (!actual) return null;
  if (Array.isArray(required.criteria)) {
    return evaluateGate({
      criteria: required.criteria,
      ...(actual.context !== undefined ? { context: actual.context } : {}),
      ...(actual.approvals !== undefined ? { approvals: actual.approvals } : {}),
      ...(actual.requiredApprovals !== undefined ? { requiredApprovals: actual.requiredApprovals } : {}),
      waived: actual.waived === true,
    }).decision;
  }
  if (actual.waived === true) return "waived";
  return typeof actual.status === "string" && (VALID_DECISIONS as readonly string[]).includes(actual.status) ? (actual.status as GateDecision) : "pending";
}

/**
 * Evaluate a project's gates against a methodology's required-gate policy. `projectGates` is the project's
 * actual `stage_gate` records; `policy` is the resolved required set. Deterministic, fail-closed, empty ⇒
 * empty (no required gates ⇒ satisfied).
 */
export function evaluateMethodologyGates(
  projectGates: readonly ProjectGate[],
  policy: MethodologyGatePolicy,
): MethodologyGateEvaluation {
  const byGateId = new Map<string, ProjectGate>();
  if (Array.isArray(projectGates)) {
    for (const g of projectGates) {
      if (g === null || typeof g !== "object") continue;
      const id = coerceId((g as ProjectGate).id);
      if (id !== null && !byGateId.has(id)) byGateId.set(id, g as ProjectGate);
    }
  }

  const required = Array.isArray(policy?.gates) ? policy.gates : [];
  const gates: GatePolicyResult[] = [];
  let met = 0;
  let missing = 0;

  for (const req of required) {
    const id = coerceId(req?.id);
    if (id === null) continue;
    const clearedBy = Array.isArray(req.clearedBy) && req.clearedBy.length ? req.clearedBy : DEFAULT_CLEARED_BY;
    const decision = decisionFor(req, byGateId.get(id));
    const isMet = decision !== null && (clearedBy as readonly string[]).includes(decision);
    const result: GatePolicyResult = { id, decision, met: isMet };
    if (req.label !== undefined) result.label = req.label;
    if (!isMet) result.reason = decision === null ? "missing" : `status:${decision}`;
    if (decision === null) missing++;
    if (isMet) met++;
    gates.push(result);
  }

  // Blockers worst-first: missing gates before merely-unmet ones, id-tiebroken.
  const blocking = gates
    .filter((g) => !g.met)
    .map((g) => ({ gate: g.id, reason: g.reason ?? "unmet" }))
    .sort((a, b) => {
      const am = a.reason === "missing" ? 0 : 1;
      const bm = b.reason === "missing" ? 0 : 1;
      return am !== bm ? am - bm : byId(a.gate, b.gate);
    });

  return {
    methodology: policy?.methodology ?? "",
    satisfied: blocking.length === 0,
    gates,
    blocking,
    summary: { required: gates.length, met, blocking: blocking.length, missing },
  };
}
