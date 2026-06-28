import { getSettings, type AiProvider } from "./settings";
import { aiKillEngaged } from "./ai-kill";
import {
  resolveProviderForCapability,
  resolveProviderKey,
  providerReady,
  type AiProviderConfig,
  type AiProviderKind,
} from "./ai-providers";

/**
 * AI provider client. Providers are first-class entities (lib/ai-providers) and their API
 * KEYS live in the encrypted vault (lib/vault) — NOT in the environment. Which provider
 * serves chat is the resolution of the "chat" capability mapping (falling back to the
 * Settings default). This module owns only HOW to talk to each provider KIND.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
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
type ChatKind = "openai" | "anthropic" | "ollama" | "openrouter";
interface ChatKindDef {
  endpoint: string;
  chat(endpoint: string, key: string | undefined, model: string, messages: ChatMessage[]): Promise<string>;
}

const KINDS: Record<ChatKind, ChatKindDef> = {
  ollama: {
    endpoint: OLLAMA_DEFAULT,
    chat: async (endpoint, _key, model, messages) => {
      const json = (await postJson(`${endpoint}/api/chat`, {}, { model, messages, stream: false })) as { message?: { content?: string } };
      return json.message?.content ?? "";
    },
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1",
    chat: async (endpoint, key, model, messages) => {
      const json = (await postJson(
        `${endpoint}/chat/completions`,
        { Authorization: `Bearer ${key}`, "HTTP-Referer": "https://github.com/walshd1/Omniproject", "X-Title": "OmniProject" },
        { model, messages },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content ?? "";
    },
  },
  openai: {
    endpoint: "https://api.openai.com/v1",
    chat: async (endpoint, key, model, messages) => {
      const json = (await postJson(
        `${endpoint}/chat/completions`,
        { Authorization: `Bearer ${key}` },
        { model, messages },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content ?? "";
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
        { model, max_tokens: 1024, system, messages: turns },
      )) as { content?: Array<{ text?: string }> };
      return json.content?.[0]?.text ?? "";
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
    : ready
      ? `${provider.label} ready (key in vault).`
      : `Add an API key for ${provider.label} in AI Providers.`;
  return { provider: provider.kind, model: resolvedModel(provider), configured: ready, detail };
}

/** Send a chat-completion to the resolved provider and return the reply. Throws AiError when
 *  no ready provider is configured or the upstream call fails. */
export async function aiChat(messages: ChatMessage[]): Promise<ChatResult> {
  // Break-glass: the global kill switch hard-stops every model call.
  if (aiKillEngaged()) throw new AiError("AI is disabled by the kill switch.", 403);

  const provider = resolveProviderForCapability("chat");
  if (!provider) throw new AiError("No AI provider is configured.", 400);
  if (!isChatKind(provider.kind)) throw new AiError(`${provider.label} cannot serve chat.`, 400);
  if (!providerReady(provider.id)) {
    throw new AiError(`No API key for ${provider.label}. Add one in AI Providers.`, 400);
  }

  const def = KINDS[provider.kind];
  const endpoint = provider.endpoint?.trim() || def.endpoint;
  const key = provider.kind === "ollama" ? undefined : resolveProviderKey(provider.id) ?? undefined;
  const model = resolvedModel(provider);
  const content = await def.chat(endpoint, key, model, messages);
  return { content, provider: provider.kind, model };
}
