import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider } from "../lib/a11y-prefs";
import { SkeletonText, SkeletonRows, SkeletonCards } from "./Skeletons";

const wrap = (ui: ReactNode) => render(<A11yProvider>{ui}</A11yProvider>);

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("Skeletons", () => {
  it("SkeletonRows renders the requested number of placeholder rows", () => {
    stubMatchMedia(false);
    wrap(<SkeletonRows rows={5} />);
    const root = screen.getByTestId("skeleton");
    expect(root.children).toHaveLength(5);
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonText renders the requested number of lines", () => {
    stubMatchMedia(false);
    wrap(<SkeletonText lines={4} />);
    expect(screen.getByTestId("skeleton").children).toHaveLength(4);
  });

  it("SkeletonCards renders the requested number of cards", () => {
    stubMatchMedia(false);
    wrap(<SkeletonCards count={3} />);
    expect(screen.getByTestId("skeleton").children).toHaveLength(3);
  });

  it("pulses by default but is static under reduced motion", () => {
    stubMatchMedia(false);
    const { unmount } = wrap(<SkeletonRows rows={1} />);
    expect(screen.getByTestId("skeleton").innerHTML).toContain("animate-pulse");
    unmount();

    stubMatchMedia(true); // OS prefers reduced motion
    wrap(<SkeletonRows rows={1} />);
    expect(screen.getByTestId("skeleton").innerHTML).not.toContain("animate-pulse");
  });
});
