/**
 * Speech-to-text via the USER'S OWN system — the browser's native Web Speech API
 * (Chrome/Edge/Safari). We don't ship a recogniser or send audio anywhere: dictation
 * runs on the device, in keeping with the nothing-at-rest ethos. When the platform has
 * no SpeechRecognition, every entry point degrades to "unsupported" and the UI hides
 * the mic — no errors, no half-working button.
 */

// The constructor is vendor-prefixed on some engines; types aren't in the DOM lib.
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as SpeechRecognitionCtor | null;
}

/** Does this device's browser offer on-device speech recognition? */
export function isSpeechSupported(): boolean {
  return getCtor() !== null;
}

export interface Dictation {
  start(): void;
  stop(): void;
}

export interface DictationHandlers {
  /** Final recognised text for an utterance. */
  onText: (text: string) => void;
  /** Recognition ended (user stopped, silence, or error). */
  onEnd?: () => void;
}

/**
 * Build a dictation session over the native recogniser, or null when unsupported.
 * Final results only (no interim noise); the caller decides where the text lands.
 */
export function createDictation(handlers: DictationHandlers, lang = "en-GB"): Dictation | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;

  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) {
      const alt = e.results[i]?.[0];
      if (alt) text += alt.transcript;
    }
    const trimmed = text.trim();
    if (trimmed) handlers.onText(trimmed);
  };
  rec.onend = () => handlers.onEnd?.();
  rec.onerror = () => handlers.onEnd?.();

  return {
    start: () => { try { rec.start(); } catch { /* already started — ignore */ } },
    stop: () => { try { rec.stop(); } catch { /* already stopped — ignore */ } },
  };
}

/**
 * Insert text into a text field the React-friendly way: drive the NATIVE value
 * setter then dispatch an `input` event, so controlled inputs see the change.
 */
export function insertIntoField(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const next = el.value ? `${el.value} ${text}` : text;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
