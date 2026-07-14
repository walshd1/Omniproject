import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider } from "./a11y-prefs";
import { ThemeScopeProvider, useScopedTheme, scopeStyle, hasScopedStyle, ThemeScope } from "./theme-scope";
import { ScopedThemeControl } from "../components/settings/ScopedThemeControl";

/**
 * Mode-2 scoped theme overrides: per-screen / per-artifact, session-only by default, saveable to the
 * user's profile. Precedence: session → saved → global.
 */
const wrapper = ({ children }: { children: ReactNode }) => (
  <A11yProvider><ThemeScopeProvider>{children}</ThemeScopeProvider></A11yProvider>
);

const stored = () => JSON.parse(localStorage.getItem("omni:a11y") ?? "{}");

beforeEach(() => localStorage.clear());

describe("scopeStyle", () => {
  it("emits the FINAL accent tokens + font + background for the set fields only", () => {
    const s = scopeStyle({ fontFamily: "serif", accentColor: "#ff0000", backgroundColor: "#111111" }) as Record<string, string>;
    // Final tokens (not --user-accent) so hsl(var(--primary)) re-resolves inside the subtree.
    expect(s["--primary"]).toBe("0 100% 50%");
    expect(s["--ring"]).toBe("0 100% 50%");
    expect(s["--sidebar-primary"]).toBe("0 100% 50%");
    expect(s.fontFamily).toContain("serif");
    expect(s.backgroundColor).toBe("#111111");
  });
  it("is empty for a null/empty override", () => {
    expect(scopeStyle(null)).toEqual({});
    expect(hasScopedStyle({})).toBe(false);
    expect(hasScopedStyle({ accentColor: "#fff" })).toBe(true);
  });
});

describe("useScopedTheme precedence + persistence", () => {
  it("session wins over saved; save promotes to profile; clear removes both", () => {
    const { result } = renderHook(() => useScopedTheme("screen:reports"), { wrapper });
    expect(result.current.effective).toBeNull();

    act(() => result.current.setSessionOverride({ accentColor: "#00ff00" }));
    expect(result.current.effective).toEqual({ accentColor: "#00ff00" });
    expect(result.current.sessionActive).toBe(true);
    expect(result.current.savedActive).toBe(false);
    expect(stored().scopedOverrides?.["screen:reports"]).toBeUndefined(); // session-only, not persisted

    act(() => result.current.saveToProfile());
    expect(result.current.savedActive).toBe(true);
    expect(result.current.sessionActive).toBe(false);
    expect(stored().scopedOverrides["screen:reports"].accentColor).toBe("#00ff00"); // now persisted

    act(() => result.current.clear());
    expect(result.current.effective).toBeNull();
    expect(stored().scopedOverrides["screen:reports"]).toBeUndefined();
  });

  it("a session override shadows a previously-saved one for the same scope", () => {
    const { result } = renderHook(() => useScopedTheme("screen:x"), { wrapper });
    act(() => { result.current.setSessionOverride({ accentColor: "#111111" }); });
    act(() => { result.current.saveToProfile(); }); // saved = #111111
    act(() => { result.current.setSessionOverride({ accentColor: "#222222" }); }); // session shadows it
    expect(result.current.effective).toEqual({ accentColor: "#222222" });
    expect(stored().scopedOverrides["screen:x"].accentColor).toBe("#111111"); // saved unchanged
  });
});

describe("ThemeScope", () => {
  it("applies the effective override's vars on its wrapper element", () => {
    function Harness() {
      const { setSessionOverride } = useScopedTheme("screen:x");
      return (
        <>
          <button onClick={() => setSessionOverride({ accentColor: "#ff0000" })}>set</button>
          <ThemeScope scopeId="screen:x"><span>content</span></ThemeScope>
        </>
      );
    }
    render(<Harness />, { wrapper });
    const el = () => document.querySelector('[data-theme-scope="screen:x"]') as HTMLElement;
    expect(el().style.getPropertyValue("--primary")).toBe(""); // no override yet
    fireEvent.click(screen.getByText("set"));
    expect(el().style.getPropertyValue("--primary")).toBe("0 100% 50%");
  });
});

describe("ScopedThemeControl", () => {
  it("edits apply to the session and Save persists to the profile", () => {
    render(<ScopedThemeControl scopeId="screen:reports" label="Reports screen" />, { wrapper });
    fireEvent.click(screen.getByLabelText("Theme for Reports screen"));
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#0000ff" } });
    // Not yet saved — session only.
    expect(stored().scopedOverrides?.["screen:reports"]).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Save to profile" }));
    expect(stored().scopedOverrides["screen:reports"].accentColor).toBe("#0000ff");
  });
});
