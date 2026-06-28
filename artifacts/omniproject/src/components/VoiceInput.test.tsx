import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider, type A11yPrefs, DEFAULT_A11Y } from "../lib/a11y-prefs";
import { VoiceInput } from "./VoiceInput";

/**
 * The dictation mic appears only when the user opts in AND the browser has speech
 * recognition — never a button that can't work.
 */
function seed(prefs: Partial<A11yPrefs>): void {
  window.localStorage.setItem("omni:a11y", JSON.stringify({ ...DEFAULT_A11Y, ...prefs }));
}

function renderVoice(): void {
  const Wrapper = ({ children }: { children: ReactNode }) => <A11yProvider>{children}</A11yProvider>;
  render(<Wrapper><VoiceInput /></Wrapper>);
}

function enableRecognition(): void {
  class FakeRecognition {
    lang = ""; continuous = false; interimResults = false;
    onresult = null; onerror = null; onend = null;
    start = vi.fn(); stop = vi.fn();
  }
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: false }) })));
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  vi.unstubAllGlobals();
});

describe("VoiceInput", () => {
  it("renders nothing when the browser has no speech recognition", () => {
    seed({ speechInput: true }); // opted in, but unsupported platform
    renderVoice();
    expect(screen.queryByTestId("voice-input")).toBeNull();
  });

  it("renders nothing when supported but the user hasn't opted in", () => {
    enableRecognition();
    seed({ speechInput: false });
    renderVoice();
    expect(screen.queryByTestId("voice-input")).toBeNull();
  });

  it("renders the mic when opted in and supported", () => {
    enableRecognition();
    seed({ speechInput: true });
    renderVoice();
    const mic = screen.getByTestId("voice-input");
    expect(mic).toBeInTheDocument();
    expect(mic).toHaveAttribute("aria-label", "Start voice dictation");
  });
});
