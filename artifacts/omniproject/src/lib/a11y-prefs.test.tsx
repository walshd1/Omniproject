import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { loadA11yPrefs, applyA11yPrefs, DEFAULT_A11Y, A11yProvider } from "./a11y-prefs";
import { PlatformProvider } from "./platform-context";
import { A11yControls } from "../components/settings/A11yControls";

// A11yControls reads both the prefs and the platform context.
const Providers = ({ children }: { children: ReactNode }) => (
  <A11yProvider><PlatformProvider>{children}</PlatformProvider></A11yProvider>
);

/**
 * Per-user accessibility overlay — client-side only, layered over company branding.
 */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-reduce-motion");
  document.documentElement.removeAttribute("data-density");
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

  it("defaults density to comfortable and round-trips a stored compact value", () => {
    expect(loadA11yPrefs().density).toBe("comfortable");
    localStorage.setItem("omni:a11y", JSON.stringify({ density: "compact" }));
    expect(loadA11yPrefs().density).toBe("compact");
  });

  it("falls back to comfortable on an unknown density value", () => {
    localStorage.setItem("omni:a11y", JSON.stringify({ density: "nonsense" }));
    expect(loadA11yPrefs().density).toBe("comfortable");
  });

  it("applyA11yPrefs reflects density on the data-density attribute the stylesheet keys off", () => {
    applyA11yPrefs({ ...DEFAULT_A11Y, density: "compact" });
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    applyA11yPrefs({ ...DEFAULT_A11Y, density: "comfortable" });
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
  });
});

describe("A11yControls", () => {
  it("toggles high contrast and persists it client-side", () => {
    render(<Providers><A11yControls /></Providers>);
    fireEvent.click(screen.getByLabelText("High contrast"));
    expect(document.documentElement.getAttribute("data-contrast")).toBe("high");
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).highContrast).toBe(true);
  });

  it("increases the text size and reflects the percentage", () => {
    render(<Providers><A11yControls /></Providers>);
    fireEvent.click(screen.getByLabelText("Increase text size"));
    expect(screen.getByText("110%")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--user-font-scale")).toBe("1.1");
  });

  it("resets back to the company default", () => {
    render(<Providers><A11yControls /></Providers>);
    fireEvent.click(screen.getByLabelText("Increase text size"));
    fireEvent.click(screen.getByText("Reset to company default"));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("switches UI density to compact and persists it client-side", () => {
    render(<Providers><A11yControls /></Providers>);
    const compact = screen.getByRole("button", { name: "Compact" });
    expect(compact).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(compact);
    expect(compact).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).density).toBe("compact");
  });

  it("decreases the text size and reflects the percentage", () => {
    render(<Providers><A11yControls /></Providers>);
    fireEvent.click(screen.getByLabelText("Decrease text size"));
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--user-font-scale")).toBe("0.9");
  });

  it("sets a custom background colour and clears it back to the company default", () => {
    render(<Providers><A11yControls /></Providers>);
    expect(screen.queryByRole("button", { name: "Clear background colour" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Background colour"), { target: { value: "#112233" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).backgroundColor).toBe("#112233");
    expect((screen.getByLabelText("Background colour") as HTMLInputElement).value).toBe("#112233");

    fireEvent.click(screen.getByRole("button", { name: "Clear background colour" }));
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).backgroundColor).toBeNull();
    expect((screen.getByLabelText("Background colour") as HTMLInputElement).value).toBe("#f2f3f5");
    expect(screen.queryByRole("button", { name: "Clear background colour" })).not.toBeInTheDocument();
  });

  it("switching to single-switch scanning reveals the scan-rate slider, which adjusts the dwell time", () => {
    render(<Providers><A11yControls /></Providers>);
    expect(screen.queryByLabelText("Auto-scan dwell time")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Switch-access scanning"), { target: { value: "single" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).switchScan).toBe("single");
    const slider = screen.getByLabelText("Auto-scan dwell time");
    expect(screen.getByText("1.50s")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "2500" } });
    expect(screen.getByText("2.50s")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).scanRateMs).toBe(2500);

    fireEvent.change(screen.getByLabelText("Switch-access scanning"), { target: { value: "off" } });
    expect(screen.queryByLabelText("Auto-scan dwell time")).not.toBeInTheDocument();
  });

  it("changes the mobile layout mode and reflects whether the layout is currently mobile", () => {
    render(<Providers><A11yControls /></Providers>);
    expect(screen.getByText(/Currently off/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Mobile layout"), { target: { value: "on" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).mobileMode).toBe("on");
    expect(screen.getByText(/Currently on/)).toBeInTheDocument();
  });
});
