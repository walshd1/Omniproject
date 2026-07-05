import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { A11yProvider, type A11yPrefs, DEFAULT_A11Y } from "../lib/a11y-prefs";
import { installFakeSpeechRecognition } from "../test/fake-speech-recognition";
import { VoiceInput } from "./VoiceInput";

/**
 * The dictation mic appears only when the user opts in AND the browser has speech
 * recognition — never a button that can't work.
 */
function seed(prefs: Partial<A11yPrefs>): void {
  window.localStorage.setItem("omni:a11y", JSON.stringify({ ...DEFAULT_A11Y, ...prefs }));
}

const A11yWrapper = ({ children }: { children: ReactNode }) => <A11yProvider>{children}</A11yProvider>;

function renderVoice(): void {
  render(<A11yWrapper><VoiceInput /></A11yWrapper>);
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
    installFakeSpeechRecognition();
    seed({ speechInput: false });
    renderVoice();
    expect(screen.queryByTestId("voice-input")).toBeNull();
  });

  it("renders the mic when opted in and supported", () => {
    installFakeSpeechRecognition();
    seed({ speechInput: true });
    renderVoice();
    const mic = screen.getByTestId("voice-input");
    expect(mic).toBeInTheDocument();
    expect(mic).toHaveAttribute("aria-label", "Start voice dictation");
  });
});

/**
 * Click-driven behavior: capturing the focused field, starting/stopping the native
 * recognizer, routing recognized text back into that field, and cleaning up on
 * unmount — none of the tests above ever click the mic.
 */
describe("VoiceInput interactions", () => {
  function renderVoiceWithField() {
    const result = render(
      <A11yWrapper>
        <input data-testid="target" type="text" />
        <VoiceInput />
      </A11yWrapper>,
    );
    const input = screen.getByTestId("target") as HTMLInputElement;
    input.focus();
    return { ...result, input };
  }

  // Shared setup for every test that needs dictation already listening: seed the
  // opt-in pref, render with a focused field, and press the mic once.
  function startDictation() {
    const instances = installFakeSpeechRecognition();
    seed({ speechInput: true });
    const { input, unmount } = renderVoiceWithField();
    fireEvent.click(screen.getByTestId("voice-input"));
    return { instances, input, unmount };
  }

  it("announces and never constructs a recognizer when no field is focused", () => {
    const instances = installFakeSpeechRecognition();
    seed({ speechInput: true });
    renderVoice(); // no text field in the tree, so document.activeElement is <body>
    fireEvent.click(screen.getByTestId("voice-input"));

    expect(screen.getByTestId("a11y-announcer")).toHaveTextContent(
      "Click into a text field first, then start dictation.",
    );
    expect(instances.length).toBe(0);
    expect(screen.getByTestId("voice-input")).toHaveAttribute("aria-label", "Start voice dictation");
  });

  it("starts dictation targeting the focused field, flips aria state, and announces", () => {
    const { instances } = startDictation();

    expect(instances.length).toBe(1);
    expect(instances[0]!.start).toHaveBeenCalledTimes(1);
    const mic = screen.getByTestId("voice-input");
    expect(mic).toHaveAttribute("aria-pressed", "true");
    expect(mic).toHaveAttribute("aria-label", "Stop dictation");
    expect(screen.getByTestId("a11y-announcer")).toHaveTextContent("Listening — speak now.");
  });

  it("stops dictation on a second click", () => {
    const { instances } = startDictation();
    fireEvent.click(screen.getByTestId("voice-input")); // stop

    expect(instances[0]!.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-input")).toHaveAttribute("aria-label", "Start voice dictation");
    expect(screen.getByTestId("voice-input")).toHaveAttribute("aria-pressed", "false");
  });

  it("inserts the recognized text into the field that was focused when dictation started", () => {
    const { instances, input } = startDictation();
    instances[0]!.onresult!({ results: [[{ transcript: "hello world" }]] });

    expect(input.value).toBe("hello world");
  });

  it("automatically reverts to the idle state when recognition ends on its own (e.g. silence)", () => {
    const { instances } = startDictation();
    // onend fires from the (fake) recognizer, outside any DOM event React instruments,
    // so the resulting setState must be wrapped in act() explicitly.
    act(() => instances[0]!.onend!());

    expect(screen.getByTestId("voice-input")).toHaveAttribute("aria-label", "Start voice dictation");
  });

  it("stops any in-flight dictation session when the component unmounts", () => {
    const { instances, unmount } = startDictation();
    unmount();

    expect(instances[0]!.stop).toHaveBeenCalledTimes(1);
  });
});
