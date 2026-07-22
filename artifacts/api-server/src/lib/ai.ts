import { getSettings, type AiProvider } from "./settings";
import { aiKillEngaged } from "./ai-kill";
import {
  resolveProviderForCapability,
  resolveProviderKey,
  providerReady,
  type AiProviderConfig,
  type AiProviderKind,
} from "./ai-providers";
import {
  dlpEnabled, redactForEgress, modelAllowed, checkBudget, recordUsage, estimateTokens,
  type AiGovContext,
} from "./ai-governance";
import { safeFetch } from "./egress";
import { envInt } from "./env-config";
import { recordUsage as recordVendorUsage } from "./usage-metering";

/**
 * AI provider client. Providers are first-class entities (lib/ai-providers) and their API
 * KEYS live in the encrypted vault (lib/vault) — NOT in the environment. Which provider
 * serves chat is the resolution of the "chat" capability mapping (falling back to the
 * Settings default). This module owns only HOW to talk to each provider KIND.
 */

/** An image attached to a chat message (base64), for vision-capable providers. */
export interface ChatImage {
  /** MIME type, e.g. "image/png". */
  mime: string;
  /** Base64-encoded image bytes (no data: prefix). */
  dataBase64: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Optional attached images (multimodal). Only vision-capable providers use them; text-only providers and
   *  the governance/DLP/token paths ignore them (redaction spreads the message, so images pass through). */
  images?: ChatImage[];
}

const asDataUri = (img: ChatImage): string => `data:${img.mime};base64,${img.dataBase64}`;

/** Map to the OpenAI/OpenRouter message shape — a plain string when there are no images, else content-parts
 *  (a text part + one image_url part per image). Byte-identical to the old body when no image is attached. */
export function toOpenAiMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) =>
    m.images && m.images.length
      ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((img) => ({ type: "image_url", image_url: { url: asDataUri(img) } }))] }
      : { role: m.role, content: m.content },
  );
}

/** Map to the Anthropic message shape — a text block + base64 image blocks when images are attached. */
export function toAnthropicMessages(turns: ChatMessage[]): Array<Record<string, unknown>> {
  return turns.map((m) =>
    m.images && m.images.length
      ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mime, data: img.dataBase64 } }))] }
      : { role: m.role, content: m.content },
  );
}

/** Map to the Ollama message shape — images ride as a sibling base64 array on the message. */
export function toOllamaMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) =>
    m.images && m.images.length
      ? { role: m.role, content: m.content, images: m.images.map((img) => img.dataBase64) }
      : { role: m.role, content: m.content },
  );
}

// OLLAMA_URL is an endpoint, not a secret, so it may stay in the environment as the default
// base for a local Ollama (a provider entity can still override it per-entity).
const OLLAMA_DEFAULT = process.env["OLLAMA_URL"]?.trim() || "http://localhost:11434";

const DEFAULT_MODEL: Record<AiProviderKind, string> = {
  ollama: "llama3.2",
  openrouter: "openrouter/auto",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  whisper: "whisper-1",
  // Self-hosted servers load their own model; the admin sets the model name on the provider entity.
  "openai-compatible": "",
};

export interface AiStatus {
  provider: AiProvider;
  model: string | null;
  configured: boolean;
  detail: string;
}

