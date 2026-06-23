export interface AiStatus {
  provider: "none" | "openai" | "ollama" | "anthropic" | "openrouter";
  model: string | null;
  configured: boolean;
  detail: string;
}

/** Ask the gateway which AI provider/model is active and whether it's ready. */
export async function fetchAiStatus(): Promise<AiStatus> {
  const res = await fetch("/api/ai/status", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`ai status failed: ${res.status}`);
  return (await res.json()) as AiStatus;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Send a chat completion through the gateway to the configured provider. */
export async function aiChat(messages: ChatMessage[]): Promise<{ content: string; provider: string; model: string }> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error || `ai chat failed: ${res.status}`);
  }
  return res.json();
}
