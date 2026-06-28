import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
