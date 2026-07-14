import { createContext, useContext, useMemo, useState, useCallback, type ReactNode, type CSSProperties } from "react";
import { useA11yPrefsOptional, type ScopedOverride } from "./a11y-prefs";
import { brandTokensFromHex } from "./color";
import { FONT_STACKS } from "./artifact-style";

/**
 * Per-screen / per-artifact theme overrides — "Mode 2" on top of the GLOBAL per-user override
 * (lib/a11y-prefs) and the company branding. Two persistence modes, per the product spec:
 *   - SESSION-only: held in memory here (a true one-off for this browser session).
 *   - SAVED: persisted to the user's profile JSON via lib/a11y-prefs (`scopedOverrides`), so it
 *     follows the user across devices.
 * Precedence for a given surface: session override → saved override → global user → brand → default.
 *
 * A scope is applied by re-declaring the FINAL accent tokens (`--primary` and the ring/sidebar
 * variants) plus font-family/background on the surface's own element. This matters: `--primary` is
 * resolved at `:root` (as `hsl(var(--primary))` everywhere), so setting `--user-accent` alone below
 * root would NOT re-resolve — the concrete tokens must be set on the scope element itself.
 */

export type { ScopedOverride };

/** Build the inline style that applies a scoped override to a surface. Only the fields the override
 *  actually sets are emitted; everything else inherits the global layer. */
export function scopeStyle(o: ScopedOverride | null | undefined): CSSProperties {
  const style: Record<string, string> = {};
  if (!o) return style as CSSProperties;
  if (o.fontFamily) style.fontFamily = FONT_STACKS[o.fontFamily];
  if (o.accentColor) {
    const t = brandTokensFromHex(o.accentColor);
    if (t) {
      style["--primary"] = t.channels;
      style["--ring"] = t.channels;
      style["--sidebar-primary"] = t.channels;
      style["--sidebar-ring"] = t.channels;
      style["--primary-foreground"] = t.fg;
      style["--sidebar-primary-foreground"] = t.fg;
    }
  }
  if (o.backgroundColor) style.backgroundColor = o.backgroundColor;
  return style as CSSProperties;
}

/** Whether an override carries any visible styling. */
export function hasScopedStyle(o: ScopedOverride | null | undefined): boolean {
  return !!o && (o.fontFamily != null || o.accentColor != null || o.backgroundColor != null);
}

interface ThemeScopeContextValue {
  session: Record<string, ScopedOverride>;
  setSession: (scopeId: string, override: ScopedOverride | null) => void;
}
const ThemeScopeContext = createContext<ThemeScopeContextValue | null>(null);

/** Holds the SESSION-only scoped overrides (memory, never persisted). Saved overrides live in
 *  lib/a11y-prefs. Mount once, above the routed app. */
export function ThemeScopeProvider({ children }: { children: ReactNode }) {
  const [session, setSessionMap] = useState<Record<string, ScopedOverride>>({});
  const setSession = useCallback((scopeId: string, override: ScopedOverride | null) => {
    setSessionMap((prev) => {
      const next = { ...prev };
      if (!override || !hasScopedStyle(override)) delete next[scopeId];
      else next[scopeId] = override;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ session, setSession }), [session, setSession]);
  return <ThemeScopeContext.Provider value={value}>{children}</ThemeScopeContext.Provider>;
}

export interface ScopedThemeApi {
  /** The override in effect (session wins over saved), or null. */
  effective: ScopedOverride | null;
  /** True when a SAVED (persisted) override exists for this scope. */
  savedActive: boolean;
  /** True when a SESSION-only override is in effect for this scope. */
  sessionActive: boolean;
  /** Apply a session-only override (the default "one-off"). Null clears the session entry. */
  setSessionOverride: (override: ScopedOverride | null) => void;
  /** Promote the current effective override to the user's saved profile, clearing the session copy. */
  saveToProfile: () => void;
  /** Clear both the session and the saved override for this scope. */
  clear: () => void;
}

/** Read + control the scoped theme for one surface id (e.g. "screen:reports", "artifact:report:x"). */
export function useScopedTheme(scopeId: string): ScopedThemeApi {
  const ctx = useContext(ThemeScopeContext);
  const a11y = useA11yPrefsOptional();
  const setSavedScope = a11y?.setSavedScope ?? (() => {});
  const saved = a11y?.prefs.scopedOverrides[scopeId] ?? null;
  const session = ctx?.session[scopeId] ?? null;
  const effective = session ?? saved;
  return {
    effective,
    savedActive: hasScopedStyle(saved),
    sessionActive: hasScopedStyle(session),
    setSessionOverride: (o) => ctx?.setSession(scopeId, o),
    saveToProfile: () => { setSavedScope(scopeId, effective); ctx?.setSession(scopeId, null); },
    clear: () => { ctx?.setSession(scopeId, null); setSavedScope(scopeId, null); },
  };
}

/** Wrap a screen so a per-user scoped override applies to just this subtree. Renders a stable
 *  wrapper element (so toggling an override never remounts the page). */
export function ThemeScope({ scopeId, className, children }: { scopeId: string; className?: string; children: ReactNode }) {
  const { effective } = useScopedTheme(scopeId);
  return <div className={className} style={scopeStyle(effective)} data-theme-scope={scopeId}>{children}</div>;
}
