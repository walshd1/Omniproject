import { cronMinutesInWindow, isValidCron } from "./cron-match";
import { sharedKv } from "./shared-state";
import { logger } from "./logger";

/**
 * UNIFIED JOB SCHEDULER — the one place background work is scheduled across the whole gateway.
 *
 * Every recurring unit — the internal infra jobs (exec/proactive digest, scheduled export, drift canary)
 * AND the user's schedule-triggered automation recipes — is a {@link ScheduledJob}: it declares a schedule
 * (a fixed interval OR a cron expression) and a run. ONE heartbeat tick walks the registry, computes each
 * job's occurrences due in the window since the last tick, CLAIMS each occurrence exactly once (shared-KV
 * compare-and-set), and runs it. This replaces the five hand-wired per-job interval timers.
 *
 * Two invariants, straight from the design principles (docs/DESIGN-PRINCIPLES §20/21 — "background work is
 * idempotent and fleet-safe"):
 *   1. DETERMINISTIC OCCURRENCES. Interval boundaries are anchored to the epoch (`floor(t/period)*period`),
 *      not to boot time, and cron minutes are absolute UTC — so every replica computes the SAME occurrence
 *      timestamp for the same job, which is what makes a shared claim meaningful.
 *   2. CLAIM ONCE. Each (job, occurrence) is claimed via {@link sharedKv} CAS before running, so overlapping
 *      ticks or multiple replicas fire each occurrence exactly once. Fleet-safe when REDIS_URL is set;
 *      single-instance (per-replica claim) otherwise — the same semantics as every other claim-once path.
 *
 * The in-process heartbeat is an opt-out convenience (SCHEDULER_HEARTBEAT_MINUTES, default 60; 0 disables the
 * whole scheduler). Because occurrences are claimed, running the heartbeat on every replica is SAFE — no more
 * "set the interval to 0 on all but one replica". A fleet can still drive {@link runDueScheduledJobs} from an
 * external cron and set the heartbeat to 0.
 */

export type JobSchedule =
  | { kind: "interval"; hours: number }
  | { kind: "cron"; expr: string };

export interface ScheduledJob {
  /** Stable, unique id — used in the claim key and logs. */
  id: string;
  /** Human label for logs/observability. */
  label: string;
  /** Resolve the schedule LIVE each tick (reads env/config). Return null to disable the job this tick. */
  resolveSchedule: () => JobSchedule | null;
  /** Run one due occurrence (already claimed). `occurrenceMs` is the scheduled wall-clock time in ms. */
  run: (occurrenceMs: number) => Promise<unknown>;
}

/** Yields zero or more jobs, resolved fresh each tick — for dynamic sets (e.g. the user's automation recipes). */
export type ScheduledJobProvider = () => ScheduledJob[];

/**
 * Resolve an interval cadence in hours from an env var: the override when it parses as a finite, non-negative
 * number, else the default. 0 = disabled (opt-out). The shared env-hours parse behind every interval job.
 */
export function resolveIntervalHours(envVar: string, defaultHours: number): number {
  const raw = process.env[envVar]?.trim();
  if (raw === undefined || raw === "") return defaultHours;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return defaultHours;
  return hours;
}

/**
 * The distinct occurrence timestamps (ms) at which `schedule` fires in `(sinceMs, nowMs]` (PURE, deterministic).
 *
 *  - INTERVAL: epoch-anchored boundaries at multiples of the period. Returns only the MOST RECENT boundary in
 *    the window (a periodic digest fires once when due, never N times to "catch up" after downtime). Disabled
 *    (hours <= 0) yields nothing.
 *  - CRON: the absolute UTC minutes matched in the window, bounded to `maxMinutes` back from `nowMs`.
 *
 * Every returned timestamp is the same on every replica for the same job → a shared claim on it is meaningful.
 */
export function occurrencesInWindow(schedule: JobSchedule, sinceMs: number, nowMs: number, maxMinutes = 1440): number[] {
  if (schedule.kind === "cron") {
    if (!isValidCron(schedule.expr)) return [];
    return cronMinutesInWindow(schedule.expr, sinceMs, nowMs, maxMinutes).map((d) => d.getTime());
  }
  const { hours } = schedule;
  if (!Number.isFinite(hours) || hours <= 0) return [];
  const period = hours * 60 * 60 * 1000;
  const boundary = Math.floor(nowMs / period) * period; // most recent epoch-anchored boundary at/before now
  return boundary > sinceMs ? [boundary] : [];
}

const staticJobs: ScheduledJob[] = [];
const providers: ScheduledJobProvider[] = [];

/** Register a static scheduled job (an infra job). Its schedule is resolved live each tick. */
export function registerScheduledJob(job: ScheduledJob): void {
  staticJobs.push(job);
}

/** Register a provider of dynamic jobs (e.g. the automation recipes), re-resolved fresh each tick. */
export function registerScheduledJobProvider(provider: ScheduledJobProvider): void {
  providers.push(provider);
}

/** All jobs live this tick — static registrations plus every provider's current yield. */
function gatherJobs(): ScheduledJob[] {
  const dynamic = providers.flatMap((p) => {
    try { return p(); } catch (err) { logger.warn({ err }, "job-scheduler: a job provider threw; skipped"); return []; }
  });
  return [...staticJobs, ...dynamic];
}

