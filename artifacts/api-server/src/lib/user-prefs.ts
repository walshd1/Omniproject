import { getSettings, updateSettings, type UserPrefs, type ScopedThemeOverride } from "./settings";
import { artifactStoreEnabled, getArtifact, putArtifact } from "./artifact-store";

/**
 * Per-user UI/accessibility preferences, persisted server-side keyed by the user's
 * `sub` so a person's setup (text size, background colour, contrast, motion) follows
 * them across SESSIONS and devices — not just one browser.
 *
 * STORAGE (roadmap X.10 — "user-adjustable settings live in the appropriate JSON vault"): these are the ONE
 * genuinely user-adjustable settings surface (written by any authed user via `PUT /api/me/prefs`), so they
 * belong in that user's OWN scoped, AES-256-GCM-sealed vault — `user-<sub>.json` in the artifact store — not
 * commingled in the org-wide config blob. A write touches only the caller's own vault. The legacy
 * `settings.userPrefs[sub]` map is a READ bridge: a pre-migration pref still resolves, and the user's next
 * save moves it into their vault. When no artifact store is configured, we fall back to the settings map.
 *
 * This is personal config, never project data — the same trust class as branding.
 */

/** The per-user prefs artifact: type + fixed id (one row per user vault). */
const PREFS_TYPE = "user-prefs";
const PREFS_ID = "prefs";
interface StoredPrefs { id: string; prefs: UserPrefs }
const userScope = (sub: string) => ({ kind: "user", sub }) as const;

/** The user's prefs from THEIR vault, or null (store off / none saved). Sanitised on the way out so a
 *  payload that entered the vault via a restored/tampered BACKUP (the def-store import re-encrypts config
 *  blobs but has no per-kind validator for them) is still normalised to valid prefs before use. */
function vaultPrefs(sub: string): UserPrefs | null {
  if (!artifactStoreEnabled()) return null;
  const raw = getArtifact<StoredPrefs>(PREFS_TYPE, userScope(sub), PREFS_ID)?.prefs;
  return raw == null ? null : sanitizeUserPrefs(raw);
}

export const DEFAULT_USER_PREFS: UserPrefs = {
  fontScale: 1,
  fontFamily: null,
  accentColor: null,
  backgroundColor: null,
  highContrast: false,
  tint: false,
  tintColor: "#f5e9c8",
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
    tint: !!o["tint"],
    tintColor: typeof o["tintColor"] === "string" && HEX.test(o["tintColor"] as string) ? (o["tintColor"] as string) : "#f5e9c8",
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

/**
 * Coerce arbitrary input to a PARTIAL prefs — only the keys actually PRESENT (and valid) are kept, none are
 * filled from defaults. This is the shape of the org accessibility DEFAULT: it overrides the code default only
 * for the fields it names, and everything it omits falls through. Used for the org layer beneath the user leaf.
 */
export function sanitizePartialUserPrefs(input: unknown): Partial<UserPrefs> {
  const o = (input ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] != null;
  const full = sanitizeUserPrefs(o); // per-field coerced against the same rules as a user's own prefs
  const out: Partial<UserPrefs> = {};
  for (const k of Object.keys(DEFAULT_USER_PREFS) as (keyof UserPrefs)[]) if (has(k)) (out as Record<string, unknown>)[k] = full[k];
  return out;
}

/** The org-wide accessibility DEFAULTS (a partial), sanitised on read from the presentation settings. */
export function orgAccessibilityDefaults(): Partial<UserPrefs> {
  return sanitizePartialUserPrefs(getSettings().accessibilityDefaults);
}

/** The effective DEFAULT for a user with no saved prefs: the org's accessibility defaults over the code
 *  defaults (per field). The user leaf, when present, still wins over this — the org may only DEFAULT, not lock. */
export function effectiveDefaultPrefs(): UserPrefs {
  return { ...DEFAULT_USER_PREFS, ...orgAccessibilityDefaults() };
}

/** A user's stored prefs, or the effective DEFAULT (org defaults over code defaults) when they have none. Reads
 *  their own vault first, then the legacy settings map (migration bridge), then the org/code default. The user's
 *  own leaf ALWAYS wins where it exists — accessibility is user-final policy, never floored by a higher scope. */
export function getUserPrefs(sub: string): UserPrefs {
  return vaultPrefs(sub) ?? getSettings().userPrefs[sub] ?? effectiveDefaultPrefs();
}

/** Has this user saved prefs? (Lets the client tell "stored" from "defaults".)
 *  True if they're in the vault OR still only in the legacy settings map. */
export function hasUserPrefs(sub: string): boolean {
  return vaultPrefs(sub) != null || Object.prototype.hasOwnProperty.call(getSettings().userPrefs, sub);
}

/** Persist (sanitised) prefs for a user; returns what was stored. Writes to the caller's OWN
 *  scoped vault when the artifact store is configured; otherwise falls back to the settings map. */
export function setUserPrefs(sub: string, input: unknown): UserPrefs {
  const clean = sanitizeUserPrefs(input);
  if (artifactStoreEnabled()) {
    putArtifact<StoredPrefs>(PREFS_TYPE, userScope(sub), { id: PREFS_ID, prefs: clean });
  } else {
    updateSettings({ userPrefs: { ...getSettings().userPrefs, [sub]: clean } });
  }
  return clean;
}