export class AiError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  // safeFetch applies the SSRF/egress guard (link-local/metadata block + post-DNS recheck,
  // EGRESS_ALLOWLIST, and data-residency) before the call — the provider endpoint is
  // operator/admin-settable, so it must not be a route to the metadata IP.
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    // Admin-tunable — a self-hosted CPU model (e.g. Ollama) can exceed 60s on long completions.
    signal: AbortSignal.timeout(envInt("AI_TIMEOUT_MS", 60_000, { min: 1_000 })),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiError(`Provider returned ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export interface ChatResult {
  content: string;
  provider: AiProvider;
  model: string;
}

/**
 * Per-KIND chat registry — how to reach each provider kind. Adding a kind is one entry. The
 * endpoint is the default base URL; a provider entity can override it. The key (when needed)
 * is resolved from the vault by the caller, never read from the environment.
 */
type ChatKind = "openai" | "anthropic" | "ollama" | "openrouter" | "openai-compatible";
interface ChatKindDef {
  endpoint: string;
  chat(endpoint: string, key: string | undefined, model: string, messages: ChatMessage[]): Promise<string>;
}

const KINDS: Record<ChatKind, ChatKindDef> = {
  ollama: {
    endpoint: OLLAMA_DEFAULT,
    chat: async (endpoint, _key, model, messages) => {
      const json = (await postJson(`${endpoint}/api/chat`, {}, { model, messages: toOllamaMessages(messages), stream: false })) as { message?: { content?: string } };
      const content = json.message?.content;
      if (content === undefined) throw new AiError("Ollama response has no message content");
      return content;
    },
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1",
    chat: async (endpoint, key, model, messages) => {
      const json = (await postJson(
        `${endpoint}/chat/completions`,
        { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://github.com/walshd1/Omniproject", "X-Title": "OmniProject" },
        { model, messages: toOpenAiMessages(messages) },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (content === undefined) throw new AiError("OpenRouter response has no message content");
      return content;
    },
  },
  openai: {
    endpoint: "https://api.openai.com/v1",
    chat: async (endpoint, key, model, messages) => {
      const json = (await postJson(
        `${endpoint}/chat/completions`,
        { Authorization: `Bearer ${key}` },
        { model, messages: toOpenAiMessages(messages) },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (content === undefined) throw new AiError("OpenAI response has no message content");
      return content;
    },
  },
  // Bring-your-own self-hosted endpoint speaking the OpenAI chat-completions shape. NO default
  // endpoint — the admin must set a URL on the provider entity, so this can never silently reach a
  // public model. The API key is optional (self-hosted servers often need none); the Authorization
  // header is sent only when a key is present. Egress still flows through safeFetch (SSRF-guarded).
  "openai-compatible": {
    endpoint: "",
    chat: async (endpoint, key, model, messages) => {
      if (!endpoint) throw new AiError("Set the endpoint URL for the self-hosted provider in AI Providers.", 400);
      if (!model) throw new AiError("Set the model name for the self-hosted provider in AI Providers.", 400);
      const json = (await postJson(
        `${endpoint}/chat/completions`,
        key ? { Authorization: `Bearer ${key}` } : {},
        { model, messages: toOpenAiMessages(messages) },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (content === undefined) throw new AiError("Self-hosted provider response has no message content");
      return content;
    },
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1",
    chat: async (endpoint, key, model, messages) => {
      // Anthropic keeps the system prompt separate and requires max_tokens.
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
      const turns = messages.filter((m) => m.role !== "system");
      const json = (await postJson(
        `${endpoint}/messages`,
        { "x-api-key": key as string, "anthropic-version": "2023-06-01" },
        { model, max_tokens: 1024, system, messages: toAnthropicMessages(turns) },
      )) as { content?: Array<{ text?: string }> };
      const text = json.content?.[0]?.text;
      if (text === undefined) throw new AiError("Anthropic response has no content");
      return text;
    },
  },
};

/** The chat-capable provider kinds (the registry's keys). */
export const AI_PROVIDER_IDS: readonly string[] = Object.keys(KINDS);

function isChatKind(kind: AiProviderKind): kind is ChatKind {
  return kind in KINDS;
}

function resolvedModel(provider: AiProviderConfig): string {
  return provider.model?.trim() || getSettings().aiModel?.trim() || DEFAULT_MODEL[provider.kind];
}

/** Report whether AI chat is configured + which provider/model is active. */
export function aiStatus(): AiStatus {
  const provider = resolveProviderForCapability("chat");
  if (!provider) {
    return { provider: "none", model: null, configured: false, detail: "No AI provider selected." };
  }
  if (!isChatKind(provider.kind)) {
    return { provider: "none", model: null, configured: false, detail: `${provider.label} cannot serve chat.` };
  }
  const ready = providerReady(provider.id);
  const endpoint = provider.endpoint?.trim() || KINDS[provider.kind].endpoint;
  const detail = provider.kind === "ollama"
    ? `Local model via Ollama at ${endpoint}.`
    : provider.kind === "openai-compatible"
      ? ready
        ? `Self-hosted model at ${endpoint}.`
        : `Set the endpoint URL for ${provider.label} in AI Providers.`
      : ready
        ? `${provider.label} ready (key in vault).`
        : `Add an API key for ${provider.label} in AI Providers.`;
  return { provider: provider.kind, model: resolvedModel(provider), configured: ready, detail };
}

interface ChatAllowance {
  provider: AiProviderConfig & { kind: ChatKind };
  def: ChatKindDef;
  endpoint: string;
  key: string | undefined;
  model: string;
}

/**
 * Governance gate for `aiChat`, enforced in this order: the global kill switch, then provider
 * resolution + readiness (there's no usable provider without both), then — opt-in, only when
 * `ctx` supplies the relevant field — the per-role model allowlist and the soft per-scope token
 * budget. Throws `AiError` on the first failure; returns everything the network call needs.
 */
async function assertChatAllowed(ctx: AiGovContext | undefined, messages: ChatMessage[]): Promise<ChatAllowance> {
  // Break-glass: the global kill switch hard-stops every model call.
  if (aiKillEngaged()) throw new AiError("AI is disabled by the kill switch.", 403);

  const provider = resolveProviderForCapability("chat");
  if (!provider) throw new AiError("No AI provider is configured.", 400);
  if (!isChatKind(provider.kind)) throw new AiError(`${provider.label} cannot serve chat.`, 400);
  if (!providerReady(provider.id)) {
    const need = provider.kind === "openai-compatible" ? "an endpoint URL" : "an API key";
    throw new AiError(`${provider.label} isn't ready — add ${need} in AI Providers.`, 400);
  }

  const def = KINDS[provider.kind];
  const endpoint = provider.endpoint?.trim() || def.endpoint;
  const key = provider.kind === "ollama" ? undefined : resolveProviderKey(provider.id) ?? undefined;
  const model = resolvedModel(provider);

  // Governance (opt-in): per-role model allowlist, then a soft per-scope token budget.
  if (ctx?.role && !modelAllowed(ctx.role, model)) {
    throw new AiError(`Model "${model}" is not permitted for your role.`, 403);
  }
  if (ctx?.scope) {
    const verdict = await checkBudget(ctx.scope, estimateTokens(messages));
    if (!verdict.ok) throw new AiError(`AI token budget exceeded (${verdict.used}/${verdict.limit} this window).`, 429);
  }

  return { provider: provider as AiProviderConfig & { kind: ChatKind }, def, endpoint, key, model };
}

