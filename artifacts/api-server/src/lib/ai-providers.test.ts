import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  listProviders, getProvider, upsertProvider, removeProvider,
  setProviderKey, clearProviderKey, providerKeyState, providerReady,
  getCapabilityProviders, setCapabilityProviders, resolveProviderForCapability,
  providersSnapshot, __resetProviders,
} from "./ai-providers";
import { __resetVault } from "./vault";
import { updateSettings, getSettings } from "./settings";

/**
 * Provider registry + capability→provider ordered mapping + vault-backed keys.
 */
const ORIGINAL = getSettings();
afterEach(() => {
  __resetProviders();
  __resetVault();
  updateSettings({ aiProvider: ORIGINAL.aiProvider, sttProvider: ORIGINAL.sttProvider, aiModel: ORIGINAL.aiModel });
});

test("seeds one provider per kind", () => {
  const kinds = listProviders().map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["anthropic", "ollama", "openai", "openrouter", "whisper"]);
});

test("keys live in the vault and are write-only (state exposes presence + fingerprint only)", async () => {
  await setProviderKey("openai", "sk-abc");
  const st = providerKeyState("openai");
  assert.equal(st.hasKey, true);
  assert.equal(typeof st.fingerprint, "string");
  // The snapshot for the admin screen never carries the secret.
  assert.equal(JSON.stringify(providersSnapshot()).includes("sk-abc"), false);
  await clearProviderKey("openai");
  assert.equal(providerKeyState("openai").hasKey, false);
});

test("providerReady: ollama is keyless; key-gated kinds need a vault key", async () => {
  assert.equal(providerReady("ollama"), true);
  assert.equal(providerReady("openai"), false);
  await setProviderKey("openai", "sk-abc");
  assert.equal(providerReady("openai"), true);
});

test("whisper is ready with either a key or an endpoint", () => {
  assert.equal(providerReady("whisper"), false);
  upsertProvider({ id: "whisper", kind: "whisper", label: "Whisper", endpoint: "http://whisper.local/v1/audio/transcriptions" });
  assert.equal(providerReady("whisper"), true);
});

test("capability mapping resolves the first READY provider in order", async () => {
  // Map chat to [openai, ollama]; openai has no key, so ollama (ready) wins.
  setCapabilityProviders("chat", ["openai", "ollama"]);
  assert.equal(resolveProviderForCapability("chat")?.id, "ollama");
  // Give openai a key and it now wins (earlier in the order).
  await setProviderKey("openai", "sk-abc");
  assert.equal(resolveProviderForCapability("chat")?.id, "openai");
  assert.deepEqual(getCapabilityProviders("chat"), ["openai", "ollama"]);
});

test("unmapped capability falls back to the Settings default provider", () => {
  setCapabilityProviders("chat", []);
  updateSettings({ aiProvider: "ollama" });
  assert.equal(resolveProviderForCapability("chat")?.id, "ollama");
  updateSettings({ aiProvider: "none" });
  assert.equal(resolveProviderForCapability("chat"), null);
});

test("stt capability falls back to the whisper provider when Settings selects whisper", () => {
  setCapabilityProviders("stt", []);
  updateSettings({ sttProvider: "whisper" });
  upsertProvider({ id: "whisper", kind: "whisper", label: "Whisper", endpoint: "http://w.local" });
  assert.equal(resolveProviderForCapability("stt")?.kind, "whisper");
  updateSettings({ sttProvider: "browser" });
  assert.equal(resolveProviderForCapability("stt"), null);
});

test("removeProvider drops the entity, its key, and mapping references", async () => {
  upsertProvider({ id: "openai-2", kind: "openai", label: "OpenAI (team)" });
  await setProviderKey("openai-2", "sk-2");
  setCapabilityProviders("chat", ["openai-2", "ollama"]);
  await removeProvider("openai-2");
  assert.equal(getProvider("openai-2"), undefined);
  assert.equal(providerKeyState("openai-2").hasKey, false);
  assert.deepEqual(getCapabilityProviders("chat"), ["ollama"]);
});