/** Test-only: drop all registrations. */
export function __clearScheduledJobRegistry(): void {
  staticJobs.length = 0;
  providers.length = 0;
}

/** A claimed occurrence stays claimed well past any realistic tick/scan window, so a slow/overlapping tick
 *  (or a cron re-scan up to maxMinutes back) can't re-fire it. */
const CLAIM_TTL_MS = 36 * 60 * 60 * 1000;

export interface ScheduleTickSummary {
  /** Each (job, occurrence) that won its claim and ran. */
  fired: { jobId: string; occurrence: string }[];
  /** Occurrences skipped because another tick/replica already claimed them. */
  skippedDedup: number;
  /** Occurrences whose run threw (isolated — one bad job never blocks the rest). */
  failed: { jobId: string; occurrence: string }[];
}

export interface ScheduleTickDeps {
  /** Win-once claim for a (job, occurrence) key — default the shared-KV compare-and-set (fleet-safe). */
  claim?: (key: string) => Promise<boolean>;
  /** The jobs to consider — default the live registry. Injectable for tests. */
  jobs?: ScheduledJob[];
  /** Cron scan bound (minutes back from now); interval jobs ignore it. */
  maxMinutes?: number;
}

/**
 * Fire every registered job's occurrences due in `(sinceMs, nowMs]`. Each occurrence is claimed once before it
 * runs (exactly-once fleet-wide). Never throws — a per-job/claim/run failure is isolated so one bad job can't
 * block the rest. Returns a summary for observability + assertions.
 */
export async function runDueScheduledJobs(sinceMs: number, nowMs: number, deps: ScheduleTickDeps = {}): Promise<ScheduleTickSummary> {
  const claim = deps.claim ?? ((key: string) => sharedKv.cas(key, null, "1", { ttlMs: CLAIM_TTL_MS }));
  const jobs = deps.jobs ?? gatherJobs();
  const summary: ScheduleTickSummary = { fired: [], skippedDedup: 0, failed: [] };

  for (const job of jobs) {
    let schedule: JobSchedule | null;
    try { schedule = job.resolveSchedule(); } catch (err) { logger.warn({ err, job: job.id }, "job-scheduler: resolveSchedule threw; skipped"); continue; }
    if (!schedule) continue;

    let occurrences: number[];
    try { occurrences = occurrencesInWindow(schedule, sinceMs, nowMs, deps.maxMinutes); } catch { continue; }

    for (const occ of occurrences) {
      const iso = new Date(occ).toISOString();
      const key = `job:${job.id}:${iso}`;
      let won = false;
      try { won = await claim(key); } catch { won = false; } // a claim outage must NOT double-fire — treat as lost
      if (!won) { summary.skippedDedup++; continue; }
      try {
        await job.run(occ);
        summary.fired.push({ jobId: job.id, occurrence: iso });
      } catch (err) {
        logger.warn({ err, job: job.id, occurrence: iso }, `job-scheduler: job "${job.id}" run failed`);
        summary.failed.push({ jobId: job.id, occurrence: iso });
      }
    }
  }
  return summary;
}

/** The heartbeat cadence in minutes: the SCHEDULER_HEARTBEAT_MINUTES override when a valid positive number,
 *  else 60. 0 (or invalid) disables the whole in-process scheduler (master opt-out). */
export function jobSchedulerHeartbeatMinutes(): number {
  const raw = process.env["SCHEDULER_HEARTBEAT_MINUTES"]?.trim();
  if (raw === undefined || raw === "") return 60;
  const mins = Number(raw);
  if (!Number.isFinite(mins) || mins < 0) return 60;
  return mins;
}

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunMs = 0;

/**
 * Start the single in-process heartbeat that drives every registered job. No-op when
 * SCHEDULER_HEARTBEAT_MINUTES=0 (master opt-out). Each tick fires the occurrences due since the previous tick.
 * Unref'd (never keeps the process alive); a run's errors are logged, never fatal. Called once at boot.
 */
export function startJobScheduler(): boolean {
  const minutes = jobSchedulerHeartbeatMinutes();
  if (minutes <= 0) {
    logger.info("job-scheduler: disabled (SCHEDULER_HEARTBEAT_MINUTES=0)");
    return false;
  }
  if (timer) clearInterval(timer);
  lastRunMs = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const since = lastRunMs;
    lastRunMs = now;
    void runDueScheduledJobs(since, now)
      .then((s) => { if (s.fired.length || s.failed.length) logger.info({ fired: s.fired.length, failed: s.failed.length }, "job-scheduler: tick"); })
      .catch((err) => logger.warn({ err }, "job-scheduler tick failed"));
  }, minutes * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ everyMinutes: minutes }, "job-scheduler: heartbeat started (opt-out; set SCHEDULER_HEARTBEAT_MINUTES=0 to disable). Occurrences are claim-once, so it is safe on every replica.");
  return true;
}

/** Stop the heartbeat (tests / shutdown). Idempotent. */
export function stopJobScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
