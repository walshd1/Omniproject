import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sttStatus, sttCapabilityId, transcribe, SttError } from "./stt";
import { updateSettings } from "./settings";
import { engageAiKill, releaseAiKill } from "./ai-kill";

/**
 * STT lib: provider-pluggable, governed, kill-switch-aware. The browser engine is local
 * (the server never transcribes it); whisper is off-device and AI-assisted.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
  releaseAiKill();
  updateSettings({ sttProvider: "none" });
  globalThis.fetch = realFetch;
  delete process.env["WHISPER_URL"];
  delete process.env["WHISPER_MODEL"];
});

test("sttStatus reports the configured provider and whether it is local", () => {
  updateSettings({ sttProvider: "browser" });
  assert.deepEqual(sttStatus(), { provider: "browser", local: true });
  updateSettings({ sttProvider: "whisper" });
  assert.deepEqual(sttStatus(), { provider: "whisper", local: false });
});

test("sttCapabilityId tracks the active provider", () => {
  updateSettings({ sttProvider: "whisper" });
  assert.equal(sttCapabilityId(), "stt:whisper");
});

test("transcribe refuses when speech-to-text is not configured", async () => {
  updateSettings({ sttProvider: "none" });
  await assert.rejects(() => transcribe(Buffer.from("x"), "audio/webm"), (e: unknown) => e instanceof SttError && e.status === 400);
});

test("transcribe refuses the browser engine on the server (it is on-device)", async () => {
  updateSettings({ sttProvider: "browser" });
  await assert.rejects(() => transcribe(Buffer.from("x"), "audio/webm"), (e: unknown) => e instanceof SttError && e.status === 400);
});

test("transcribe is blocked by the AI kill switch with 403", async () => {
  updateSettings({ sttProvider: "whisper" });
  engageAiKill();
  await assert.rejects(() => transcribe(Buffer.from("x"), "audio/webm"), (e: unknown) => e instanceof SttError && e.status === 403);
});

test("transcribe (whisper) posts a multipart upload and returns the recognised text", async () => {
  updateSettings({ sttProvider: "whisper" });
  process.env["WHISPER_URL"] = "http://whisper.local/v1/audio/transcriptions";
  let seen: { url: string; method: string | undefined; hasBody: boolean } = { url: "", method: undefined, hasBody: false };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), method: init?.method, hasBody: !!init?.body };
    return new Response(JSON.stringify({ text: "hello world" }), { status: 200 });
  }) as typeof fetch;

  const result = await transcribe(Buffer.from("audio-bytes"), "audio/webm");
  assert.equal(result.text, "hello world");
  assert.equal(seen.url, "http://whisper.local/v1/audio/transcriptions");
  assert.equal(seen.method, "POST");
  assert.equal(seen.hasBody, true);
});

test("transcribe (whisper) maps a non-ok provider response to a 502 SttError", async () => {
  updateSettings({ sttProvider: "whisper" });
  globalThis.fetch = (async () => new Response("upstream boom", { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => transcribe(Buffer.from("x"), "audio/webm"),
    (e: unknown) => e instanceof SttError && e.status === 502,
  );
});

test("transcribe (whisper) returns empty text when the provider omits a text field", async () => {
  updateSettings({ sttProvider: "whisper" });
  globalThis.fetch = (async () => new Response(JSON.stringify({ notText: 1 }), { status: 200 })) as typeof fetch;
  const result = await transcribe(Buffer.from("x"), ""); // empty mime falls back to audio/webm
  assert.equal(result.text, "");
});

test("transcribe (whisper) tolerates a non-JSON provider body (empty text)", async () => {
  updateSettings({ sttProvider: "whisper" });
  globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  const result = await transcribe(Buffer.from("x"), "audio/webm");
  assert.equal(result.text, "");
});
