import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * AI Providers client (admin). Providers are first-class entities; each provider's API key
 * lives in the encrypted vault and is WRITE-ONLY — the API never returns it, only presence
 * (`hasKey`) + a short `fingerprint`. Capabilities map to an ordered provider list.
 */
export type AiProviderKind = "openai" | "anthropic" | "ollama" | "openrouter" | "whisper";

export interface AiProviderRow {
  id: string;
  kind: AiProviderKind;
  label: string;
  endpoint?: string;
  model?: string;
  hasKey: boolean;
  fingerprint: string | null;
  ready: boolean;
}

export interface AiCapabilityDef { id: string; label: string; surface: "chat" | "stt" }

export interface AiProvidersView {
  providers: AiProviderRow[];
  mapping: Record<string, string[]>;
  kinds: AiProviderKind[];
  capabilities: AiCapabilityDef[];
  /** Which secrets store holds the keys (local file vs an external manager). */
  vault?: { backend: string; backends: string[] };
}

/** The provider registry + capability map (admin). No secrets are present in the payload. */
export function useAiProviders() {
  return useQuery<AiProvidersView>({
    queryKey: ["ai-providers"],
    queryFn: () => getJson("/api/ai/providers"),
    staleTime: 10_000,
  });
}

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(detail.code === "step_up_required" ? "step_up_required" : detail.error ?? `Failed (${res.status})`);
  }
}

/** Add or update a provider entity (admin; step-up gated server-side). */
export function upsertProvider(p: { id: string; kind: AiProviderKind; label: string; endpoint?: string; model?: string }): Promise<void> {
  return send("/api/ai/providers", "POST", p);
}

/** Remove a provider entity and its stored key. */
export function removeProvider(id: string): Promise<void> {
  return send(`/api/ai/providers/${encodeURIComponent(id)}`, "DELETE");
}

/** Store a provider's API key in the vault (write-only; never echoed back). */
export function setProviderKey(id: string, key: string): Promise<void> {
  return send(`/api/ai/providers/${encodeURIComponent(id)}/key`, "PUT", { key });
}

/** Remove a provider's stored key. */
export function clearProviderKey(id: string): Promise<void> {
  return send(`/api/ai/providers/${encodeURIComponent(id)}/key`, "DELETE");
}

/** Set the ordered provider list for a capability. */
export function setCapabilityProviders(cap: string, providers: string[]): Promise<void> {
  return send(`/api/ai/capabilities/${encodeURIComponent(cap)}`, "PUT", { providers });
}
