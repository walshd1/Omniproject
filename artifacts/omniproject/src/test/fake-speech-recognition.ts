import { vi, type Mock } from "vitest";

export interface FakeRecognitionInstance {
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: Mock;
  stop: Mock;
}

/**
 * Installs a fake `window.SpeechRecognition` (the Web Speech API constructor
 * `lib/speech.ts` looks for) and returns the instances it constructs, so a test can
 * drive `onresult`/`onend` and inspect the `start`/`stop` spies after triggering
 * whatever code path constructs a recognizer.
 */
export function installFakeSpeechRecognition(): FakeRecognitionInstance[] {
  const instances: FakeRecognitionInstance[] = [];
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: FakeRecognitionInstance["onresult"] = null;
    onerror: FakeRecognitionInstance["onerror"] = null;
    onend: FakeRecognitionInstance["onend"] = null;
    start = vi.fn();
    stop = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  return instances;
}
