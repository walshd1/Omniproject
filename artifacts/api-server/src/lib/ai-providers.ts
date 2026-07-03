import { setSecret, getSecret, hasSecret, deleteSecret, secretFingerprint } from "./vault";
import { getSettings } from "./settings";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";

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
  // provider id → epoch ms when its key was last set (for rotation/expiry surfacing).
  keyRotatedAt: Record<string, number>;
}

let state: ProvidersState = { providers: seedProviders(), mapping: {}, keyRotatedAt: {} };

const store = new SealedFile(() => resolveConfigFile("AI_PROVIDERS_FILE", "ai-providers.json"), "ai-providers");

// One-generation undo for provider entities + the capability mapping (never the vault-held
// keys themselves — a deleted/rotated key is not something rollback should silently bring
// back; see the module docstring). Batched per synchronous tick the same way rate-card-store
// batches a multi-setter request, so e.g. an accidental removeProvider (entity + mapping edit
// across two statements) undoes as one step, not the state between them.
let previousState: { providers: AiProviderConfig[]; mapping: Record<string, string[]> } | null = null;
let batchOpen = false;

function beginMutation(): void {
  if (batchOpen) return;
  previousState = { providers: structuredClone(state.providers), mapping: structuredClone(state.mapping) };
  batchOpen = true;
  queueMicrotask(() => { batchOpen = false; });
}

/** Undo the most recent provider/mapping change (one generation back). One-shot. */
export function rollbackAiProviders(): boolean {
  if (!previousState) return false;
  const restore = previousState;
  previousState = null;
  state.providers = restore.providers;
  state.mapping = restore.mapping;
  persist();
  return true;
}

/** Whether a rollback is currently available (for the admin UI to show/hide the control). */
export function canRollbackAiProviders(): boolean {
  return previousState !== null;
}

function ensureLoaded(): void {
  store.loadOnce((raw) => {
    const parsed = JSON.parse(raw) as Partial<ProvidersState>;
    if (Array.isArray(parsed.providers) && parsed.providers.length) state.providers = parsed.providers;
    if (parsed.mapping && typeof parsed.mapping === "object") state.mapping = parsed.mapping;
    if (parsed.keyRotatedAt && typeof parsed.keyRotatedAt === "object") state.keyRotatedAt = parsed.keyRotatedAt;
    logger.info({ providers: state.providers.length }, "ai-providers: restored from disk");
  });
}

function persist(): void {
  store.write(JSON.stringify(state));
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
  beginMutation();
  const idx = state.providers.findIndex((p) => p.id === cfg.id);
  if (idx >= 0) state.providers[idx] = cfg; else state.providers.push(cfg);
  persist();
}

/** Remove a provider entity, its stored key, and any mapping references to it. */
export async function removeProvider(id: string): Promise<void> {
  ensureLoaded();
  beginMutation(); // snapshot BEFORE mutating — the key deletion below is awaited, so this can't live in persist()
  state.providers = state.providers.filter((p) => p.id !== id);
  for (const cap of Object.keys(state.mapping)) {
    state.mapping[cap] = (state.mapping[cap] ?? []).filter((pid) => pid !== id);
  }
  await deleteSecret(keyRef(id));
  delete state.keyRotatedAt[id];
  persist();
}

// ── Keys (vault-backed; write-only across the boundary) ─────────────────────────
function keyRef(providerId: string): string { return `aiprovider:${providerId}`; }

/** How many days a stored key may age before it's flagged stale (AI_KEY_MAX_AGE_DAYS, default 90). */
export function keyMaxAgeDays(): number {
  const n = Number(process.env["AI_KEY_MAX_AGE_DAYS"]);
  return Number.isFinite(n) && n > 0 ? n : 90;
}

/** Store a provider's API key in the vault, recording the rotation time. Plaintext is never kept here. */
export async function setProviderKey(id: string, key: string): Promise<void> {
  ensureLoaded();
  await setSecret(keyRef(id), key);
  state.keyRotatedAt[id] = Date.now();
  persist();
}

/** Remove a provider's stored key (and its rotation timestamp). */
export async function clearProviderKey(id: string): Promise<void> {
  ensureLoaded();
  await deleteSecret(keyRef(id));
  if (id in state.keyRotatedAt) { delete state.keyRotatedAt[id]; persist(); }
}

/** INTERNAL: resolve a provider's key for an upstream call. Never expose over a route. */
export function resolveProviderKey(id: string): string | null { return getSecret(keyRef(id)); }

/** Non-secret key state for the admin screen: presence, fingerprint, and rotation age. */
export function providerKeyState(id: string): { hasKey: boolean; fingerprint: string | null; rotatedAt: number | null; ageDays: number | null; stale: boolean } {
  ensureLoaded();
  const hasKey = hasSecret(keyRef(id));
  const rotatedAt = state.keyRotatedAt[id] ?? null;
  const ageDays = rotatedAt !== null ? Math.floor((Date.now() - rotatedAt) / 86_400_000) : null;
  // A present key with no recorded rotation time (or older than the max age) is flagged stale.
  const stale = hasKey && (ageDays === null || ageDays >= keyMaxAgeDays());
  return { hasKey, fingerprint: secretFingerprint(keyRef(id)), rotatedAt, ageDays, stale };
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
  beginMutation();
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
  state = { providers: seedProviders(), mapping: {}, keyRotatedAt: {} };
  previousState = null;
  batchOpen = false;
  store.reset();
}
