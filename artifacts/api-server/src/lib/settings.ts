/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which n8n webhook to call, which AI
 * provider to use, etc.) and so are NOT brokered through n8n. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

export type AiProvider = "none" | "openai" | "ollama" | "anthropic" | "openrouter";
export type BackendSource = "plane" | "openproject" | "both";

export interface SettingsState {
  n8nWebhookUrl: string | null;
  aiProvider: AiProvider;
  aiModel: string | null;
  backendSource: BackendSource;
  oidcIssuerUrl: string | null;
}

const store: SettingsState = {
  n8nWebhookUrl: process.env["N8N_WEBHOOK_URL"] ?? null,
  aiProvider: (process.env["AI_PROVIDER"] as AiProvider) || "none",
  aiModel: process.env["AI_MODEL"] ?? null,
  backendSource: (process.env["BACKEND_SOURCE"] as BackendSource) || "plane",
  oidcIssuerUrl: process.env["OIDC_ISSUER_URL"] ?? null,
};

const ALLOWED_KEYS: (keyof SettingsState)[] = [
  "n8nWebhookUrl",
  "aiProvider",
  "aiModel",
  "backendSource",
  "oidcIssuerUrl",
];

export function getSettings(): SettingsState {
  return { ...store };
}

export function updateSettings(patch: Record<string, unknown>): SettingsState {
  const writable = store as unknown as Record<string, unknown>;
  for (const key of ALLOWED_KEYS) {
    if (key in patch) {
      writable[key] = patch[key];
    }
  }
  return { ...store };
}
