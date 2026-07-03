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
    // Send the current screen so the gateway can apply per-surface AI governance
    // (the server normalises this route to a registry screen id).
    body: JSON.stringify({ messages, surface: typeof window !== "undefined" ? window.location.pathname : undefined }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error || `ai chat failed: ${res.status}`);
  }
  return res.json();
}

/** Ask the gateway's AI to draft a starting-point backend definition for an unlisted
 *  vendor (admin-gated; off unless an admin has turned the "AI backend-draft
 *  suggestions" capability on). Returns a manifest-shaped object with no `actions` —
 *  feed it straight into `parseBackendFile`/`toDraft` (lib/backend-authoring), the
 *  same path an uploaded file already takes. */
export async function suggestBackend(vendorName: string, hint?: string): Promise<Record<string, unknown>> {
  const res = await fetch("/api/ai/suggest-backend", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendorName, hint, surface: typeof window !== "undefined" ? window.location.pathname : undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `suggestion failed: ${res.status}`);
  return (data as { manifest: Record<string, unknown> }).manifest;
}