/** Record approximate usage against the scope's running budget after a successful chat call
 *  (soft, best-effort) — a no-op unless `ctx` supplies a scope. */
async function recordChatUsage(ctx: AiGovContext | undefined, messages: ChatMessage[], content: string): Promise<void> {
  if (ctx?.scope) await recordUsage(ctx.scope, estimateTokens(messages) + estimateTokens([{ content }]));
}

/** Send a chat-completion to the resolved provider and return the reply. Throws AiError when
 *  no ready provider is configured or the upstream call fails.
 *
 *  `ctx` carries the optional governance scope (the caller's role + a budget scope, e.g. the
 *  user sub). All governance is opt-in: DLP redaction applies whenever AI_DLP_REDACT is on; the
 *  per-role model allowlist and token budget apply only when configured AND a `ctx` is supplied. */
export async function aiChat(messages: ChatMessage[], ctx?: AiGovContext): Promise<ChatResult> {
  const { provider, def, endpoint, key, model } = await assertChatAllowed(ctx, messages);

  // DLP: redact PII/secrets in the prompt BEFORE it egresses (when AI_DLP_REDACT is on).
  const outbound = dlpEnabled() ? redactForEgress(messages).messages : messages;
  const content = await def.chat(endpoint, key, model, outbound);

  await recordChatUsage(ctx, messages, content);
  // Meter this AI call+tokens against the provider vendor for the admin usage/cost screen (fleet-wide,
  // fire-and-forget — separate from the per-scope governance budget above).
  void recordVendorUsage(provider.kind, { calls: 1, tokens: estimateTokens(messages) + estimateTokens([{ content }]) }).catch(() => {});
  return { content, provider: provider.kind, model };
}
