import fs from "node:fs";
import path from "node:path";
import { sealConfig, readMaybeSealed } from "./config-crypto";
import { setSecret, getSecret, hasSecret, deleteSecret, secretFingerprint } from "./vault";
import { getSettings } from "./settings";
import { logger } from "./logger";

/**
 * AI provider registry + capability→provider mapping.
 *
 * The model the admin works with:
 *   - AI PROVIDERS are first-class entities (id, kind, label, endpoint, model). You can have
 *     more than one of a kind (e.g. two OpenAI accounts) — each is a separate entity.
 *   - Each provider's API KEY lives in the encrypted vault (lib/vault), entered in the AI
 *     Providers admin screen. Keys are OUT of docker/env entirely (hard cut-over).
 *   - CAPABILITIES (chat, nl-action, copilot, health-watch, stt) map to an ORDERED LIST of
 *     providers — the first ready one wins (primary + fallbacks).
 *
 * Provider configs + the mapping persist (sealed) to a company-wide file so they survive a
 * restart; the keys themselves persist separately in the vault.
 */
export type AiProviderKind = "openai" | "anthropic" | "ollama" | "openrouter" | "whisper";
export const AI_PROVIDER_KINDS: readonly AiProviderKind[] = ["openai", "anthropic", "ollama", "openrouter", "whisper"];

/** Kinds that need no API key to be usable (local / self-hosted). */
const KEYLESS = new Set<AiProviderKind>(["ollama"]);

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  label: string;
  endpoint?: string; // base URL override (self-hosted / proxy / whisper server)
  model?: string;    // default model for this provider
}

/** An AI capability that consumes a provider. `kind: "stt"` capabilities take a whisper
 *  provider; everything else takes a chat-completion provider. */
export interface AiCapabilityDef {
  id: string;
  label: string;
  surface: "chat" | "stt";
}
export const AI_CAPABILITIES: readonly AiCapabilityDef[] = [
  { id: "chat", label: "AI chat", surface: "chat" },
  { id: "nl-action", label: "Natural-language commands", surface: "chat" },
  { id: "copilot", label: "Portfolio copilot", surface: "chat" },
  { id: "health-watch", label: "Health / anomaly watch", surface: "chat" },
  { id: "stt", label: "Speech-to-text (Whisper)", surface: "stt" },
];

/** The default provider set — one entity per kind, so a fresh deployment has them to map. */
function seedProviders(): AiProviderConfig[] {
  return [
    { id: "openai", kind: "openai", label: "OpenAI" },
    { id: "anthropic", kind: "anthropic", label: "Anthropic" },
    { id: "ollama", kind: "ollama", label: "Ollama (local)" },
    { id: "openrouter", kind: "openrouter", label: "OpenRouter" },
    { id: "whisper", kind: "whisper", label: "Whisper" },
  ];
}

interface ProvidersState {
  providers: AiProviderConfig[];
  // capability id → ordered provider ids (empty/absent ⇒ fall back to the Settings default).
  mapping: Record<string, string[]>;
}

let state: ProvidersState = { providers: seedProviders(), mapping: {} };
let loaded = false;

function file(): string | null {
  const explicit = process.env["AI_PROVIDERS_FILE"]?.trim();
  if (explicit) return explicit;
  const dir = process.env["OMNI_CONFIG_DIR"]?.trim();
  return dir ? path.join(dir, "ai-providers.json") : null;
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const f = file();
  if (!f || !fs.existsSync(f)) return;
  try {
    const parsed = JSON.parse(readMaybeSealed(fs.readFileSync(f, "utf8"))) as Partial<ProvidersState>;
    if (Array.isArray(parsed.providers) && parsed.providers.length) state.providers = parsed.providers;
    if (parsed.mapping && typeof parsed.mapping === "object") state.mapping = parsed.mapping;
    logger.info({ providers: state.providers.length }, "ai-providers: restored from disk");
  } catch (err) {
    logger.warn({ err }, "ai-providers: failed to restore — using defaults");
  }
}

function persist(): void {
  const f = file();
  if (!f) return;
  try {
    fs.writeFileSync(f, sealConfig(JSON.stringify(state)));
  } catch (err) {
    logger.warn({ err }, "ai-providers: failed to persist");
  }
}

// ── Provider entities ──────────────────────────────────────────────────────────
export function listProviders(): AiProviderConfig[] {
  ensureLoaded();
  return state.providers.map((p) => ({ ...p }));
}

