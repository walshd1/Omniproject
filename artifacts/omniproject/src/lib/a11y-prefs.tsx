import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

export interface A11yPrefs {
  /** UI text scale, 0.85–1.5 (1 = company default). Per-user font SIZE. */
  fontScale: number;
  /** Personal page background colour (hex), or null for the company default. */
  backgroundColor: string | null;
  /** Stronger borders, underlined links, thick focus outlines. */
  highContrast: boolean;
  /** Near-instant transitions/animations. */
  reduceMotion: boolean;
}

export const DEFAULT_A11Y: A11yPrefs = { fontScale: 1, backgroundColor: null, highContrast: false, reduceMotion: false };

const KEY = "omni:a11y";
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.5;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const clampScale = (n: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n * 100) / 100));
const cleanColor = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v : null);

/** Read prefs from localStorage, falling back to defaults on anything unexpected. */
export function loadA11yPrefs(): A11yPrefs {
  if (typeof localStorage === "undefined") return DEFAULT_A11Y;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_A11Y;
    const p = JSON.parse(raw) as Partial<A11yPrefs>;
    return {
      fontScale: typeof p.fontScale === "number" ? clampScale(p.fontScale) : DEFAULT_A11Y.fontScale,
      backgroundColor: cleanColor(p.backgroundColor),
      highContrast: !!p.highContrast,
      reduceMotion: !!p.reduceMotion,
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
  if (p.backgroundColor) root.style.setProperty("--user-bg", p.backgroundColor);
  else root.style.removeProperty("--user-bg");
  root.setAttribute("data-contrast", p.highContrast ? "high" : "normal");
  root.setAttribute("data-reduce-motion", p.reduceMotion ? "true" : "false");
}

interface A11yContextValue {
  prefs: A11yPrefs;
  setFontScale: (n: number) => void;
  setBackgroundColor: (hex: string | null) => void;
  toggleHighContrast: () => void;
  toggleReduceMotion: () => void;
  reset: () => void;
}

const A11yContext = createContext<A11yContextValue | null>(null);

/** Provides + applies the per-user accessibility prefs (persisted to localStorage). */
export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(() => loadA11yPrefs());

  useEffect(() => {
    applyA11yPrefs(prefs);
    saveA11yPrefs(prefs);
  }, [prefs]);

  const value: A11yContextValue = {
    prefs,
    setFontScale: (n) => setPrefs((p) => ({ ...p, fontScale: clampScale(n) })),
    setBackgroundColor: (hex) => setPrefs((p) => ({ ...p, backgroundColor: cleanColor(hex) })),
    toggleHighContrast: () => setPrefs((p) => ({ ...p, highContrast: !p.highContrast })),
    toggleReduceMotion: () => setPrefs((p) => ({ ...p, reduceMotion: !p.reduceMotion })),
    reset: () => setPrefs(DEFAULT_A11Y),
  };
  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>;
}

export function useA11yPrefs(): A11yContextValue {
  const ctx = useContext(A11yContext);
  if (!ctx) throw new Error("useA11yPrefs must be used within an A11yProvider");
  return ctx;
}

export const A11Y_SCALE_BOUNDS = { min: MIN_SCALE, max: MAX_SCALE };
