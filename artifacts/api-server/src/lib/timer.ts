/**
 * LIVE TIME TRACKING — a running "clock" (roadmap 3.3). A timer is EPHEMERAL per-user state: at most one
 * runs per person, held in the shared-state KV (`timer:running:<sub>`), NOT in the durable artifact store —
 * it's a transient stopwatch, and on stop it materialises into a day-grained timesheet `TimeEntry`. The pure
 * helpers (key, sanitise, elapsed→entry) live here; the route wires them to `sharedKv`. Zero-at-rest holds:
 * the timer is a tiny {startedAt, projectId, …} record, TTL-bounded, and nothing sensitive is stored.
 */

/** The shared-state key for a person's running timer (one per user). */
export const runningTimerKey = (sub: string): string => `timer:running:${sub}`;

/** A running timer — what's stored while the clock ticks. */
export interface RunningTimer {
  startedAt: string;
  projectId: string;
  issueId?: string;
  note?: string;
}

/** A rejected timer start (maps to 400). */
export class TimerError extends Error {
  constructor(message: string) { super(message); this.name = "TimerError"; }
}

const MAX_REF = 256;
const MAX_NOTE = 2000;
/** A timer auto-expires after 24h of wall-clock so a forgotten clock can't run forever. */
export const TIMER_TTL_MS = 24 * 60 * 60 * 1000;

/** Strip control characters (keep printable text) and cap length. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const printable = c === 9 || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}

/** Validate a timer start (needs a projectId; issueId/note optional). Throws {@link TimerError} (→ 400). */
export function sanitizeTimerStart(raw: unknown, startedAt: string): RunningTimer {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const projectId = cleanText(obj["projectId"], MAX_REF);
  if (!projectId) throw new TimerError("a timer needs a projectId");
  const timer: RunningTimer = { startedAt, projectId };
  const issueId = cleanText(obj["issueId"], MAX_REF);
  if (issueId) timer.issueId = issueId;
  const note = cleanText(obj["note"], MAX_NOTE);
  if (note) timer.note = note;
  return timer;
}

/** Elapsed hours between `startedAt` and `nowMs`, rounded to 2 dp; never negative (clock skew ⇒ 0). Pure. */
export function elapsedHours(startedAt: string, nowMs: number): number {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  const ms = Math.max(0, nowMs - start);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** A day-grained timesheet entry materialised from a stopped timer (the shape the timesheet store books). */
export interface TimerEntry {
  projectId: string;
  issueId?: string;
  date: string;
  hours: number;
  note?: string;
}

/** Build the timesheet entry a stopped timer produces (dated to the stop day). Pure. */
export function timerToEntry(timer: RunningTimer, nowMs: number, nowISODate: string): TimerEntry {
  const entry: TimerEntry = { projectId: timer.projectId, date: nowISODate, hours: elapsedHours(timer.startedAt, nowMs) };
  if (timer.issueId) entry.issueId = timer.issueId;
  if (timer.note) entry.note = timer.note;
  return entry;
}
