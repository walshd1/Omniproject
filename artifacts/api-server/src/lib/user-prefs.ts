import { getSettings, updateSettings, type UserPrefs } from "./settings";

/**
 * Per-user UI/accessibility preferences, persisted server-side keyed by the user's
 * `sub` so a person's setup (text size, background colour, contrast, motion) follows
 * them across SESSIONS and devices — not just one browser. Stored as JSON; the code
 * here supplies the standard defaults when a user (or a field) is unspecified.
 *
 * This is personal config, never project data — the same trust class as branding.
 */

export const DEFAULT_USER_PREFS: UserPrefs = {
  fontScale: 1,
  backgroundColor: null,
  highContrast: false,
  reduceMotion: false,
  switchScan: "off",
  scanRateMs: 1500,
  screenReader: false,
  speechInput: false,
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SCAN_MODES = ["off", "single", "two"] as const;
const clampScale = (n: number): number => Math.min(1.5, Math.max(0.85, Math.round(n * 100) / 100));
const clampScanRate = (n: number): number => Math.min(5000, Math.max(500, Math.round(n)));

/** Coerce arbitrary input to valid prefs, filling each missing field from defaults. */
export function sanitizeUserPrefs(input: unknown): UserPrefs {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    fontScale: typeof o["fontScale"] === "number" ? clampScale(o["fontScale"] as number) : DEFAULT_USER_PREFS.fontScale,
    backgroundColor: typeof o["backgroundColor"] === "string" && HEX.test(o["backgroundColor"] as string) ? (o["backgroundColor"] as string) : null,
    highContrast: !!o["highContrast"],
    reduceMotion: !!o["reduceMotion"],
    switchScan: (SCAN_MODES as readonly string[]).includes(o["switchScan"] as string) ? (o["switchScan"] as UserPrefs["switchScan"]) : "off",
    scanRateMs: typeof o["scanRateMs"] === "number" ? clampScanRate(o["scanRateMs"] as number) : DEFAULT_USER_PREFS.scanRateMs,
    screenReader: !!o["screenReader"],
    speechInput: !!o["speechInput"],
  };
}

/** A user's stored prefs, or the code defaults when they have none. */
export function getUserPrefs(sub: string): UserPrefs {
  return getSettings().userPrefs[sub] ?? DEFAULT_USER_PREFS;
}

/** Has this user saved prefs? (Lets the client tell "stored" from "defaults".) */
export function hasUserPrefs(sub: string): boolean {
  return Object.prototype.hasOwnProperty.call(getSettings().userPrefs, sub);
}

/** Persist (sanitised) prefs for a user; returns what was stored. */
export function setUserPrefs(sub: string, input: unknown): UserPrefs {
  const clean = sanitizeUserPrefs(input);
  updateSettings({ userPrefs: { ...getSettings().userPrefs, [sub]: clean } });
  return clean;
}
