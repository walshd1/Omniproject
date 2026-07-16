import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { sharedKv } from "../lib/shared-state";
import {
  runningTimerKey, sanitizeTimerStart, elapsedHours, timerToEntry, TIMER_TTL_MS, TimerError,
  type RunningTimer,
} from "../lib/timer";

/**
 * LIVE TIMER routes (roadmap 3.3). Start / stop / read the caller's ONE running timer — ephemeral per-user
 * state in the shared-state KV (`timer:running:<sub>`), TTL-bounded so a forgotten clock can't run forever.
 * Stopping computes the elapsed hours and returns a day-grained timesheet entry the caller can then book.
 * All routes are contributor+ (logging your own time is a write, but not an authoring/admin act).
 */
const router = Router();

async function readTimer(sub: string): Promise<RunningTimer | null> {
  const raw = await sharedKv.get(runningTimerKey(sub));
  if (!raw) return null;
  try { return JSON.parse(raw) as RunningTimer; } catch { return null; }
}

// GET /api/timer — the caller's running timer + its live elapsed hours, or {running:false}.
router.get("/timer", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "get_timer failed", async () => {
    const sub = contextFromReq(req).sub;
    if (!sub) { res.status(401).json({ error: "sign in to use a timer" }); return; }
    const timer = await readTimer(sub);
    if (!timer) { res.json({ running: false }); return; }
    res.json({ running: true, timer, elapsedHours: elapsedHours(timer.startedAt, Date.now()) });
  }),
);

// POST /api/timer/start — start the caller's timer (replaces any already-running one).
router.post("/timer/start", requireRole("contributor"), (req, res) => {
  let timer;
  try { timer = sanitizeTimerStart(req.body, new Date().toISOString()); }
  catch (e) { if (e instanceof TimerError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "start_timer failed", async () => {
    const sub = contextFromReq(req).sub;
    if (!sub) { res.status(401).json({ error: "sign in to use a timer" }); return; }
    await sharedKv.set(runningTimerKey(sub), JSON.stringify(timer), { ttlMs: TIMER_TTL_MS });
    res.status(201).json({ running: true, timer, elapsedHours: 0 });
  });
});

// POST /api/timer/stop — stop the caller's timer and return the timesheet entry it produced (or 404 if none).
router.post("/timer/stop", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "stop_timer failed", async () => {
    const sub = contextFromReq(req).sub;
    if (!sub) { res.status(401).json({ error: "sign in to use a timer" }); return; }
    const timer = await readTimer(sub);
    if (!timer) { res.status(404).json({ error: "no timer is running" }); return; }
    await sharedKv.del(runningTimerKey(sub));
    const now = Date.now();
    res.json({ running: false, entry: timerToEntry(timer, now, new Date(now).toISOString().slice(0, 10)) });
  }),
);

export default router;
