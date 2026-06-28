import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSpeechSupported, createDictation, insertIntoField, type Dictation } from "../lib/speech";
import { announce } from "../lib/announce";
import { useA11yPrefs } from "../lib/a11y-prefs";

/**
 * Floating mic that dictates into whichever text field has focus, using the user's
 * OWN browser speech engine (lib/speech). Shown only when the user has opted into
 * dictation AND the platform has recognition, so it never appears where it can't work.
 * The target is captured on press (recognition steals focus), and the recognised text
 * is appended to that field.
 */
function focusedField(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && /^(text|search|email|url|tel|number|password)$/.test(el.type)) return el;
  if (el instanceof HTMLTextAreaElement) return el;
  return null;
}

export function VoiceInput() {
  const { prefs } = useA11yPrefs();
  const enabled = prefs.speechInput && isSpeechSupported();
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  const targetRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Tidy up any in-flight session if the component unmounts mid-listen.
  useEffect(() => () => dictationRef.current?.stop(), []);

  if (!enabled) return null;

  const stop = (): void => {
    dictationRef.current?.stop();
    dictationRef.current = null;
    setListening(false);
  };

  const start = (): void => {
    const target = focusedField();
    if (!target) { announce("Click into a text field first, then start dictation.", "assertive"); return; }
    targetRef.current = target;
    const dictation = createDictation({
      onText: (text) => { if (targetRef.current) insertIntoField(targetRef.current, text); },
      onEnd: () => { dictationRef.current = null; setListening(false); },
    });
    if (!dictation) return;
    dictationRef.current = dictation;
    dictation.start();
    setListening(true);
    announce("Listening — speak now.", "assertive");
  };

  return (
    <Button
      type="button"
      variant={listening ? "default" : "outline"}
      size="icon"
      // Capture the target before focus moves to the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => (listening ? stop() : start())}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictation" : "Start voice dictation"}
      data-testid="voice-input"
      className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg"
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
