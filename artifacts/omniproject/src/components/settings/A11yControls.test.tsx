import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockBlobDownload } from "../../test/utils";
import type { A11yPrefs } from "../../lib/a11y-prefs";

/**
 * A11yControls is the per-user accessibility overlay panel. It's a thin, stateless renderer over the
 * `useA11yPrefs` context: every control reads a pref and calls a setter. We mock the hook (keeping the
 * real A11Y_SCALE_BOUNDS), `usePlatform` and `isSpeechSupported`, then drive each control and assert the
 * matching setter fires — covering the text-size bounds, colour clears, the switch-scan/scan-rate reveal,
 * the speech-unsupported gate, the mobile status line, and the export / import / reset actions.
 */
const h = vi.hoisted(() => ({
  prefs: { current: null as unknown as A11yPrefs },
  platform: { current: { isMobile: false, platform: { formFactor: "desktop" } } },
  speech: { current: true },
  spies: {
    setFontScale: vi.fn(), setFontFamily: vi.fn(), setAccentColor: vi.fn(), setBackgroundColor: vi.fn(),
    toggleHighContrast: vi.fn(), toggleTint: vi.fn(), setTintColor: vi.fn(), toggleReduceMotion: vi.fn(),
    setSwitchScan: vi.fn(), setScanRate: vi.fn(), toggleScreenReader: vi.fn(), toggleSpeechInput: vi.fn(),
    setMobileMode: vi.fn(), setDensity: vi.fn(), importProfile: vi.fn(), reset: vi.fn(),
  },
}));

vi.mock("../../lib/a11y-prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/a11y-prefs")>();
  return { ...actual, useA11yPrefs: () => ({ prefs: h.prefs.current, ...h.spies }) };
});
vi.mock("../../lib/platform-context", () => ({ usePlatform: () => h.platform.current }));
vi.mock("../../lib/speech", () => ({ isSpeechSupported: () => h.speech.current }));

import { A11yControls } from "./A11yControls";

function makePrefs(over: Partial<A11yPrefs> = {}): A11yPrefs {
  return {
    fontScale: 1, fontFamily: null, accentColor: null, backgroundColor: null, highContrast: false,
    tint: false, tintColor: "#f5e9c8", reduceMotion: false, switchScan: "off", scanRateMs: 1500,
    screenReader: false, speechInput: false, mobileMode: "auto", density: "comfortable", scopedOverrides: {},
    ...over,
  };
}

beforeEach(() => {
  Object.values(h.spies).forEach((s) => s.mockClear());
  h.prefs.current = makePrefs();
  h.platform.current = { isMobile: false, platform: { formFactor: "desktop" } };
  h.speech.current = true;
});

