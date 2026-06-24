/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which n8n webhook to call, which AI
 * provider to use, etc.) and so are NOT brokered through n8n. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

export type AiProvider = "none" | "openai" | "ollama" | "anthropic" | "openrouter";
// Free-form backend routing hint passed to n8n. "all" = no filter (whatever
// n8n is wired to). No specific backend (Plane/OpenProject/…) is required.
export type BackendSource = string;

/** White-label branding (premium: gated by the `branding` entitlement). */
export interface BrandingConfig {
  appName: string | null;
  shortName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  loginHeading: string | null;
  footerText: string | null;
  supportUrl: string | null;
}

/** Outbound webhook subscription (premium: gated by the `webhooks` entitlement). */
export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  description?: string;
}

export interface SettingsState {
  /** The active broker's webhook/endpoint URL (n8n by default). */
  brokerUrl: string | null;
  aiProvider: AiProvider;
  aiModel: string | null;
  backendSource: BackendSource;
  oidcIssuerUrl: string | null;
  /** White-label branding overrides (null/empty → product defaults). */
  branding: BrandingConfig | null;
  /** Company-nomenclature label overrides, keyed by i18n key. */
  labelOverrides: Record<string, string>;
  /** Outbound webhook subscriptions. */
  webhooks: WebhookSubscription[];
}

function brandingFromEnv(): BrandingConfig | null {
  const b: BrandingConfig = {
    appName: process.env["BRAND_APP_NAME"]?.trim() || null,
    shortName: process.env["BRAND_SHORT_NAME"]?.trim() || null,
    logoUrl: process.env["BRAND_LOGO_URL"]?.trim() || null,
    primaryColor: process.env["BRAND_PRIMARY_COLOR"]?.trim() || null,
    loginHeading: process.env["BRAND_LOGIN_HEADING"]?.trim() || null,
    footerText: process.env["BRAND_FOOTER_TEXT"]?.trim() || null,
    supportUrl: process.env["BRAND_SUPPORT_URL"]?.trim() || null,
  };
  return Object.values(b).some(Boolean) ? b : null;
}

function labelsFromEnv(): Record<string, string> {
  const raw = process.env["LABEL_OVERRIDES"]?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function webhooksFromEnv(): WebhookSubscription[] {
  const raw = process.env["WEBHOOKS"]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .map((w, i) => ({
        id: typeof w["id"] === "string" ? (w["id"] as string) : `env-${i + 1}`,
        url: String(w["url"] ?? ""),
        secret: typeof w["secret"] === "string" ? (w["secret"] as string) : "",
        events: Array.isArray(w["events"]) ? (w["events"] as unknown[]).map(String) : ["*"],
        active: w["active"] !== false,
        description: typeof w["description"] === "string" ? (w["description"] as string) : undefined,
      }))
      .filter((w) => /^https?:\/\//i.test(w.url));
  } catch {
    return [];
  }
}

const store: SettingsState = {
  brokerUrl: process.env["BROKER_URL"]?.trim() || null,
  aiProvider: (process.env["AI_PROVIDER"] as AiProvider) || "none",
  aiModel: process.env["AI_MODEL"] ?? null,
  backendSource: process.env["BACKEND_SOURCE"]?.trim() || "all",
  oidcIssuerUrl: process.env["OIDC_ISSUER_URL"] ?? null,
  branding: brandingFromEnv(),
  labelOverrides: labelsFromEnv(),
  webhooks: webhooksFromEnv(),
};

const ALLOWED_KEYS: (keyof SettingsState)[] = [
  "brokerUrl",
  "aiProvider",
  "aiModel",
  "backendSource",
  "oidcIssuerUrl",
  "branding",
  "labelOverrides",
  "webhooks",
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
