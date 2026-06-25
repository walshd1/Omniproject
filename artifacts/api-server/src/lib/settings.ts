/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which n8n webhook to call, which AI
 * provider to use, etc.) and so are NOT brokered through n8n. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "./url-safety";

export const AI_PROVIDERS = ["none", "openai", "ollama", "anthropic", "openrouter"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Coerce an untrusted value (env or request) to a valid AiProvider, else "none". */
function coerceAiProvider(raw: unknown): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(raw as string) ? (raw as AiProvider) : "none";
}

/** Thrown when an admin settings write fails validation; the route maps it to 400. */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}
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

/**
 * Opt-in state-history egress to an operator-owned logging server. OFF by
 * default. This is the ONE deliberate relaxation of OmniProject's "nothing
 * leaves" posture — the same trust class as the OData/Prometheus/Power-BI feeds:
 * data egresses, by explicit admin choice, to a destination the operator controls
 * and is responsible for. Enabling it unlocks historical time-travel. The
 * operator must acknowledge that egressed data is outside OmniProject's warranty.
 */
export interface LoggingSyncConfig {
  enabled: boolean;
  url: string | null;
  /** The admin acknowledged that egressed data leaves OmniProject's warranty. */
  acknowledgedWarranty: boolean;
}

const DEFAULT_LOGGING_SYNC: LoggingSyncConfig = { enabled: false, url: null, acknowledgedWarranty: false };

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
  /** Opt-in state-history egress to an operator-owned logging server (off by default). */
  loggingSync: LoggingSyncConfig;
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
      // Apply the SAME safety check as admin writes, so an env-seeded unsafe URL
      // (e.g. a link-local/metadata target) is dropped at load rather than being
      // admitted here and then blocking every later validated webhook mutation.
      .filter((w) => isSafeOutboundUrl(w.url));
  } catch {
    return [];
  }
}

function loggingSyncFromEnv(): LoggingSyncConfig {
  const url = process.env["LOGGING_SYNC_URL"]?.trim() || null;
  // Env-provided config is operator-trusted; still drop an unsafe URL and only
  // enable when the warranty was explicitly acknowledged via env.
  const ack = process.env["LOGGING_SYNC_ACK_WARRANTY"] === "true";
  const safe = url ? isSafeOutboundUrl(url) : false;
  return {
    enabled: !!url && safe && ack,
    url: safe ? url : null,
    acknowledgedWarranty: ack,
  };
}

const store: SettingsState = {
  brokerUrl: process.env["BROKER_URL"]?.trim() || null,
  aiProvider: coerceAiProvider(process.env["AI_PROVIDER"]?.trim() || "none"),
  aiModel: process.env["AI_MODEL"] ?? null,
  backendSource: process.env["BACKEND_SOURCE"]?.trim() || "all",
  oidcIssuerUrl: process.env["OIDC_ISSUER_URL"] ?? null,
  branding: brandingFromEnv(),
  labelOverrides: labelsFromEnv(),
  webhooks: webhooksFromEnv(),
  loggingSync: loggingSyncFromEnv(),
};

/** True when historical time-travel is available (operator opted into egress). */
export function isTimeTravelEnabled(): boolean {
  return store.loggingSync.enabled;
}

const ALLOWED_KEYS: (keyof SettingsState)[] = [
  "brokerUrl",
  "aiProvider",
  "aiModel",
  "backendSource",
  "oidcIssuerUrl",
  "branding",
  "labelOverrides",
  "webhooks",
  "loggingSync",
];

export function getSettings(): SettingsState {
  return { ...store };
}

/**
 * Validate an untrusted settings patch before it is written. Only the fields
 * present in the patch are checked. Throws `SettingsValidationError` on the first
 * problem so the route can answer 400 instead of persisting a malformed config
 * (e.g. an `aiProvider` the AI layer can't resolve, or an unsafe outbound URL).
 */
function validatePatch(patch: Record<string, unknown>): void {
  if ("aiProvider" in patch && !(AI_PROVIDERS as readonly string[]).includes(patch["aiProvider"] as string)) {
    throw new SettingsValidationError(`aiProvider must be one of: ${AI_PROVIDERS.join(", ")}`);
  }
  for (const key of ["brokerUrl", "oidcIssuerUrl"] as const) {
    if (key in patch && patch[key] != null) {
      if (typeof patch[key] !== "string") throw new SettingsValidationError(`${key} must be a string or null`);
      try {
        assertSafeOutboundUrl(patch[key] as string, key);
      } catch (err) {
        throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : `${key} is invalid`);
      }
    }
  }
  if ("webhooks" in patch) {
    const webhooks = patch["webhooks"];
    if (!Array.isArray(webhooks)) throw new SettingsValidationError("webhooks must be an array");
    for (const w of webhooks) {
      if (!w || typeof w !== "object") throw new SettingsValidationError("each webhook must be an object");
      const url = (w as Record<string, unknown>)["url"];
      if (typeof url !== "string") throw new SettingsValidationError("each webhook needs a url string");
      try {
        assertSafeOutboundUrl(url, "webhook url");
      } catch (err) {
        throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "webhook url is invalid");
      }
    }
  }
  if ("branding" in patch && patch["branding"] != null && typeof patch["branding"] !== "object") {
    throw new SettingsValidationError("branding must be an object or null");
  }
  if ("labelOverrides" in patch && (typeof patch["labelOverrides"] !== "object" || patch["labelOverrides"] == null)) {
    throw new SettingsValidationError("labelOverrides must be an object");
  }
  if ("loggingSync" in patch) {
    const sync = patch["loggingSync"];
    if (!sync || typeof sync !== "object") throw new SettingsValidationError("loggingSync must be an object");
    const { enabled, url, acknowledgedWarranty } = sync as Record<string, unknown>;
    if (url != null) {
      if (typeof url !== "string") throw new SettingsValidationError("loggingSync.url must be a string or null");
      try {
        assertSafeOutboundUrl(url, "loggingSync.url");
      } catch (err) {
        throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "loggingSync.url is invalid");
      }
    }
    if (enabled === true) {
      // Egress is the one out-of-warranty relaxation: it can only be turned on
      // with a destination AND an explicit acknowledgement of the warranty boundary.
      if (typeof url !== "string" || !url) throw new SettingsValidationError("enable the logging sync requires a url");
      if (acknowledgedWarranty !== true) {
        throw new SettingsValidationError("enabling the logging sync requires acknowledging that egressed data is outside OmniProject's warranty");
      }
    }
  }
}

export function updateSettings(patch: Record<string, unknown>): SettingsState {
  validatePatch(patch);
  const writable = store as unknown as Record<string, unknown>;
  for (const key of ALLOWED_KEYS) {
    if (key in patch) {
      writable[key] = patch[key];
    }
  }
  return { ...store };
}
