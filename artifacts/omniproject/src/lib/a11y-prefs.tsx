import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setAnnounceVerbose } from "./announce";
import { brandTokensFromHex } from "./color";
import { FONT_CHOICES, FONT_STACKS, type FontChoice } from "./artifact-style";

/**
 * Per-user accessibility preferences — a CLIENT-SIDE layer that an individual user
 * sets for themselves, on TOP of the company's branding. It lives in localStorage
 * only: nothing is sent to the server, and losing/clearing it simply reverts to the
 * company look — fully in keeping with OmniProject's stateless, nothing-at-rest
 * ethos (the JSON/company config is untouched; this is just a personal overlay).
 *
 * Accessibility-first by intent: text scale, high contrast, reduced motion — the
 * things a person needs to make any company theme usable for them.
 */

export type SwitchScanMode = "off" | "single" | "two";
export type MobileMode = "auto" | "on" | "off";
/** UI spacing density: roomy default vs a tighter, information-dense layout. */
export type Density = "comfortable" | "compact";

export interface A11yPrefs {
  /** UI text scale, 0.85–1.5 (1 = company default). Per-user font SIZE. */
  fontScale: number;
  /** Personal font FAMILY, or null to inherit the company brand font. Overrides the org font. */
  fontFamily: FontChoice | null;
  /** Personal accent COLOUR (hex), or null to inherit the company brand accent. Overrides the org accent. */
  accentColor: string | null;
  /** Personal page background colour (hex), or null for the company default. */
  backgroundColor: string | null;
  /** Stronger borders, underlined links, thick focus outlines. */
  highContrast: boolean;
  /** Near-instant transitions/animations. */
  reduceMotion: boolean;
  /** Switch-access scanning: off, single-switch (auto-scan) or two-switch (step). */
  switchScan: SwitchScanMode;
  /** Auto-scan dwell time per item, ms (single-switch). */
  scanRateMs: number;
  /** Verbose live-region announcements to aid screen-reader users. */
  screenReader: boolean;
  /** Show the dictation mic (on-device speech-to-text via the user's own browser). */
  speechInput: boolean;
  /** Touch-optimised mobile layout: follow the device (auto) or force on/off. */
  mobileMode: MobileMode;
  /** UI spacing density (comfortable = company default, compact = tighter). */
  density: Density;
  /**
   * SAVED per-screen / per-artifact theme overrides, keyed by scope id (e.g. "screen:reports").
   * Each overrides the user's GLOBAL settings for that one surface. Session-only scoped tweaks are
   * held in memory by lib/theme-scope and never persisted here.
   */
  scopedOverrides: Record<string, ScopedOverride>;
}

/** A per-screen / per-artifact theme override. All fields optional; absent = inherit the global layer. */
export interface ScopedOverride {
  fontFamily?: FontChoice | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
}

export const DEFAULT_A11Y: A11yPrefs = {
  fontScale: 1, fontFamily: null, accentColor: null, backgroundColor: null, highContrast: false, reduceMotion: false,
  switchScan: "off", scanRateMs: 1500, screenReader: false, speechInput: false, mobileMode: "auto",
  density: "comfortable", scopedOverrides: {},
};

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_SCOPES = 200;

/** Coerce the saved scoped-override map from untrusted storage: valid fields only, drop empties +
 *  forbidden keys, cap the total. Mirrors the server-side sanitiser (lib/user-prefs). */
export function cleanScopedOverrides(input: unknown): Record<string, ScopedOverride> {
  if (typeof input !== "object" || input == null || Array.isArray(input)) return {};
  const out: Record<string, ScopedOverride> = {};
  let n = 0;
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_SCOPES) break;
    if (FORBIDDEN_KEYS.has(key) || !key || key.length > 200 || typeof val !== "object" || val == null) continue;
    const v = val as Record<string, unknown>;
    const o: ScopedOverride = {
      fontFamily: cleanFontFamily(v["fontFamily"]),
      accentColor: cleanColor(v["accentColor"]),
      backgroundColor: cleanColor(v["backgroundColor"]),
    };
    if (o.fontFamily == null && o.accentColor == null && o.backgroundColor == null) continue;
    out[key] = o;
    n++;
  }
  return out;
}

const KEY = "omni:a11y";
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.5;
const MIN_SCAN = 500;
const MAX_SCAN = 5000;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SCAN_MODES: SwitchScanMode[] = ["off", "single", "two"];
const MOBILE_MODES: MobileMode[] = ["auto", "on", "off"];
const DENSITIES: Density[] = ["comfortable", "compact"];

