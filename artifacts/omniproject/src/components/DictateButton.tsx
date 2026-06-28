import { useEffect, useRef, useState } from "react";
import { createDictation, isSpeechSupported, type Dictation } from "../lib/speech";

/**
 * Dictate-into-a-field button. Uses the user's OWN local speech engine (lib/speech —
 * the browser's on-device/OS recogniser), so audio never leaves the machine: voice is the
 * lowest-risk input. Renders nothing when the engine is unavailable (feature-detected).
 * A cloud Whisper engine could be offered later as a governance-gated, audio-egress option.
 */
export function DictateButton({ onText, lang = "en-GB" }: { onText: (text: string) => void; lang?: string }) {
  const [listening, setListening] = useState(false);
  const sessionRef = useRef<Dictation | null>(null);

  // Latest onText without re-creating the session each render.
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  if (!isSpeechSupported()) return null;

  const toggle = (): void => {
    if (listening) { sessionRef.current?.stop(); return; }
    const session = createDictation(
      { onText: (t) => onTextRef.current(t), onEnd: () => setListening(false) },
      lang,
    );
    if (!session) return;
    sessionRef.current = session;
    session.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="dictate-button"
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Dictate (local speech)"}
      title="Dictate with your device's own speech engine (audio stays local)"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-sm ${listening ? "bg-red-100 text-red-700" : "text-muted-foreground"}`}
    >
      {listening ? "■" : "🎤"}
    </button>
  );
}
