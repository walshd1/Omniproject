import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sttStatus, sttCapabilityId, transcribe, SttError } from "./stt";
import { updateSettings } from "./settings";
import { engageAiKill, releaseAiKill } from "./ai-kill";

/**
 * STT lib: provider-pluggable, governed, kill-switch-aware. The browser engine is local
 * (the server never transcribes it); whisper is off-device and AI-assisted.
 */
afterEach(() => {
  releaseAiKill();
  updateSettings({ sttProvider: "none" });
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
