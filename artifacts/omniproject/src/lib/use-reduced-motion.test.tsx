import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider } from "./a11y-prefs";
import { useReducedMotion } from "./use-reduced-motion";

function Probe() {
  return <span data-testid="rm">{useReducedMotion() ? "reduced" : "full"}</span>;
}
const wrap = (ui: ReactNode) => render(<A11yProvider>{ui}</A11yProvider>);

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("useReducedMotion", () => {
  it("is false by default (no OS signal, default prefs)", () => {
    stubMatchMedia(false);
    wrap(<Probe />);
    expect(screen.getByTestId("rm").textContent).toBe("full");
  });

  it("is true when the OS prefers reduced motion", () => {
    stubMatchMedia(true);
    wrap(<Probe />);
    expect(screen.getByTestId("rm").textContent).toBe("reduced");
  });
});
