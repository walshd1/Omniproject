/**
 * PER-USER NOTIFICATION PREFERENCES — the pure policy a user expresses over the notification plane:
 * which channels they want, which event kinds they've silenced, and a daily quiet-hours window. Kept as a
 * pure, dependency-free module (only the canonical kind vocabulary) so BOTH the gateway (enforcement at the
 * in-app SSE plane) and the SPA (the settings panel) evaluate identical rules from one source.
 *
 * Safety rule baked in: a `critical`-severity kind (blocker, incident) is NEVER suppressed — mute and quiet
 * hours only ever apply to info/warning. A user can quiet the noise; they can't silence an emergency.
 */
import { KNOWN_NOTIFICATION_KINDS, notificationSeverity } from "./notification-kinds";

/** The user-facing delivery channels a preference can gate (a subset of the full channel catalogue). */
export type NotifyChannel = "inApp" | "email" | "push";
export const NOTIFY_CHANNELS: readonly NotifyChannel[] = ["inApp", "email", "push"];

export interface NotificationPrefs {
  /** Master per-channel switches. */
  channels: Record<NotifyChannel, boolean>;
  /** Notification kinds the user has silenced (info/warning only — critical always delivers). */
  mutedKinds: string[];
  /**
   * Daily quiet-hours window (local wall-clock "HH:MM", 24h). While active, the interruptive channels
   * (email/push) are held for non-critical events; the in-app bell still records them quietly.
   */
  quietHours: { enabled: boolean; start: string; end: string };
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  channels: { inApp: true, email: true, push: true },
  mutedKinds: [],
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

/** Cap the muted-kinds list (there are only ~10 kinds; the cap defends against a bloated client payload). */
const MAX_MUTED = 50;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanTime = (v: unknown, fallback: string): string => (typeof v === "string" && HHMM.test(v) ? v : fallback);

/** Coerce arbitrary input to a valid `NotificationPrefs`, filling each missing field from defaults. Unknown
 *  channel keys, unknown/duplicate kinds, and malformed times are dropped — never trusts client input. */
export function sanitizeNotificationPrefs(input: unknown): NotificationPrefs {
  const o = (input ?? {}) as Record<string, unknown>;
  const ch = (o["channels"] ?? {}) as Record<string, unknown>;
  const q = (o["quietHours"] ?? {}) as Record<string, unknown>;
  const mutedRaw = Array.isArray(o["mutedKinds"]) ? o["mutedKinds"] : [];
  const mutedKinds = [...new Set(mutedRaw.filter((k): k is string => typeof k === "string" && KNOWN_NOTIFICATION_KINDS.has(k)))].slice(0, MAX_MUTED);
  return {
    // A channel is ON unless explicitly set false (so a partial payload defaults to opted-in).
    channels: { inApp: ch["inApp"] !== false, email: ch["email"] !== false, push: ch["push"] !== false },
    mutedKinds,
    quietHours: {
      enabled: q["enabled"] === true,
      start: cleanTime(q["start"], DEFAULT_NOTIFICATION_PREFS.quietHours.start),
      end: cleanTime(q["end"], DEFAULT_NOTIFICATION_PREFS.quietHours.end),
    },
  };
}

/** Minutes since midnight for a validated "HH:MM". */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Is the local wall-clock time of `now` within the [start, end) daily quiet window? Handles a window that
 *  wraps past midnight (start > end, e.g. 22:00→07:00). A degenerate start===end window is never active. */
export function inQuietHours(prefs: NotificationPrefs, now: Date): boolean {
  if (!prefs.quietHours.enabled) return false;
  const start = toMinutes(prefs.quietHours.start);
  const end = toMinutes(prefs.quietHours.end);
  if (start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Which channels a notification of `kind` should reach for a user with these prefs, at time `now`.
 *  - `critical` severity → every enabled channel, ALWAYS (bypasses mute + quiet hours);
 *  - a muted kind → nothing;
 *  - during quiet hours → in-app only (the interruptive channels are held);
 *  - otherwise → every enabled channel.
 */
export function allowedChannels(prefs: NotificationPrefs, kind: string, now: Date): NotifyChannel[] {
  const enabled = NOTIFY_CHANNELS.filter((c) => prefs.channels[c]);
  // Safety: an emergency ALWAYS reaches the in-app bell (the guaranteed floor a user can't disable), plus
  // any other channel they left on — mute, quiet hours, and even an off in-app toggle never silence it.
  if (notificationSeverity(kind) === "critical") return NOTIFY_CHANNELS.filter((c) => c === "inApp" || prefs.channels[c]);
  if (prefs.mutedKinds.includes(kind)) return [];
  if (inQuietHours(prefs, now)) return enabled.filter((c) => c === "inApp");
  return enabled;
}

/** Does the in-app plane (the bell / SSE stream) accept this notification for this user at `now`? */
export function acceptsInApp(prefs: NotificationPrefs, kind: string, now: Date): boolean {
  return allowedChannels(prefs, kind, now).includes("inApp");
}
