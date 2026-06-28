import { getSettings, type SttProvider } from "./settings";
import { aiKillEngaged } from "./ai-kill";
import { effectiveState } from "./tools";

/**
 * AI-assisted speech-to-text — provider-pluggable, governed, with Whisper as ONE provider.
 *
 *  - "browser": the device's own recogniser, handled entirely client-side (lib/speech).
 *    Audio never leaves the machine; the server never sees it. The zero-egress default.
 *  - "whisper": an OpenAI-compatible /audio/transcriptions endpoint — a self-hosted Whisper
 *    server (whisper.cpp / faster-whisper) OR a cloud one. Audio is sent off-device, so it's
 *    governance-gated and containment-aware exactly like an LLM provider.
 *
 * The server only transcribes for AI-assisted providers; "browser" returns a marker so the
 * client uses its own engine. Honours the AI kill switch.
 */
export class SttError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "SttError"; }
}

/** The configured STT provider + whether it runs locally (no server round-trip / egress). */
export function sttStatus(): { provider: SttProvider; local: boolean } {
  const provider = getSettings().sttProvider;
  return { provider, local: provider === "browser" };
}

/** The Whisper endpoint + key (operator config). Endpoint via the capability's user-defined
 *  state; key from the environment (never stored by OmniProject). */
function whisperConfig(): { url: string; key: string | undefined } {
  const endpoint = getSettings().capabilityStates?.["stt:whisper"]?.endpoint?.trim();
  const url = endpoint || process.env["WHISPER_URL"]?.trim() || "http://localhost:9000/v1/audio/transcriptions";
  return { url, key: process.env["WHISPER_API_KEY"]?.trim() || undefined };
}

/**
 * Transcribe an audio clip with the configured AI-assisted provider. `audio` is the raw
 * bytes; `mime` the content type (e.g. "audio/webm"). Returns the recognised text.
 */
export async function transcribe(audio: Buffer, mime: string): Promise<{ text: string }> {
  if (aiKillEngaged()) throw new SttError("AI is disabled by the kill switch.", 403);
  const { provider } = sttStatus();
  if (provider === "none") throw new SttError("Speech-to-text is not configured.", 400);
  if (provider === "browser") throw new SttError("The browser engine is local — transcribe on the device, not the server.", 400);

  // provider === "whisper": OpenAI-compatible multipart upload.
  const { url, key } = whisperConfig();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime || "audio/webm" }), "clip.webm");
  form.append("model", process.env["WHISPER_MODEL"]?.trim() || "whisper-1");
  const res = await fetch(url, { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: form });
  if (!res.ok) throw new SttError(`Transcription provider returned ${res.status}`, 502);
  const data = (await res.json().catch(() => ({}))) as { text?: unknown };
  return { text: typeof data.text === "string" ? data.text : "" };
}

/** The governance capability id for the active STT provider (for the enforce gate). */
export function sttCapabilityId(): string {
  return `stt:${getSettings().sttProvider}`;
}

/** Re-export so callers can show the right per-surface state. */
export { effectiveState };
