import { useEffect, useRef, useState } from "react";
import { createDictation, isSpeechSupported, type Dictation } from "../lib/speech";
import { useSttStatus, startRecording, transcribeClip, isRecordingSupported, type Recorder } from "../lib/stt";

/**
 * Dictate-into-a-field button. AI-assisted, provider-pluggable speech-to-text:
 *
 *  - "browser" (default): the user's OWN on-device recogniser (lib/speech). Audio never
 *    leaves the machine — the lowest-risk input.
 *  - "whisper": an AI-assisted, off-device engine. We record locally, then upload the clip
 *    to the gateway, which proxies it under the stt:whisper governance gate + kill switch.
 *
 * Renders nothing when no usable engine exists for the active provider (feature-detected).
 */
export function DictateButton({ onText, lang = "en-GB" }: { onText: (text: string) => void; lang?: string }) {
  const { data: stt } = useSttStatus();
  const provider = stt?.provider ?? "browser";

  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<Dictation | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const mountedRef = useRef(true);

  // Latest onText without re-creating the session each render.
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  // On unmount: stop the browser dictation AND release the mic if a Whisper recording is
  // still live (its tracks are only freed inside stop()), so the microphone can't stay open
  // after the component is gone. Also flag unmounted so post-await callbacks below no-op.
  useEffect(() => () => {
    mountedRef.current = false;
    sessionRef.current?.stop();
    void recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  // Whisper (off-device): record locally, then upload the clip for transcription.
  const whisper = provider === "whisper";
  const usable = whisper ? isRecordingSupported() : isSpeechSupported();
  if (provider === "none" || !usable) return null;

  const toggleLocal = (): void => {
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

  const toggleWhisper = async (): Promise<void> => {
    if (listening) {
      // Stop, upload, transcribe.
      const rec = recorderRef.current;
      recorderRef.current = null;
      setListening(false);
      if (!rec) return;
      setBusy(true);
      try {
        const clip = await rec.stop();
        const text = await transcribeClip(clip);
        if (mountedRef.current && text.trim()) onTextRef.current(text.trim());
      } catch {
        // Surface nothing intrusive; the field simply stays as-is on failure.
      } finally {
        if (mountedRef.current) setBusy(false);
      }
      return;
    }
    try {
      const rec = await startRecording();
      if (!mountedRef.current) { void rec.stop(); return; } // unmounted during the mic prompt — release it now
      recorderRef.current = rec;
      setListening(true);
    } catch {
      recorderRef.current = null; // mic denied / unsupported — stay idle
    }
  };

  const toggle = whisper ? toggleWhisper : toggleLocal;
  const label = listening ? "Stop dictation" : whisper ? "Dictate (AI transcription)" : "Dictate (local speech)";
  const title = whisper
    ? "Dictate with the AI-assisted engine (audio is uploaded for transcription)"
    : "Dictate with your device's own speech engine (audio stays local)";

  return (
    <button
      type="button"
      onClick={() => { void toggle(); }}
      disabled={busy}
      data-testid="dictate-button"
      aria-pressed={listening}
      aria-busy={busy}
      aria-label={label}
      title={title}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-sm ${listening ? "bg-red-100 text-red-700" : busy ? "text-muted-foreground opacity-60" : "text-muted-foreground"}`}
    >
      {busy ? "…" : listening ? "■" : "🎤"}
    </button>
  );
}
