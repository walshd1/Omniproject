import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider, type A11yPrefs, DEFAULT_A11Y } from "../lib/a11y-prefs";
import { SwitchScanner } from "./SwitchScanner";

/**
 * The switch-scan engine: single-switch auto-advances on a timer and selects on
 * Enter/Space; two-switch steps on Space/→ and selects on Enter; "off" is inert.
 */
const MARK = "data-scan-current";

function seed(prefs: Partial<A11yPrefs>): void {
  window.localStorage.setItem("omni:a11y", JSON.stringify({ ...DEFAULT_A11Y, ...prefs }));
}

function renderScanner(): void {
  const Wrapper = ({ children }: { children: ReactNode }) => <A11yProvider>{children}</A11yProvider>;
  render(
    <Wrapper>
      <button>First</button>
      <button>Second</button>
      <button>Third</button>
      <SwitchScanner />
    </Wrapper>,
  );
}

function markedLabel(): string | null {
  return document.querySelector(`[${MARK}="true"]`)?.textContent ?? null;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  // The provider syncs prefs to the server and hydrates on mount; keep it offline.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: false }) })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SwitchScanner", () => {
  it("renders nothing and marks nothing when scanning is off", () => {
    seed({ switchScan: "off" });
    renderScanner();
    expect(document.querySelector('[data-testid="switch-scanner"]')).toBeNull();
    expect(markedLabel()).toBeNull();
  });

  it("single-switch: auto-advances the highlight and selects on Enter", () => {
    vi.useFakeTimers();
    seed({ switchScan: "single", scanRateMs: 1000 });
    renderScanner();

    // Starts on the first control.
    expect(markedLabel()).toBe("First");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(markedLabel()).toBe("Second");

    act(() => { vi.advanceTimersByTime(1000); });
    expect(markedLabel()).toBe("Third");

    // Wrap back round.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(markedLabel()).toBe("First");

    // Selecting clicks the highlighted control.
    const clicked = vi.fn();
    document.querySelectorAll("button").forEach((b) => { if (b.textContent === "First") b.addEventListener("click", clicked); });
    act(() => { fireEvent.keyDown(window, { key: "Enter" }); });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("two-switch: Space advances by hand (no auto-advance) and Enter selects", () => {
    vi.useFakeTimers();
    seed({ switchScan: "two" });
    renderScanner();
    expect(markedLabel()).toBe("First");

    // No timer in two-switch mode: time passing changes nothing.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(markedLabel()).toBe("First");

    act(() => { fireEvent.keyDown(window, { key: " " }); });
    expect(markedLabel()).toBe("Second");

    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    expect(markedLabel()).toBe("Third");
  });
});
