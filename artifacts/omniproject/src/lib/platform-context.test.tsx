import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider, type A11yPrefs, DEFAULT_A11Y } from "./a11y-prefs";
import { PlatformProvider, usePlatform } from "./platform-context";

/**
 * The platform context resolves the mobile-mode pref against the live form factor and
 * reflects it onto the document root for the stylesheet.
 */
function seed(prefs: Partial<A11yPrefs>): void {
  window.localStorage.setItem("omni:a11y", JSON.stringify({ ...DEFAULT_A11Y, ...prefs }));
}

function Probe(): React.ReactElement {
  const { isMobile, platform } = usePlatform();
  return <div data-testid="probe" data-mobile={String(isMobile)} data-ff={platform.formFactor} />;
}

function renderPlatform(): void {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <A11yProvider><PlatformProvider>{children}</PlatformProvider></A11yProvider>
  );
  render(<Wrapper><Probe /></Wrapper>);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-mobile");
  document.documentElement.removeAttribute("data-form-factor");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: false }) })));
});

afterEach(() => vi.unstubAllGlobals());

describe("PlatformProvider", () => {
  it("defaults to desktop (no touch) and sets the document data-attributes", () => {
    seed({ mobileMode: "auto" });
    renderPlatform();
    expect(screen.getByTestId("probe")).toHaveAttribute("data-mobile", "false");
    expect(document.documentElement.getAttribute("data-form-factor")).toBe("desktop");
    expect(document.documentElement.getAttribute("data-mobile")).toBe("false");
  });

  it("forces mobile layout on when the user overrides to 'on'", () => {
    seed({ mobileMode: "on" });
    renderPlatform();
    expect(screen.getByTestId("probe")).toHaveAttribute("data-mobile", "true");
    expect(document.documentElement.getAttribute("data-mobile")).toBe("true");
  });

  it("forces it off even on a small device when overridden to 'off'", () => {
    vi.stubGlobal("innerWidth", 360);
    seed({ mobileMode: "off" });
    renderPlatform();
    expect(screen.getByTestId("probe")).toHaveAttribute("data-mobile", "false");
  });

  it("re-detects on resize and updates the document attributes when the form factor changes", () => {
    // Run the coalescing rAF synchronously so the resize handler settles within act().
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    seed({ mobileMode: "auto" });
    renderPlatform();
    expect(document.documentElement.getAttribute("data-form-factor")).toBe("desktop");

    vi.stubGlobal("innerWidth", 360); // shrink below the mobile ceiling
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(document.documentElement.getAttribute("data-form-factor")).toBe("mobile");
    expect(document.documentElement.getAttribute("data-mobile")).toBe("true");
    expect(screen.getByTestId("probe")).toHaveAttribute("data-ff", "mobile");
  });

  it("keeps the existing snapshot (no re-render) when a resize changes nothing", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    seed({ mobileMode: "auto" });
    renderPlatform();
    const before = screen.getByTestId("probe").getAttribute("data-ff");
    // Same environment → identical signature → the provider returns `prev` unchanged.
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(screen.getByTestId("probe")).toHaveAttribute("data-ff", before!);
  });

  it("re-detects on orientationchange and on the standalone display-mode change, and cleans up its listeners", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    // A controllable display-mode media query so we can drive the `change` listener and
    // assert it is torn down on unmount.
    let displayModeChange: (() => void) | undefined;
    const removeEventListener = vi.fn();
    const mql = {
      matches: false,
      addEventListener: (_e: string, h: () => void) => { displayModeChange = h; },
      removeEventListener,
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mql));

    seed({ mobileMode: "auto" });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <A11yProvider><PlatformProvider>{children}</PlatformProvider></A11yProvider>
    );
    const { unmount } = render(<Wrapper><Probe /></Wrapper>);

    // Both the orientation and the display-mode subscriptions run the re-detect path.
    act(() => { window.dispatchEvent(new Event("orientationchange")); });
    expect(displayModeChange).toBeTypeOf("function");
    act(() => { displayModeChange?.(); });
    expect(screen.getByTestId("probe")).toBeInTheDocument();

    unmount();
    // Cleanup removes the display-mode change subscription.
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});

describe("usePlatform", () => {
  it("throws when used outside a PlatformProvider", () => {
    // Silence the React error-boundary console noise from the intentional throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow(/must be used within a PlatformProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
