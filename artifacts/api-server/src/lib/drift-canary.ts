import type { ActorContext, Broker, VerifyReport } from "../broker/types";
import { logger } from "./logger";
import { reconcileFields, type EnumeratedField, type FieldReconciliation } from "./field-registry";
import { runScheduledAutonomousJob, createIntervalScheduler } from "./scheduled-job";

/**
 * Third-party API drift canary.
 *
 * OmniProject never calls a vendor's API directly — the broker's HTTP contract is the
 * only egress path, and for the real (n8n) adapter the actual Jira/Asana/Salesforce/etc.
 * call happens inside a customer-owned n8n workflow, opaque to this gateway. So "did a
 * vendor API change" is only OBSERVABLE here as a TRANSITION: a read-only broker action
 * that used to succeed starts failing, or a field the backend used to enumerate stops
 * being enumerated. That's exactly what this watches for — not raw failures (a broker
 * that's simply unreachable is already surfaced by /api/readyz and the setup verify
 * probe), but a REGRESSION between two runs, so an operator learns about a breaking
 * vendor change from an alert instead of from a support ticket.
 *
 * Reuses read-only surface the gateway already calls elsewhere — `Broker.verify()` (the
 * same bounded, egress-guarded, timeout-capped probe the setup wizard uses,
 * broker/reference-broker/index.ts) and, where a broker implements the OPTIONAL `describeFields()`
 * enumeration, the canonical field reconciliation (lib/field-registry.ts). Zero new
 * egress surface — only a before/after diff over calls that already happen.
 *
 * State (the last snapshot) is IN-PROCESS ONLY, not durably persisted — the same
 * tradeoff made for lib/impossible-travel.ts: losing the baseline on restart just means
 * the next run re-baselines silently instead of comparing, the safe/conservative failure
 * mode for an advisory (non-security) signal, not a hole.
 */

export interface ActionSnapshot {
  ok: boolean;
  status: number;
  note: string | null;
}

export interface CanarySnapshot {
  at: number;
  actions: Record<string, ActionSnapshot>;
  /** Only present when the broker implements the optional describeFields() enumeration. */
  fields?: FieldReconciliation;
}

export type DriftKind = "action_broke" | "action_recovered" | "field_disappeared";

export interface DriftFinding {
  kind: DriftKind;
  /** The action name or field key this finding is about. */
  subject: string;
  detail: string;
}

/**
 * Diff two canary snapshots (PURE). `prev === null` means "first run" — nothing to
 * compare against yet, so no findings; that run's snapshot just becomes the baseline.
 */
export function diffSnapshots(prev: CanarySnapshot | null, next: CanarySnapshot): DriftFinding[] {
  if (!prev) return [];
  const findings: DriftFinding[] = [];

  for (const action of Object.keys(next.actions)) {
    const before = prev.actions[action];
    const after = next.actions[action];
    if (!before || !after) continue; // a new/removed action name — nothing to diff yet
    if (before.ok && !after.ok) {
      findings.push({
        kind: "action_broke",
        subject: action,
        detail: `"${action}" was passing and now fails (status ${after.status}${after.note ? `: ${after.note}` : ""}) — the vendor API behind it may have changed.`,
      });
    } else if (!before.ok && after.ok) {
      findings.push({ kind: "action_recovered", subject: action, detail: `"${action}" is passing again (was failing).` });
    }
  }

  if (prev.fields && next.fields) {
    // Only a field that WAS enumerated and has now stopped being enumerated is drift — a
    // newly "unknown" field is just new custom data (not breakage), so it isn't flagged.
    const beforeKnown = new Set(prev.fields.known);
    for (const key of next.fields.missing) {
      if (beforeKnown.has(key)) {
        findings.push({
          kind: "field_disappeared",
          subject: key,
          detail: `Field "${key}" was previously reported by the backend and is no longer enumerated — a vendor API change may have removed or renamed it.`,
        });
      }
    }
  }

  return findings;
}

let lastSnapshot: CanarySnapshot | null = null;

// RAM-only ring of recent findings (zero-at-rest; lost on restart), mirrors health-watch.
const RING_MAX = 200;
const ring: DriftFinding[] = [];

/** The most recent drift findings (newest last). */
export function recentDriftFindings(): DriftFinding[] {
  return [...ring];
}

/** Test-only: clear the baseline snapshot + findings ring. */
export function __resetDriftCanaryState(): void {
  lastSnapshot = null;
  ring.length = 0;
}

/** Take one snapshot: the read-only verify probe and, if the broker exposes it,
 *  describeFields — never mutates, same bound/timeout/egress-guard as verify() itself. */
