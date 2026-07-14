import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { loadA11yPrefs, applyA11yPrefs, coerceA11yPrefs, DEFAULT_A11Y, A11yProvider } from "./a11y-prefs";
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
  document.documentElement.style.removeProperty("--user-font-family");
  document.documentElement.style.removeProperty("--user-accent");
  document.documentElement.style.removeProperty("--user-accent-fg");
  document.documentElement.style.removeProperty("--user-bg");
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

  it("applies the per-user font family + accent colour over the org brand layer", () => {
    applyA11yPrefs({ ...DEFAULT_A11Y, fontFamily: "serif", accentColor: "#ff0000" });
    const root = document.documentElement;
    // Named font resolves to its stack (index.css: --user-font-family wins over --brand-font-family).
    expect(root.style.getPropertyValue("--user-font-family")).toContain("serif");
    // Hex accent → HSL channels + legible foreground (index.css: --user-accent wins over --brand-accent).
    expect(root.style.getPropertyValue("--user-accent")).toBe("0 100% 50%");
    expect(root.style.getPropertyValue("--user-accent-fg")).toBe("220 10% 7%");
  });

  it("clears the per-user font/accent vars so the company brand shows through", () => {
    applyA11yPrefs({ ...DEFAULT_A11Y, fontFamily: "mono", accentColor: "#123456" });
    applyA11yPrefs(DEFAULT_A11Y); // null family + null accent
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--user-font-family")).toBe("");
    expect(root.style.getPropertyValue("--user-accent")).toBe("");
    expect(root.style.getPropertyValue("--user-accent-fg")).toBe("");
  });

  it("ignores an unknown font family (falls back to the brand font)", () => {
    localStorage.setItem("omni:a11y", JSON.stringify({ fontFamily: "comic-sans" }));
    expect(loadA11yPrefs().fontFamily).toBeNull();
  });

  it("coerceA11yPrefs validates an imported profile field-by-field (portable .omniprofile)", () => {
    // A hand-authored/imported profile with a mix of good + bad fields is cleaned, never trusted.
    const imported = coerceA11yPrefs({
      fontScale: 99, fontFamily: "serif", accentColor: "#123456", density: "compact",
      backgroundColor: "not-a-colour", switchScan: "bogus", scopedOverrides: { "screen:reports": { accentColor: "#00ff00" }, "__proto__": { accentColor: "#fff" } },
      somethingUnknown: true,
    });
    expect(imported.fontScale).toBe(1.5); // clamped
    expect(imported.fontFamily).toBe("serif");
    expect(imported.accentColor).toBe("#123456");
    expect(imported.density).toBe("compact");
    expect(imported.backgroundColor).toBeNull(); // invalid → null
    expect(imported.switchScan).toBe("off"); // invalid → default
    expect(imported.scopedOverrides["screen:reports"].accentColor).toBe("#00ff00");
    expect(Object.prototype.hasOwnProperty.call(imported.scopedOverrides, "__proto__")).toBe(false);
    expect("somethingUnknown" in imported).toBe(false); // unknown keys dropped
  });

  it("coerceA11yPrefs on empty/garbage input returns the defaults (export→import round-trips)", () => {
    expect(coerceA11yPrefs(null)).toEqual(DEFAULT_A11Y);
    expect(coerceA11yPrefs("garbage")).toEqual(DEFAULT_A11Y);
    // A profile exported from defaults re-imports identically.
    expect(coerceA11yPrefs(JSON.parse(JSON.stringify(DEFAULT_A11Y)))).toEqual(DEFAULT_A11Y);
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

  it("overrides the font family for the user and reflects it on the document", () => {
    render(<Providers><A11yControls /></Providers>);
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "serif" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).fontFamily).toBe("serif");
    expect(document.documentElement.style.getPropertyValue("--user-font-family")).toContain("serif");
    // Back to company default clears the per-user override.
    fireEvent.change(screen.getByLabelText("Font"), { target: { value: "" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).fontFamily).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--user-font-family")).toBe("");
  });

  it("sets a custom accent colour and clears it back to the company default", () => {
    render(<Providers><A11yControls /></Providers>);
    expect(screen.queryByRole("button", { name: "Clear accent colour" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#ff0000" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).accentColor).toBe("#ff0000");
    expect(document.documentElement.style.getPropertyValue("--user-accent")).toBe("0 100% 50%");

    fireEvent.click(screen.getByRole("button", { name: "Clear accent colour" }));
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).accentColor).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--user-accent")).toBe("");
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

  it("imports a portable profile file, applies it, and persists it", async () => {
    render(<Providers><A11yControls /></Providers>);
    const file = new File([JSON.stringify({ fontScale: 1.3, accentColor: "#0000ff", fontFamily: "serif" })], "p.omniprofile.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import profile file"), { target: { files: [file] } });
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--user-font-scale")).toBe("1.3"));
    expect(document.documentElement.style.getPropertyValue("--user-accent")).toBe("240 100% 50%"); // #0000ff
    const persisted = JSON.parse(localStorage.getItem("omni:a11y")!);
    expect(persisted.accentColor).toBe("#0000ff");
    expect(persisted.fontFamily).toBe("serif");
  });

  it("changes the mobile layout mode and reflects whether the layout is currently mobile", () => {
    render(<Providers><A11yControls /></Providers>);
    expect(screen.getByText(/Currently off/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Mobile layout"), { target: { value: "on" } });
    expect(JSON.parse(localStorage.getItem("omni:a11y")!).mobileMode).toBe("on");
    expect(screen.getByText(/Currently on/)).toBeInTheDocument();
  });
});
