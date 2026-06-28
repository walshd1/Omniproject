import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { loadA11yPrefs, applyA11yPrefs, DEFAULT_A11Y, A11yProvider } from "./a11y-prefs";
import { A11yControls } from "../components/settings/A11yControls";

/**
 * Per-user accessibility overlay — client-side only, layered over company branding.
 */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-reduce-motion");
  document.documentElement.style.removeProperty("--user-font-scale");
});

describe("a11y-prefs store", () => {
  it("defaults to the company look when nothing is stored", () => {
    expect(loadA11yPrefs()).toEqual(DEFAULT_A11Y);
  });

  it("falls back to defaults on a corrupt stored value (no impact)", () => {
    localStorage.setItem("omni:a11y", "{ not json");
    expect(loadA11yPrefs()).toEqual(DEFAULT_A11Y);
  });

  it("clamps the font scale into the supported range", () => {
    localStorage.setItem("omni:a11y", JSON.stringify({ fontScale: 99 }));
    expect(loadA11yPrefs().fontScale).toBe(1.5);
    localStorage.setItem("omni:a11y", JSON.stringify({ fontScale: 0.1 }));
    expect(loadA11yPrefs().fontScale).toBe(0.85);
  });

  it("applyA11yPrefs writes the CSS var + data-attributes the stylesheet honours", () => {
    applyA11yPrefs({ ...DEFAULT_A11Y, fontScale: 1.2, backgroundColor: "#101418", highContrast: true, reduceMotion: true });
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--user-font-scale")).toBe("1.2");
    expect(root.style.getPropertyValue("--user-bg")).toBe("#101418");
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(root.getAttribute("data-reduce-motion")).toBe("true");
  });
});

describe("A11yControls", () => {
  it("toggles high contrast and persists it client-side", () => {
    render(<A11yProvider><A11yControls /></A11yProvider>);
    fireEvent.click(screen.getByLabelText("High contrast"));
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).highContrast).toBe(true);
  });

  it("increases the text size and reflects the percentage", () => {
    render(<A11yProvider><A11yControls /></A11yProvider>);
    fireEvent.click(screen.getByLabelText("Increase text size"));
    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--user-font-scale")).toBe("1.1");
  });

  it("resets back to the company default", () => {
    render(<A11yProvider><A11yControls /></A11yProvider>);
    fireEvent.click(screen.getByLabelText("Increase text size"));
    fireEvent.click(screen.getByText("Reset to company default"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
