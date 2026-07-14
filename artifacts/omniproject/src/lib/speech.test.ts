import { describe, it, expect, afterEach, vi } from "vitest";
import { isSpeechSupported, createDictation, insertIntoField } from "./speech";
import { installFakeSpeechRecognition } from "../test/fake-speech-recognition";

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
    const instances = installFakeSpeechRecognition();

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

describe("createDictation edge cases", () => {
  it("concatenates multiple final results, skips empty alternatives, and ignores whitespace-only output", () => {
    const instances = installFakeSpeechRecognition();
    const captured: string[] = [];
    const dictation = createDictation({ onText: (t) => captured.push(t) })!;
    dictation.start();
    const rec = instances[0]!;
    // one result has no alternative (skipped), two carry text (concatenated + trimmed)
    rec.onresult?.({ results: [[], [{ transcript: "hello " }], [{ transcript: "world" }]] as never });
    expect(captured).toEqual(["hello world"]);
    // whitespace-only utterance produces no callback
    rec.onresult?.({ results: [[{ transcript: "   " }]] });
    expect(captured).toEqual(["hello world"]);
  });

  it("treats a recogniser error as an end-of-session", () => {
    const instances = installFakeSpeechRecognition();
    let ended = 0;
    const dictation = createDictation({ onText: () => {}, onEnd: () => { ended++; } })!;
    dictation.start();
    instances[0]!.onerror?.(new Error("no-speech"));
    expect(ended).toBe(1);
  });

  it("does not throw when no onEnd handler is supplied", () => {
    const instances = installFakeSpeechRecognition();
    const dictation = createDictation({ onText: () => {} })!;
    dictation.start();
    expect(() => instances[0]!.onend?.()).not.toThrow();
    expect(() => instances[0]!.onerror?.(null)).not.toThrow();
  });

  it("swallows start/stop errors from the underlying recogniser", () => {
    class ThrowingRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult = null; onerror = null; onend = null;
      start() { throw new Error("already started"); }
      stop() { throw new Error("already stopped"); }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = ThrowingRecognition;
    const dictation = createDictation({ onText: () => {} })!;
    expect(() => dictation.start()).not.toThrow();
    expect(() => dictation.stop()).not.toThrow();
  });

  it("uses the webkit-prefixed constructor when the standard one is absent", () => {
    const instances: unknown[] = [];
    class WebkitRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult = null; onerror = null; onend = null;
      start = vi.fn(); stop = vi.fn();
      constructor() { instances.push(this); }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = WebkitRecognition;
    expect(isSpeechSupported()).toBe(true);
    const dictation = createDictation({ onText: () => {} });
    expect(dictation).not.toBeNull();
    expect(instances).toHaveLength(1);
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

  it("falls back to a direct value assignment when there is no native setter", () => {
    const input = document.createElement("input");
    const real = Object.getOwnPropertyDescriptor;
    const spy = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((obj, prop) => {
      const d = real(obj, prop);
      if (prop === "value" && d) return { ...d, set: undefined }; // simulate a missing native setter
      return d;
    });
    let fired = 0;
    input.addEventListener("input", () => { fired++; });
    insertIntoField(input, "typed");
    expect(input.value).toBe("typed"); // assigned via the else-branch
    expect(fired).toBe(1);
    spy.mockRestore();
  });
});
