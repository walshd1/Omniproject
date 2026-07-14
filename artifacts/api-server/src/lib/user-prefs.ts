import { getSettings, updateSettings, type UserPrefs, type ScopedThemeOverride } from "./settings";

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
  fontFamily: null,
  accentColor: null,
  backgroundColor: null,
  highContrast: false,
  reduceMotion: false,
  switchScan: "off",
  scanRateMs: 1500,
  screenReader: false,
  speechInput: false,
  mobileMode: "auto",
  density: "comfortable",
  scopedOverrides: {},
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_FAMILIES = ["sans", "serif", "mono"] as const;
/** Keys that must never be used as a map index (prototype-pollution sinks). */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Cap the saved-scope map so a client can't bloat a user's prefs unboundedly. */
const MAX_SCOPES = 200;
const MAX_SCOPE_KEY_LEN = 200;

const cleanHex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v : null);
const cleanFamily = (v: unknown): "sans" | "serif" | "mono" | null =>
  (FONT_FAMILIES as readonly string[]).includes(v as string) ? (v as "sans" | "serif" | "mono") : null;

/** Coerce one scoped override to its three optional, validated fields (drops anything else). */
function sanitizeScopedOverride(input: unknown): ScopedThemeOverride {
  const o = (input ?? {}) as Record<string, unknown>;
  const out: ScopedThemeOverride = {};
  if ("fontFamily" in o) out.fontFamily = cleanFamily(o["fontFamily"]);
  if ("accentColor" in o) out.accentColor = cleanHex(o["accentColor"]);
  if ("backgroundColor" in o) out.backgroundColor = cleanHex(o["backgroundColor"]);
  return out;
}

/** Coerce the saved per-screen/per-artifact override map: drop forbidden/oversized keys and empty
 *  entries, cap the total, and validate each override's fields. Never trusts client-supplied keys. */
function sanitizeScopedOverrides(input: unknown): Record<string, ScopedThemeOverride> {
  if (typeof input !== "object" || input == null || Array.isArray(input)) return {};
  const out: Record<string, ScopedThemeOverride> = {};
  let n = 0;
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_SCOPES) break;
    if (FORBIDDEN_KEYS.has(key) || !key || key.length > MAX_SCOPE_KEY_LEN) continue;
    const clean = sanitizeScopedOverride(val);
    // Drop an entry that carries no actual override (so a cleared scope doesn't linger).
    if (clean.fontFamily == null && clean.accentColor == null && clean.backgroundColor == null) continue;
    out[key] = clean;
    n++;
  }
  return out;
}
const SCAN_MODES = ["off", "single", "two"] as const;
const MOBILE_MODES = ["auto", "on", "off"] as const;
const DENSITIES = ["comfortable", "compact"] as const;
const clampScale = (n: number): number => Math.min(1.5, Math.max(0.85, Math.round(n * 100) / 100));
const clampScanRate = (n: number): number => Math.min(5000, Math.max(500, Math.round(n)));

/** Coerce arbitrary input to valid prefs, filling each missing field from defaults. */
export function sanitizeUserPrefs(input: unknown): UserPrefs {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    fontScale: typeof o["fontScale"] === "number" ? clampScale(o["fontScale"] as number) : DEFAULT_USER_PREFS.fontScale,
    fontFamily: (FONT_FAMILIES as readonly string[]).includes(o["fontFamily"] as string) ? (o["fontFamily"] as UserPrefs["fontFamily"]) : null,
    accentColor: typeof o["accentColor"] === "string" && HEX.test(o["accentColor"] as string) ? (o["accentColor"] as string) : null,
    backgroundColor: typeof o["backgroundColor"] === "string" && HEX.test(o["backgroundColor"] as string) ? (o["backgroundColor"] as string) : null,
    highContrast: !!o["highContrast"],
    reduceMotion: !!o["reduceMotion"],
    switchScan: (SCAN_MODES as readonly string[]).includes(o["switchScan"] as string) ? (o["switchScan"] as UserPrefs["switchScan"]) : "off",
    scanRateMs: typeof o["scanRateMs"] === "number" ? clampScanRate(o["scanRateMs"] as number) : DEFAULT_USER_PREFS.scanRateMs,
    screenReader: !!o["screenReader"],
    speechInput: !!o["speechInput"],
    mobileMode: (MOBILE_MODES as readonly string[]).includes(o["mobileMode"] as string) ? (o["mobileMode"] as UserPrefs["mobileMode"]) : "auto",
    density: (DENSITIES as readonly string[]).includes(o["density"] as string) ? (o["density"] as UserPrefs["density"]) : "comfortable",
    scopedOverrides: sanitizeScopedOverrides(o["scopedOverrides"]),
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
