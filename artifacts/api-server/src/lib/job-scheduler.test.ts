import test from "node:test";
import assert from "node:assert/strict";
import {
  occurrencesInWindow,
  resolveIntervalHours,
  runDueScheduledJobs,
  jobSchedulerHeartbeatMinutes,
  type ScheduledJob,
  type JobSchedule,
} from "./job-scheduler";

/**
 * The unified job scheduler: deterministic occurrence math (interval AND cron), claim-once per (job,
 * occurrence), and fault isolation. One engine behind every scheduled infra job + automation recipe.
 */

const H = 60 * 60 * 1000;

test("interval occurrences are epoch-anchored and fire once per boundary crossed", () => {
  const sched: JobSchedule = { kind: "interval", hours: 6 };
  const period = 6 * H;
  // A boundary is a multiple of the period from the epoch. Pick a window straddling exactly one.
  const boundary = Math.floor(Date.parse("2024-03-01T12:00:00Z") / period) * period;
  assert.deepEqual(occurrencesInWindow(sched, boundary - 1, boundary + 1), [boundary]);
  // No boundary in the window ⇒ nothing due.
  assert.deepEqual(occurrencesInWindow(sched, boundary + 1, boundary + period - 1), []);
});

test("interval returns only the MOST RECENT boundary — no catch-up storm after downtime", () => {
  const sched: JobSchedule = { kind: "interval", hours: 24 };
  const period = 24 * H;
  const now = Math.floor(Date.parse("2024-06-10T00:00:00Z") / period) * period;
  // A week-long outage window spans ~7 daily boundaries, but only the latest fires.
  const out = occurrencesInWindow(sched, now - 7 * period - 1, now);
  assert.deepEqual(out, [now]);
});

test("disabled interval (hours <= 0) never fires", () => {
  assert.deepEqual(occurrencesInWindow({ kind: "interval", hours: 0 }, 0, 10 * H), []);
});

test("cron occurrences delegate to the UTC minute matcher", () => {
  const since = Date.parse("2024-03-01T09:00:00Z");
  const now = Date.parse("2024-03-01T11:00:00Z");
  const out = occurrencesInWindow({ kind: "cron", expr: "0 * * * *" }, since, now).map((ms) => new Date(ms).toISOString());
  assert.deepEqual(out, ["2024-03-01T10:00:00.000Z", "2024-03-01T11:00:00.000Z"]); // 09:00 is the exclusive lower bound
});

test("a malformed cron yields no occurrences (never throws)", () => {
  assert.deepEqual(occurrencesInWindow({ kind: "cron", expr: "not a cron" }, 0, 10 * H), []);
});

test("resolveIntervalHours: env override wins; blank/invalid/negative fall back to the default", () => {
  const V = "TEST_JOB_INTERVAL_HOURS";
  delete process.env[V];
  assert.equal(resolveIntervalHours(V, 6), 6);
  process.env[V] = "3"; assert.equal(resolveIntervalHours(V, 6), 3);
  process.env[V] = "0"; assert.equal(resolveIntervalHours(V, 6), 0); // explicit opt-out
  process.env[V] = "-1"; assert.equal(resolveIntervalHours(V, 6), 6);
  process.env[V] = "junk"; assert.equal(resolveIntervalHours(V, 6), 6);
  delete process.env[V];
});

test("jobSchedulerHeartbeatMinutes: default 60, override honoured, 0 = master off", () => {
  const V = "SCHEDULER_HEARTBEAT_MINUTES";
  const prev = process.env[V];
  delete process.env[V]; assert.equal(jobSchedulerHeartbeatMinutes(), 60);
  process.env[V] = "5"; assert.equal(jobSchedulerHeartbeatMinutes(), 5);
  process.env[V] = "0"; assert.equal(jobSchedulerHeartbeatMinutes(), 0);
  if (prev === undefined) delete process.env[V]; else process.env[V] = prev;
});

test("runDueScheduledJobs claims each occurrence once and runs the winner", async () => {
  const ran: string[] = [];
  const claimed = new Set<string>();
  const job: ScheduledJob = {
    id: "digest",
    label: "digest",
    resolveSchedule: () => ({ kind: "cron", expr: "0 * * * *" }),
    run: async (ms) => { ran.push(new Date(ms).toISOString()); },
  };
  const since = Date.parse("2024-03-01T09:00:00Z");
  const now = Date.parse("2024-03-01T11:00:00Z");
  const summary = await runDueScheduledJobs(since, now, {
    jobs: [job],
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
  });
  assert.deepEqual(ran, ["2024-03-01T10:00:00.000Z", "2024-03-01T11:00:00.000Z"]);
  assert.equal(summary.fired.length, 2);
  assert.equal(summary.skippedDedup, 0);
  // The claim key is namespaced by job id + occurrence.
  assert.ok([...claimed].every((k) => k.startsWith("job:digest:")));
});

test("a lost claim (another replica won it) does not run — exactly-once", async () => {
  let runs = 0;
  const job: ScheduledJob = {
    id: "j", label: "j",
    resolveSchedule: () => ({ kind: "cron", expr: "0 * * * *" }),
    run: async () => { runs++; },
  };
  const summary = await runDueScheduledJobs(
    Date.parse("2024-03-01T09:00:00Z"), Date.parse("2024-03-01T11:00:00Z"),
    { jobs: [job], claim: async () => false },
  );
  assert.equal(runs, 0);
  assert.equal(summary.fired.length, 0);
  assert.equal(summary.skippedDedup, 2);
});

test("a disabled job (resolveSchedule → null) contributes nothing", async () => {
  const summary = await runDueScheduledJobs(0, 10 * H, {
    jobs: [{ id: "off", label: "off", resolveSchedule: () => null, run: async () => { throw new Error("must not run"); } }],
    claim: async () => true,
  });
  assert.equal(summary.fired.length, 0);
});

test("a throwing run is isolated — reported as failed, the tick continues", async () => {
  const ran: string[] = [];
  const bad: ScheduledJob = { id: "bad", label: "bad", resolveSchedule: () => ({ kind: "interval", hours: 1 }), run: async () => { throw new Error("boom"); } };
  const good: ScheduledJob = { id: "good", label: "good", resolveSchedule: () => ({ kind: "interval", hours: 1 }), run: async () => { ran.push("good"); } };
  const period = H;
  const now = Math.floor(Date.parse("2024-03-01T12:00:00Z") / period) * period;
  const summary = await runDueScheduledJobs(now - 1, now, { jobs: [bad, good], claim: async () => true });
  assert.deepEqual(summary.failed.map((f) => f.jobId), ["bad"]);
  assert.deepEqual(ran, ["good"]);
  assert.equal(summary.fired.length, 1);
});
