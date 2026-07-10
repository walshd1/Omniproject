import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Speech-to-text client. STT is provider-pluggable, exactly like the LLM provider:
 *  - "browser": the device's own recogniser (lib/speech) — audio NEVER leaves the
 *    machine, the server is never called. The zero-egress default.
 *  - "whisper": an AI-assisted, off-device transcription endpoint (self-hosted or cloud).
 *    Audio is recorded locally then uploaded to the gateway, which proxies it under the
 *    stt:whisper governance gate + AI kill switch.
 *  - "none": dictation is unavailable.
 */
export type SttProvider = "none" | "browser" | "whisper";

export interface SttStatus {
  provider: SttProvider;
  /** True when transcription happens on-device (no audio egress). */
  local: boolean;
}

/** Which speech engine is active (and is it local?). Any authed user may read this. */
export function useSttStatus() {
  return useQuery<SttStatus>({
    queryKey: ["ai-stt"],
    queryFn: () => getJson("/api/ai/stt"),
    staleTime: 30_000,
  });
}

/**
 * Upload a recorded clip to the gateway for AI-assisted transcription (Whisper et al).
 * Only used for off-device providers; the browser engine transcribes client-side and
 * never hits this path. The CSRF wrapper attaches the token automatically.
 */
export async function transcribeClip(blob: Blob): Promise<string> {
  const audio = await blobToBase64(blob);
  const res = await fetch("/api/ai/transcribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio,
      mime: blob.type || "audio/webm",
      surface: typeof window !== "undefined" ? window.location.pathname : undefined,
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error || `transcription failed: ${res.status}`);
  }
  return ((await res.json()) as { text?: string }).text ?? "";
}

/** Encode a Blob as base64 (no data: prefix) for a JSON body. Internal to this module. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      // strip the "data:<mime>;base64," prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Is off-device audio capture possible on this platform (MediaRecorder + getUserMedia)? */
export function isRecordingSupported(): boolean {
  return typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia
    && typeof (window as { MediaRecorder?: unknown }).MediaRecorder === "function";
}

export interface Recorder {
  /** Stop recording, release the mic, and resolve with the captured clip. */
  stop(): Promise<Blob>;
}

/**
 * Start microphone capture and return a handle whose stop() yields the recorded clip.
 * Throws if the platform can't record or the user denies the mic. The audio only leaves
 * the device when the caller chooses to upload it (Whisper path).
 */
export async function startRecording(): Promise<Recorder> {
  if (!isRecordingSupported()) throw new Error("Audio recording is not supported here.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop()); // release the mic promptly
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
  };
}