const clampScale = (n: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n * 100) / 100));
const clampScan = (n: number): number => Math.min(MAX_SCAN, Math.max(MIN_SCAN, Math.round(n)));
const cleanColor = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v : null);
const cleanFontFamily = (v: unknown): FontChoice | null => (FONT_CHOICES.includes(v as FontChoice) ? (v as FontChoice) : null);
const cleanScanMode = (v: unknown): SwitchScanMode => (SCAN_MODES.includes(v as SwitchScanMode) ? (v as SwitchScanMode) : "off");
const cleanMobileMode = (v: unknown): MobileMode => (MOBILE_MODES.includes(v as MobileMode) ? (v as MobileMode) : "auto");
const cleanDensity = (v: unknown): Density => (DENSITIES.includes(v as Density) ? (v as Density) : "comfortable");

/** Read prefs from localStorage, falling back to defaults on anything unexpected. */
export function loadA11yPrefs(): A11yPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_A11Y;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_A11Y;
    const p = JSON.parse(raw) as Partial<A11yPrefs>;
    return {
      fontScale: typeof p.fontScale === "number" ? clampScale(p.fontScale) : DEFAULT_A11Y.fontScale,
      fontFamily: cleanFontFamily(p.fontFamily),
      accentColor: cleanColor(p.accentColor),
      backgroundColor: cleanColor(p.backgroundColor),
      highContrast: !!p.highContrast,
      reduceMotion: !!p.reduceMotion,
      switchScan: cleanScanMode(p.switchScan),
      scanRateMs: typeof p.scanRateMs === "number" ? clampScan(p.scanRateMs) : DEFAULT_A11Y.scanRateMs,
      screenReader: !!p.screenReader,
      speechInput: !!p.speechInput,
      mobileMode: cleanMobileMode(p.mobileMode),
      density: cleanDensity(p.density),
      scopedOverrides: cleanScopedOverrides(p.scopedOverrides),
    };
  } catch {
    return DEFAULT_A11Y; // corrupt value ⇒ company defaults, no impact
  }
}

function saveA11yPrefs(p: A11yPrefs): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full/blocked — prefs just won't persist */ }
}

/** Apply prefs to the document root (CSS var + data-attributes the stylesheet honours). */
export function applyA11yPrefs(p: A11yPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--user-font-scale", String(clampScale(p.fontScale)));
  // Per-user font FAMILY + accent COLOUR override the org brand layer via the CSS
  // cascade (--user-* wins over --brand-* in index.css). Cleared ⇒ the brand shows through.
  const family = cleanFontFamily(p.fontFamily);
  if (family) root.style.setProperty("--user-font-family", FONT_STACKS[family]);
  else root.style.removeProperty("--user-font-family");
  const accent = p.accentColor ? brandTokensFromHex(p.accentColor) : null;
  if (accent) {
    root.style.setProperty("--user-accent", accent.channels);
    root.style.setProperty("--user-accent-fg", accent.fg);
  } else {
    root.style.removeProperty("--user-accent");
    root.style.removeProperty("--user-accent-fg");
  }
  if (p.backgroundColor) root.style.setProperty("--user-bg", p.backgroundColor);
  else root.style.removeProperty("--user-bg");
  root.setAttribute("data-contrast", p.highContrast ? "high" : "normal");
  root.setAttribute("data-reduce-motion", p.reduceMotion ? "true" : "false");
  root.setAttribute("data-density", p.density);
  setAnnounceVerbose(p.screenReader);
}

interface A11yContextValue {
  prefs: A11yPrefs;
  setFontScale: (n: number) => void;
  setFontFamily: (family: FontChoice | null) => void;
  setAccentColor: (hex: string | null) => void;
  setBackgroundColor: (hex: string | null) => void;
  toggleHighContrast: () => void;
  toggleReduceMotion: () => void;
  setSwitchScan: (mode: SwitchScanMode) => void;
  setScanRate: (ms: number) => void;
  toggleScreenReader: () => void;
  toggleSpeechInput: () => void;
  setMobileMode: (mode: MobileMode) => void;
  setDensity: (d: Density) => void;
  /** Persist (or clear, with null) a SAVED per-scope theme override to the user's profile. */
  setSavedScope: (scopeId: string, override: ScopedOverride | null) => void;
  reset: () => void;
}