async function takeSnapshot(broker: Broker, ctx: ActorContext, now: number): Promise<CanarySnapshot> {
  const report: VerifyReport = await broker.verify(ctx);
  const actions: Record<string, ActionSnapshot> = {};
  for (const a of report.actions) actions[a.name] = { ok: a.ok, status: a.status, note: a.note ?? null };

  let fields: FieldReconciliation | undefined;
  if (broker.describeFields) {
    try {
      const enumerated: EnumeratedField[] = await broker.describeFields(ctx);
      fields = reconcileFields(enumerated);
    } catch (err) {
      logger.warn({ err }, "drift-canary: describeFields probe failed — skipping the field-drift arm this run");
    }
  }

  return { at: now, actions, ...(fields ? { fields } : {}) };
}

export interface RunDriftCanaryOptions {
  broker: Broker;
  now: number;
  /** Deliver an alert (defaults to the notify bus, targeted at admins); injectable for tests. */
  publish?: (n: { kind: string; title: string; body: string }) => Promise<unknown> | unknown;
  /** Snapshot storage, injectable for tests (defaults to the in-process module state). */
  getSnapshot?: () => CanarySnapshot | null;
  saveSnapshot?: (s: CanarySnapshot) => void;
}

export interface RunDriftCanaryResult {
  findings: DriftFinding[];
  snapshot: CanarySnapshot;
  /** Whether an alert was actually dispatched (a quiet or recovery-only run isn't). */
  dispatched: boolean;
}

/**
 * Run the canary: snapshot the broker's read-only surface, diff against the last
 * snapshot, and dispatch a notification (kind "integration_drift", targeted at admins)
 * when something broke or a field disappeared. A quiet run — nothing changed, or only a
 * recovery — dispatches nothing, so "on by default" never means "noise by default".
 * Read-only; audited like the other scheduled autonomous jobs.
 */
export async function runDriftCanary(opts: RunDriftCanaryOptions): Promise<RunDriftCanaryResult> {
  const getSnapshot = opts.getSnapshot ?? (() => lastSnapshot);
  const saveSnapshot = opts.saveSnapshot ?? ((s: CanarySnapshot) => { lastSnapshot = s; });

  const result = await runScheduledAutonomousJob({
    id: "drift-canary",
    reason: "scheduled third-party API drift check",
    now: opts.now,
    auditAction: "drift-canary.run",
    idPrefix: "drift-canary",
    ...(opts.publish ? { publish: (n: { kind: string; title: string; body: string }) => opts.publish!(n) } : {}),
    run: async (ctx: ActorContext) => {
      const snapshot = await takeSnapshot(opts.broker, ctx, opts.now);
      const prev = getSnapshot();
      const findings = diffSnapshots(prev, snapshot);
      saveSnapshot(snapshot);

      for (const f of findings) {
        ring.push(f);
        if (ring.length > RING_MAX) ring.shift();
      }

      const alertWorthy = findings.filter((f) => f.kind !== "action_recovered");
      const dispatch = alertWorthy.length > 0
        ? {
            kind: "integration_drift",
            title: `⚠ ${alertWorthy.length} third-party API change${alertWorthy.length === 1 ? "" : "s"} detected`,
            body: alertWorthy.map((f) => `• ${f.detail}`).join("\n"),
            target: { role: "admin" as const },
          }
        : null;

      return {
        data: { findings, snapshot },
        dispatch,
        auditMeta: () => ({ findings: findings.length, alertWorthy: alertWorthy.length }),
      };
    },
  });

  return result;
}

// Default cadence: every 6 hours — frequent enough to catch a breaking vendor change
// within the same business day, cheap enough to run unattended (the underlying probe is
// the same bounded, read-only set the setup wizard already uses). ON by default; an
// operator opts OUT by setting DRIFT_CANARY_INTERVAL_HOURS=0, mirroring proactive-digest.
const DEFAULT_INTERVAL_HOURS = 6;

const scheduler = createIntervalScheduler("DRIFT_CANARY_INTERVAL_HOURS", DEFAULT_INTERVAL_HOURS, "drift-canary");

/** The configured cadence in hours: the env override when a valid non-negative number,
 *  else the 6-hour default. 0 = disabled (opt-out). */
export function driftCanaryIntervalHours(): number {
  return scheduler.intervalHours();
}

/**
 * Start the in-process canary timer (single-instance / homelab). ON by the 6-hour
 * default; `DRIFT_CANARY_INTERVAL_HOURS=0` turns it OFF. Errors in a run are logged,
 * never fatal. For a fleet, set the interval to 0 and drive it from an external
 * scheduler hitting the trigger endpoint, so it fires once rather than once per replica.
 */
export function startDriftCanaryScheduler(run: () => Promise<unknown>): boolean {
  return scheduler.start(run);
}

/** Test-only: stop the timer. */
export function __stopDriftCanaryScheduler(): void { scheduler.stop(); }