describe("A11yControls", () => {
  it("renders the panel with the current text scale as a percentage", () => {
    h.prefs.current = makePrefs({ fontScale: 1.2 });
    render(<A11yControls />);
    expect(screen.getByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByText("120%")).toBeInTheDocument();
  });

  it("steps the text size up and down", () => {
    render(<A11yControls />);
    fireEvent.click(screen.getByLabelText("Increase text size"));
    fireEvent.click(screen.getByLabelText("Decrease text size"));
    expect(h.spies.setFontScale).toHaveBeenCalledWith(1.1);
    expect(h.spies.setFontScale).toHaveBeenCalledWith(0.9);
  });

  it("disables the decrease button at the minimum scale", () => {
    h.prefs.current = makePrefs({ fontScale: 0.85 });
    render(<A11yControls />);
    expect(screen.getByLabelText("Decrease text size")).toBeDisabled();
    expect(screen.getByLabelText("Increase text size")).not.toBeDisabled();
  });

  it("disables the increase button at the maximum scale", () => {
    h.prefs.current = makePrefs({ fontScale: 1.5 });
    render(<A11yControls />);
    expect(screen.getByLabelText("Increase text size")).toBeDisabled();
  });

  it("sets a named font and clears back to the company default", () => {
    render(<A11yControls />);
    const select = screen.getByLabelText("Font") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "serif" } });
    expect(h.spies.setFontFamily).toHaveBeenCalledWith("serif");
    fireEvent.change(select, { target: { value: "" } });
    expect(h.spies.setFontFamily).toHaveBeenCalledWith(null);
  });

  it("changes the accent colour and shows a Clear button only when set", () => {
    render(<A11yControls />);
    // Default (null) accent ⇒ no clear button.
    expect(screen.queryByLabelText("Clear accent colour")).toBeNull();
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#123456" } });
    expect(h.spies.setAccentColor).toHaveBeenCalledWith("#123456");
  });

  it("clears the accent and background colours when they are set", () => {
    h.prefs.current = makePrefs({ accentColor: "#abcdef", backgroundColor: "#ffffff" });
    render(<A11yControls />);
    fireEvent.click(screen.getByLabelText("Clear accent colour"));
    fireEvent.click(screen.getByLabelText("Clear background colour"));
    expect(h.spies.setAccentColor).toHaveBeenCalledWith(null);
    expect(h.spies.setBackgroundColor).toHaveBeenCalledWith(null);
  });

  it("changes the background colour", () => {
    render(<A11yControls />);
    fireEvent.change(screen.getByLabelText("Background colour"), { target: { value: "#eeeeee" } });
    expect(h.spies.setBackgroundColor).toHaveBeenCalledWith("#eeeeee");
  });

  it("toggles high contrast, reduce motion and screen-reader narration", () => {
    render(<A11yControls />);
    fireEvent.click(document.getElementById("a11y-contrast")!);
    fireEvent.click(document.getElementById("a11y-motion")!);
    fireEvent.click(document.getElementById("a11y-reader")!);
    expect(h.spies.toggleHighContrast).toHaveBeenCalled();
    expect(h.spies.toggleReduceMotion).toHaveBeenCalled();
    expect(h.spies.toggleScreenReader).toHaveBeenCalled();
  });

  it("toggles the reading tint and edits the tint colour (enabled only when tint is on)", () => {
    // Tint off ⇒ the colour input is disabled.
    render(<A11yControls />);
    expect(screen.getByLabelText("Tint colour")).toBeDisabled();
    fireEvent.click(document.getElementById("a11y-tint")!);
    expect(h.spies.toggleTint).toHaveBeenCalled();
  });

  it("edits the tint colour when the tint is on", () => {
    h.prefs.current = makePrefs({ tint: true });
    render(<A11yControls />);
    const tintColor = screen.getByLabelText("Tint colour");
    expect(tintColor).not.toBeDisabled();
    fireEvent.change(tintColor, { target: { value: "#abcabc" } });
    expect(h.spies.setTintColor).toHaveBeenCalledWith("#abcabc");
  });

  it("switches the layout density", () => {
    render(<A11yControls />);
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(h.spies.setDensity).toHaveBeenCalledWith("compact");
    // The currently-selected density is pressed.
    expect(screen.getByRole("button", { name: "Comfortable" })).toHaveAttribute("aria-pressed", "true");
  });

  it("changes the switch-scan mode; the scan-rate slider stays hidden unless single-switch", () => {
    render(<A11yControls />);
    expect(screen.queryByLabelText("Auto-scan dwell time")).toBeNull();
    fireEvent.change(screen.getByLabelText("Switch-access scanning"), { target: { value: "single" } });
    expect(h.spies.setSwitchScan).toHaveBeenCalledWith("single");
  });

  it("reveals and drives the scan-rate slider in single-switch mode", () => {
    h.prefs.current = makePrefs({ switchScan: "single", scanRateMs: 2000 });
    render(<A11yControls />);
    const slider = screen.getByLabelText("Auto-scan dwell time");
    expect(screen.getByText("2.00s")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "3000" } });
    expect(h.spies.setScanRate).toHaveBeenCalledWith(3000);
  });

  it("enables voice dictation when speech is supported", () => {
    render(<A11yControls />);
    expect(screen.queryByText("Not available in this browser.")).toBeNull();
    const speechSwitch = document.getElementById("a11y-speech")!;
    expect(speechSwitch).not.toBeDisabled();
    fireEvent.click(speechSwitch);
    expect(h.spies.toggleSpeechInput).toHaveBeenCalled();
  });

  it("disables voice dictation and explains when speech is unsupported", () => {
    h.speech.current = false;
    render(<A11yControls />);
    expect(screen.getByText("Not available in this browser.")).toBeInTheDocument();
    expect(document.getElementById("a11y-speech")!).toBeDisabled();
  });

  it("reflects the effective mobile layout and lets the user force it", () => {
    h.platform.current = { isMobile: true, platform: { formFactor: "phone" } };
    render(<A11yControls />);
    expect(screen.getByText(/Currently on \(phone\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mobile layout"), { target: { value: "off" } });
    expect(h.spies.setMobileMode).toHaveBeenCalledWith("off");
  });

  it("exports the portable profile as a downloaded JSON file", () => {
    const dl = mockBlobDownload();
    try {
      render(<A11yControls />);
      fireEvent.click(screen.getByRole("button", { name: "Export" }));
      expect(dl.click).toHaveBeenCalled();
    } finally {
      dl.restore();
    }
  });

  it("opens the file picker from the Import button", () => {
    render(<A11yControls />);
    const fileInput = screen.getByLabelText("Import profile file");
    const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("imports a valid profile file", async () => {
    render(<A11yControls />);
    const fileInput = screen.getByLabelText("Import profile file");
    const file = new File(['{"fontScale":1.3}'], "omniprofile.json", { type: "application/json" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(h.spies.importProfile).toHaveBeenCalledWith({ fontScale: 1.3 }));
  });

  it("ignores an invalid (non-JSON) import file without applying anything", async () => {
    render(<A11yControls />);
    const fileInput = screen.getByLabelText("Import profile file");
    const file = new File(["not json at all"], "bad.json", { type: "application/json" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    // Give the async handler a tick; importProfile must never be called for bad input.
    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.importProfile).not.toHaveBeenCalled();
  });

  it("does nothing when the import dialog is dismissed with no file", async () => {
    render(<A11yControls />);
    const fileInput = screen.getByLabelText("Import profile file");
    fireEvent.change(fileInput, { target: { files: [] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.spies.importProfile).not.toHaveBeenCalled();
  });

  it("resets to the company default", () => {
    render(<A11yControls />);
    fireEvent.click(screen.getByRole("button", { name: /Reset to company default/ }));
    expect(h.spies.reset).toHaveBeenCalled();
  });
});

afterEach(() => vi.restoreAllMocks());