const A11yContext = createContext<A11yContextValue | null>(null);

/** Persist the user's prefs to the server so they follow them across sessions and
 *  devices (fire-and-forget; a 401 pre-login is ignored — localStorage still holds). */
function syncToServer(prefs: A11yPrefs): void {
  void fetch("/api/me/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(prefs),
  }).catch(() => { /* offline / unauthenticated — the local cache still applies */ });
}

/**
 * Provides + applies the per-user accessibility prefs. They are cached in
 * localStorage for an instant, flash-free first paint, AND persisted server-side
 * (keyed by the signed-in user) so a person's setup follows them to any device —
 * important for users with dyslexia / visual impairment. Server-stored prefs are the
 * source of truth once signed in; the code defaults fill anything unset.
 */
export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(() => loadA11yPrefs());

  // Apply + cache locally on every change.
  useEffect(() => {
    applyA11yPrefs(prefs);
    saveA11yPrefs(prefs);
  }, [prefs]);

  // Hydrate from the user's server-stored prefs once (only when they actually have a
  // saved entry, so a fresh device doesn't clobber a local setup with defaults). No
  // write-back here — only USER changes persist, avoiding a mount-time overwrite race.
  useEffect(() => {
    let alive = true;
    fetch("/api/me/prefs", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.stored && d.prefs) setPrefs((p) => ({ ...p, ...d.prefs })); })
      .catch(() => { /* not signed in / offline — keep the local prefs */ });
    return () => { alive = false; };
  }, []);

  // A user-initiated change: update state, cache, AND persist to the server.
  const change = (next: A11yPrefs): void => { setPrefs(next); syncToServer(next); };

  const value: A11yContextValue = {
    prefs,
    setFontScale: (n) => change({ ...prefs, fontScale: clampScale(n) }),
    setFontFamily: (family) => change({ ...prefs, fontFamily: cleanFontFamily(family) }),
    setAccentColor: (hex) => change({ ...prefs, accentColor: cleanColor(hex) }),
    setBackgroundColor: (hex) => change({ ...prefs, backgroundColor: cleanColor(hex) }),
    toggleHighContrast: () => change({ ...prefs, highContrast: !prefs.highContrast }),
    toggleReduceMotion: () => change({ ...prefs, reduceMotion: !prefs.reduceMotion }),
    setSwitchScan: (mode) => change({ ...prefs, switchScan: cleanScanMode(mode) }),
    setScanRate: (ms) => change({ ...prefs, scanRateMs: clampScan(ms) }),
    toggleScreenReader: () => change({ ...prefs, screenReader: !prefs.screenReader }),
    toggleSpeechInput: () => change({ ...prefs, speechInput: !prefs.speechInput }),
    setMobileMode: (mode) => change({ ...prefs, mobileMode: cleanMobileMode(mode) }),
    setDensity: (d) => change({ ...prefs, density: cleanDensity(d) }),
    setSavedScope: (scopeId, override) => {
      if (FORBIDDEN_KEYS.has(scopeId) || !scopeId) return;
      const next = { ...prefs.scopedOverrides };
      const clean = override
        ? { fontFamily: cleanFontFamily(override.fontFamily), accentColor: cleanColor(override.accentColor), backgroundColor: cleanColor(override.backgroundColor) }
        : null;
      // A null override, or one with no surviving field, clears the saved scope.
      if (!clean || (clean.fontFamily == null && clean.accentColor == null && clean.backgroundColor == null)) delete next[scopeId];
      else next[scopeId] = clean;
      change({ ...prefs, scopedOverrides: next });
    },
    reset: () => change(DEFAULT_A11Y),
  };
  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

export function useA11yPrefs(): A11yContextValue {
  const ctx = useContext(A11yContext);
  if (!ctx) throw new Error("useA11yPrefs must be used within an A11yProvider");
  return ctx;
}

/** Non-throwing read of the a11y context — null when no A11yProvider is mounted. Used by the
 *  scoped-theme layer so an artifact/frame rendered in isolation (e.g. a unit test) degrades to
 *  "no per-user override" instead of throwing. The full app always mounts the provider. */
export function useA11yPrefsOptional(): A11yContextValue | null {
  return useContext(A11yContext);
}

export const A11Y_SCALE_BOUNDS = { min: MIN_SCALE, max: MAX_SCALE };
