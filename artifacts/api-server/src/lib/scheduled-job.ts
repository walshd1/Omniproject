import type { ActorContext } from "../broker/types";
import { mintAutonomousContext } from "./autonomous";
import { getNotifyBus } from "./notify-bus";
import { recordAudit } from "./audit";
import { logger } from "./logger";
import type { Role } from "./rbac";

/**
 * Shared skeleton behind every scheduled autonomous job (proactive-digest, drift-canary, …):
 * mint the keyed, short-lived, viewer-roled autonomous principal → gather/decide (caller-
 * supplied) → publish over the notify bus IF the job decided there's something worth telling
 * someone → record an audit event. Read-only by construction (every job here mints a `viewer`
 * principal); write jobs are out of scope for this skeleton.
 */

export interface AutonomousJobPublish {
  kind: string;
  title: string;
  body: string;
  target?: { role?: Role };
}

export interface AutonomousJobOutcome<T> {
  /** The job's own result payload (a digest, a canary result, …) — merged with `dispatched`. */
  data: T;
  /** Present when the job decided there's something worth telling someone; absent ⇒ nothing dispatched. */
  dispatch?: AutonomousJobPublish | null;
  /** The audit record's `meta`, given the computed `dispatched` flag (some jobs fold it in, some don't). */
  auditMeta: (dispatched: boolean) => Record<string, unknown>;
}

export interface RunScheduledAutonomousJobOptions<T> {
  /** The autonomous principal id (e.g. "proactive-digest") and the audit action's ts/actor. */
  id: string;
  reason: string;
  now: number;
  auditAction: string;
  /** Prefix for the notify-bus notification id: `${idPrefix}-${now}`. */
  idPrefix: string;
  /** Gather + decide. Given the minted read-only context; returns the result + whether to publish. */
  run: (ctx: ActorContext) => Promise<AutonomousJobOutcome<T>>;
  /** Deliver the notification (defaults to the notify bus); injectable for tests. */
  publish?: (n: AutonomousJobPublish) => Promise<unknown> | unknown;
}

/** Run one scheduled autonomous job and return its result plus whether it dispatched a notification. */
export async function runScheduledAutonomousJob<T>(opts: RunScheduledAutonomousJobOptions<T>): Promise<T & { dispatched: boolean }> {
  const ctx: ActorContext = mintAutonomousContext({ id: opts.id, role: "viewer", reason: opts.reason }, opts.now);
  const outcome = await opts.run(ctx);
  const at = new Date(opts.now).toISOString();
  const dispatched = !!outcome.dispatch;

  if (outcome.dispatch) {
    const n = outcome.dispatch;
    const publish = opts.publish ?? ((p) =>
      getNotifyBus().publish({
        notification: { kind: p.kind, title: p.title, body: p.body, id: `${opts.idPrefix}-${opts.now}`, read: false, timestamp: at } as never,
        target: { role: p.target?.role },
      }));
    await publish(n);
  }

  recordAudit({
    ts: at, category: "autonomous", action: opts.auditAction,
    actor: { sub: ctx.sub, role: ctx.role }, write: false, result: "success",
    meta: outcome.auditMeta(dispatched),
  });

  return { ...outcome.data, dispatched };
}

export interface IntervalScheduler {
  /** The configured cadence in hours (env override, else the default; 0 = disabled). */
  intervalHours(): number;
  /** Start the timer; false (no-op) when the configured interval is 0 (opt-out). */
  start(run: () => Promise<unknown>): boolean;
  /** Stop the timer (idempotent). */
  stop(): void;
}

/**
 * The shared "env-var hours → setInterval → unref → stoppable timer" bootstrap behind every
 * scheduled job's in-process cadence: an env-var override in hours (0 = opt out), a
 * self-unref'd interval so it never keeps the process alive, and a run's errors logged (never
 * fatal, never lost).
 */
export function createIntervalScheduler(envVar: string, defaultHours: number, label: string): IntervalScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;

  function intervalHours(): number {
    const raw = process.env[envVar]?.trim();
    if (raw === undefined || raw === "") return defaultHours;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours < 0) return defaultHours;
    return hours;
  }

  function start(run: () => Promise<unknown>): boolean {
    const hours = intervalHours();
    if (hours <= 0) return false;
    if (timer) clearInterval(timer);
    timer = setInterval(() => { void run().catch((err) => logger.warn({ err }, `${label} run failed`)); }, hours * 60 * 60 * 1000);
    if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive for the timer
    logger.info({ everyHours: hours }, `${label}: scheduled in-process (opt-out; set ${envVar}=0 to disable, or use the trigger endpoint + external cron for a fleet)`);
    return true;
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { intervalHours, start, stop };
}
