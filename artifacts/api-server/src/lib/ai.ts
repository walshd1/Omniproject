import { getSettings, type AiProvider } from "./settings";

/**
 * AI provider client. Users choose, in Settings, between a local model (Ollama)
 * and a public model via OpenRouter (OpenAI / Anthropic are also supported since
 * they're in the provider enum). API keys come from the environment; the model
 * is taken from settings with a per-provider default.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const OLLAMA_URL = process.env["OLLAMA_URL"]?.trim() || "http://localhost:11434";
const OPENROUTER_API_KEY = process.env["OPENROUTER_API_KEY"]?.trim();
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"]?.trim();
const ANTHROPIC_API_KEY = process.env["ANTHROPIC_API_KEY"]?.trim();

const DEFAULT_MODEL: Record<AiProvider, string> = {
  none: "",
  ollama: "llama3.2",
  openrouter: "openrouter/auto",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

export interface AiStatus {
  provider: AiProvider;
  model: string | null;
  configured: boolean;
  detail: string;
}

function resolvedModel(provider: AiProvider): string {
  return getSettings().aiModel?.trim() || DEFAULT_MODEL[provider];
}

/** Report whether AI assist is configured + which provider/model is active. */
export function aiStatus(): AiStatus {
  const provider = getSettings().aiProvider;
  const model = provider === "none" ? null : resolvedModel(provider);

  switch (provider) {
    case "none":
      return { provider, model, configured: false, detail: "No AI provider selected." };
    case "ollama":
      return { provider, model, configured: true, detail: `Local model via Ollama at ${OLLAMA_URL}.` };
    case "openrouter":
      return {
        provider,
        model,
        configured: !!OPENROUTER_API_KEY,
        detail: OPENROUTER_API_KEY ? "Public model via OpenRouter." : "Set OPENROUTER_API_KEY to enable OpenRouter.",
      };
    case "openai":
      return {
        provider,
        model,
        configured: !!OPENAI_API_KEY,
        detail: OPENAI_API_KEY ? "OpenAI configured." : "Set OPENAI_API_KEY to enable OpenAI.",
      };
    case "anthropic":
      return {
        provider,
        model,
        configured: !!ANTHROPIC_API_KEY,
        detail: ANTHROPIC_API_KEY ? "Anthropic configured." : "Set ANTHROPIC_API_KEY to enable Anthropic.",
      };
    default:
      // Unreachable for a validated AiProvider, but keeps the function total so a
      // bad stored value degrades to "not configured" instead of returning undefined.
      return { provider: "none", model: null, configured: false, detail: "No AI provider selected." };
  }
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

/** Send a chat-completion to the configured provider and return the reply. Throws
 *  AiError when no provider is configured or the upstream call fails. */
export async function aiChat(messages: ChatMessage[]): Promise<ChatResult> {
  const provider = getSettings().aiProvider;
  const model = resolvedModel(provider);
  const status = aiStatus();

  if (provider === "none") {
    throw new AiError("No AI provider is configured.", 400);
  }
  if (!status.configured) {
    throw new AiError(status.detail, 400);
  }

  switch (provider) {
    case "ollama": {
      const json = (await postJson(`${OLLAMA_URL}/api/chat`, {}, { model, messages, stream: false })) as {
        message?: { content?: string };
      };
      return { content: json.message?.content ?? "", provider, model };
    }

    case "openrouter": {
      const json = (await postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://github.com/walshd1/Omniproject",
          "X-Title": "OmniProject",
        },
        { model, messages },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      return { content: json.choices?.[0]?.message?.content ?? "", provider, model };
    }

    case "openai": {
      const json = (await postJson(
        "https://api.openai.com/v1/chat/completions",
        { Authorization: `Bearer ${OPENAI_API_KEY}` },
        { model, messages },
      )) as { choices?: Array<{ message?: { content?: string } }> };
      return { content: json.choices?.[0]?.message?.content ?? "", provider, model };
    }

    case "anthropic": {
      // Anthropic keeps the system prompt separate and requires max_tokens.
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
      const turns = messages.filter((m) => m.role !== "system");
      const json = (await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
        { model, max_tokens: 1024, system, messages: turns },
      )) as { content?: Array<{ text?: string }> };
      return { content: json.content?.[0]?.text ?? "", provider, model };
    }

    default:
      throw new AiError("Unsupported provider.", 400);
  }
}
