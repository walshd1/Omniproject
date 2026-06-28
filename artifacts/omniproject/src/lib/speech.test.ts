import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpeechSupported, createDictation, insertIntoField } from "./speech";

/**
 * Speech-to-text feature detection (the user's own browser engine) and the
 * React-friendly field insertion. We don't ship a recogniser, so when the platform
 * has none every entry point degrades cleanly.
 */
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  vi.restoreAllMocks();
});

describe("feature detection", () => {
  it("reports unsupported when the browser has no recogniser", () => {
    expect(isSpeechSupported()).toBe(false);
    expect(createDictation({ onText: () => {} })).toBeNull();
  });

  it("reports supported, starts/stops, and forwards recognised text", () => {
    const instances: FakeRecognition[] = [];
    class FakeRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() { instances.push(this); }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;

    expect(isSpeechSupported()).toBe(true);
    const captured: string[] = [];
    let ended = false;
    const dictation = createDictation({ onText: (t) => captured.push(t), onEnd: () => { ended = true; } });
    expect(dictation).not.toBeNull();
    dictation!.start();
    const rec = instances[0]!;
    expect(rec.start).toHaveBeenCalledOnce();
    expect(rec.lang).toBe("en-GB");

    rec.onresult?.({ results: [[{ transcript: "hello world" }]] });
    expect(captured).toEqual(["hello world"]);

    rec.onend?.();
    expect(ended).toBe(true);

    dictation!.stop();
    expect(rec.stop).toHaveBeenCalledOnce();
  });
});

describe("insertIntoField", () => {
  it("appends to an input and fires an input event for controlled components", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    let events = 0;
    input.addEventListener("input", () => { events++; });
    insertIntoField(input, "hello");
    expect(input.value).toBe("hello");
    insertIntoField(input, "world");
    expect(input.value).toBe("hello world");
    expect(events).toBe(2);
  });

  it("works on a textarea too", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    insertIntoField(ta, "note");
    expect(ta.value).toBe("note");
  });
});
