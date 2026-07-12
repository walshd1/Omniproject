import { getSettings, updateSettings, type CalendarPushGrant } from "./settings";

/**
 * Per-user calendar-push CONSENT. Nothing is ever pushed to a user's calendar unless they have
 * explicitly granted it here (default: not granted). The gateway stores ONLY this consent flag +
 * target choice — never an OAuth credential. The actual event upsert is done by the calendar
 * connection/MCP the user authorises, which reads the grant-gated push feed; revoking the grant
 * (or the MCP authorisation) stops it. Personal config, keyed by the user's `sub` — same trust class
 * as user-prefs.
 */

const TARGETS = ["google-calendar", "outlook-calendar"] as const;
const SCOPES = ["mine", "all"] as const;

export const NO_GRANT: CalendarPushGrant = { granted: false, target: null, scope: "mine", grantedAt: null };

/** A user's push grant, or the not-granted default. */
export function getCalendarPush(sub: string): CalendarPushGrant {
  return getSettings().calendarPush[sub] ?? NO_GRANT;
}

/**
 * Coerce arbitrary input to a valid grant. `grantedAt` is server-stamped (passed in) rather than
 * caller-supplied. Granting requires a target — you can't consent to pushing "nowhere".
 */
export function sanitizeGrant(input: unknown, now: string): CalendarPushGrant {
  const o = (input ?? {}) as Record<string, unknown>;
  const target = (TARGETS as readonly string[]).includes(o["target"] as string) ? (o["target"] as CalendarPushGrant["target"]) : null;
  const scope = (SCOPES as readonly string[]).includes(o["scope"] as string) ? (o["scope"] as CalendarPushGrant["scope"]) : "mine";
  // Consent only counts when the user asked for it AND named a destination.
  const granted = !!o["granted"] && target !== null;
  return { granted, target, scope, grantedAt: granted ? now : null };
}

/** Persist a user's grant; returns what was stored. */
export function setCalendarPush(sub: string, input: unknown, now: string): CalendarPushGrant {
  const clean = sanitizeGrant(input, now);
  updateSettings({ calendarPush: { ...getSettings().calendarPush, [sub]: clean } });
  return clean;
}
