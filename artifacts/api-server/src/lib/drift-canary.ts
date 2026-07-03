import type { ActorContext, Broker, VerifyReport } from "../broker/types";
import { mintAutonomousContext } from "./autonomous";
import { getNotifyBus } from "./notify-bus";
import { recordAudit } from "./audit";
import { logger } from "./logger";
import { reconcileFields, type EnumeratedField, type FieldReconciliation } from "./field-registry";

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
 * broker/n8n/index.ts) and, where a broker implements the OPTIONAL `describeFields()`
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
  const ctx: ActorContext = mintAutonomousContext(
    { id: "drift-canary", role: "viewer", reason: "scheduled third-party API drift check" },
    opts.now,
  );
  const getSnapshot = opts.getSnapshot ?? (() => lastSnapshot);
  const saveSnapshot = opts.saveSnapshot ?? ((s: CanarySnapshot) => { lastSnapshot = s; });

  const snapshot = await takeSnapshot(opts.broker, ctx, opts.now);
  const prev = getSnapshot();
  const findings = diffSnapshots(prev, snapshot);
  saveSnapshot(snapshot);

  for (const f of findings) {
    ring.push(f);
    if (ring.length > RING_MAX) ring.shift();
  }

  const alertWorthy = findings.filter((f) => f.kind !== "action_recovered");
  const dispatched = alertWorthy.length > 0;
  if (dispatched) {
    const at = new Date(opts.now).toISOString();
    const title = `⚠ ${alertWorthy.length} third-party API change${alertWorthy.length === 1 ? "" : "s"} detected`;
    const body = alertWorthy.map((f) => `• ${f.detail}`).join("\n");
    const publish = opts.publish ?? ((n) =>
      getNotifyBus().publish({
        notification: { kind: n.kind, title: n.title, body: n.body, id: `drift-canary-${opts.now}`, read: false, timestamp: at } as never,
        target: { role: "admin" },
      }));
    await publish({ kind: "integration_drift", title, body });
  }

  recordAudit({
    ts: new Date(opts.now).toISOString(), category: "autonomous", action: "drift-canary.run",
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: { findings: findings.length, alertWorthy: alertWorthy.length },
  });

  return { findings, snapshot, dispatched };
}

// Default cadence: every 6 hours — frequent enough to catch a breaking vendor change
// within the same business day, cheap enough to run unattended (the underlying probe is
// the same bounded, read-only set the setup wizard already uses). ON by default; an
// operator opts OUT by setting DRIFT_CANARY_INTERVAL_HOURS=0, mirroring proactive-digest.
const DEFAULT_INTERVAL_HOURS = 6;

/** The configured cadence in hours: the env override when a valid non-negative number,
 *  else the 6-hour default. 0 = disabled (opt-out). */
export function driftCanaryIntervalHours(): number {
  const raw = process.env["DRIFT_CANARY_INTERVAL_HOURS"]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return DEFAULT_INTERVAL_HOURS;
  return hours;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the in-process canary timer (single-instance / homelab). ON by the 6-hour
 * default; `DRIFT_CANARY_INTERVAL_HOURS=0` turns it OFF. Errors in a run are logged,
 * never fatal. For a fleet, set the interval to 0 and drive it from an external
 * scheduler hitting the trigger endpoint, so it fires once rather than once per replica.
 */
export function startDriftCanaryScheduler(run: () => Promise<unknown>): boolean {
  const hours = driftCanaryIntervalHours();
  if (hours <= 0) return false;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void run().catch((err) => logger.warn({ err }, "drift-canary run failed")); }, hours * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive for the timer
  logger.info({ everyHours: hours }, "drift-canary: scheduled in-process (opt-out; set DRIFT_CANARY_INTERVAL_HOURS=0 to disable, or use the trigger endpoint + external cron for a fleet)");
  return true;
}

/** Test-only: stop the timer. */
export function __stopDriftCanaryScheduler(): void { if (timer) { clearInterval(timer); timer = null; } }