/** The provider entity with this id, or undefined. */
export function getProvider(id: string): AiProviderConfig | undefined {
  ensureLoaded();
  return state.providers.find((p) => p.id === id);
}

/** Add or replace a provider entity (by id). The id and kind are validated by the caller. */
export function upsertProvider(cfg: AiProviderConfig): void {
  ensureLoaded();
  const idx = state.providers.findIndex((p) => p.id === cfg.id);
  if (idx >= 0) state.providers[idx] = cfg; else state.providers.push(cfg);
  persist();
}

/** Remove a provider entity, its stored key, and any mapping references to it. */
export function removeProvider(id: string): void {
  ensureLoaded();
  state.providers = state.providers.filter((p) => p.id !== id);
  for (const cap of Object.keys(state.mapping)) {
    state.mapping[cap] = (state.mapping[cap] ?? []).filter((pid) => pid !== id);
  }
  deleteSecret(keyRef(id));
  persist();
}

// ── Keys (vault-backed; write-only across the boundary) ─────────────────────────
function keyRef(providerId: string): string { return `aiprovider:${providerId}`; }

/** Store a provider's API key in the encrypted vault. The plaintext is never kept here. */
export function setProviderKey(id: string, key: string): void { setSecret(keyRef(id), key); }

/** Remove a provider's stored key. */
export function clearProviderKey(id: string): void { deleteSecret(keyRef(id)); }

/** INTERNAL: resolve a provider's key for an upstream call. Never expose over a route. */
export function resolveProviderKey(id: string): string | null { return getSecret(keyRef(id)); }

/** Non-secret key state for the admin screen: presence + a short fingerprint. */
export function providerKeyState(id: string): { hasKey: boolean; fingerprint: string | null } {
  return { hasKey: hasSecret(keyRef(id)), fingerprint: secretFingerprint(keyRef(id)) };
}

/** Is this provider usable right now (keyless kind, or a key/endpoint is present)? */
export function providerReady(id: string): boolean {
  const p = getProvider(id);
  if (!p) return false;
  if (KEYLESS.has(p.kind)) return true;
  if (p.kind === "whisper") return hasSecret(keyRef(id)) || !!p.endpoint?.trim();
  return hasSecret(keyRef(id));
}

// ── Capability → provider mapping ────────────────────────────────────────────────
export function getCapabilityProviders(cap: string): string[] {
  ensureLoaded();
  return [...(state.mapping[cap] ?? [])];
}

/** Set the ordered provider list for a capability (unknown provider ids are dropped). */
export function setCapabilityProviders(cap: string, providerIds: string[]): void {
  ensureLoaded();
  const known = new Set(state.providers.map((p) => p.id));
  state.mapping[cap] = providerIds.filter((id) => known.has(id));
  persist();
}

/**
 * Resolve the provider that should serve a capability: the first READY provider in the
 * capability's ordered mapping. When nothing is mapped, fall back to the relevant Settings
 * default (aiProvider for chat surfaces, sttProvider for stt) — so existing deployments keep
 * working without touching the new screen.
 */
export function resolveProviderForCapability(cap: string): AiProviderConfig | null {
  ensureLoaded();
  for (const id of state.mapping[cap] ?? []) {
    if (providerReady(id)) return getProvider(id) ?? null;
  }
  // Fallback to the Settings-level default for this capability's surface.
  const def = AI_CAPABILITIES.find((c) => c.id === cap);
  if (def?.surface === "stt") {
    const stt = getSettings().sttProvider;
    return stt === "whisper" ? getProvider("whisper") ?? null : null;
  }
  const chat = getSettings().aiProvider;
  return chat === "none" ? null : getProvider(chat) ?? null;
}

/** A snapshot of the whole provider config (for status/admin views; no secrets). */
export function providersSnapshot(): { providers: Array<AiProviderConfig & { hasKey: boolean; fingerprint: string | null; ready: boolean }>; mapping: Record<string, string[]> } {
  ensureLoaded();
  return {
    providers: state.providers.map((p) => ({ ...p, ...providerKeyState(p.id), ready: providerReady(p.id) })),
    mapping: { ...state.mapping },
  };
}

/** Test-only: reset to seed defaults and force reload. */
export function __resetProviders(): void {
  state = { providers: seedProviders(), mapping: {} };
  loaded = false;
}
