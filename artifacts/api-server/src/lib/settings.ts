/**
 * Gateway-local settings store.
 *
 * These configure the gateway itself (which n8n webhook to call, which AI
 * provider to use, etc.) and so are NOT brokered through n8n. In a multi-replica
 * deployment back this with a shared store (Redis/Postgres); the in-memory store
 * is sufficient for single-instance and demo use.
 */

import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "./url-safety";
import { DEPLOYMENT_PROFILES, setRuntimeProfile, type DeploymentProfile } from "./deployment-profile";
import type { BackendFieldMap } from "../broker/types";

function coerceProfile(raw: unknown): DeploymentProfile | undefined {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(v) ? (v as DeploymentProfile) : undefined;
}

export const AI_PROVIDERS = ["none", "openai", "ollama", "anthropic", "openrouter"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Coerce an untrusted value (env or request) to a valid AiProvider, else "none". */
function coerceAiProvider(raw: unknown): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(raw as string) ? (raw as AiProvider) : "none";
}

/** AI-assisted speech-to-text engines. "browser" = the device's own recogniser (local,
 *  zero audio egress); "whisper" = an OpenAI-compatible /audio/transcriptions endpoint
 *  (self-hosted Whisper server OR a cloud one). Whisper is just one provider. */
export const STT_PROVIDERS = ["none", "browser", "whisper"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];

function coerceSttProvider(raw: unknown): SttProvider {
  return (STT_PROVIDERS as readonly string[]).includes(raw as string) ? (raw as SttProvider) : "none";
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
  /** Theme: base font family applied to all screens (a CSS font-family stack).
   *  Font SIZE and background COLOUR are per-user (client-side a11y prefs), not here. */
  fontFamily: string | null;
}

/** Outbound webhook subscription (premium: gated by the `webhooks` entitlement). */
export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  description?: string | undefined;
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
  sttProvider: SttProvider;
  /** Deployment context chosen in the setup wizard (relaxes enterprise couplings by choice). */
  deploymentProfile?: DeploymentProfile;
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
  /**
   * Admin translation-layer overrides: per-field / per-entity surface+store that
   * REPLACE the broker-derived/declared capability map. Lets an admin correct a
   * mis-mapped field (e.g. force a field the auto-derivation hid back on, or hide
   * one the backend exposes but shouldn't). Config, never project data.
   */
  fieldOverrides: BackendFieldMap;
  /**
   * Per-screen layout overrides (drag-arranged panel order / spans / hidden), keyed
   * by screen id. Presentation config — part of the snapshot/export so it travels in
   * the customer's config JSON. Never project data.
   */
  screenLayouts: Record<string, ScreenLayout>;
  /**
   * Per-user UI preferences (accessibility: text size, background colour, contrast,
   * motion), keyed by the user's `sub`. Stored as JSON with code defaults so a
   * person's setup PERSISTS ACROSS SESSIONS and devices — important for users with
   * dyslexia / visual impairment. Personal config, never project data.
   */
  userPrefs: Record<string, UserPrefs>;
  /**
   * Admin data-governance for the governed capabilities (AI tools, the MCP, AI
   * providers and vendors), keyed by capability id. Off by default; the admin sets
   * each to off / user-defined / public (and, for AI tools, per-surface). Customer-
   * level config — rides the snapshot/export — never project data.
   */
  capabilityStates: Record<string, CapabilitySetting>;
  /**
   * Opt-OUT list of feature-module ids the operator has switched off (everything is on by
   * default). A module disabled at startup is never loaded (its route chunk is skipped); a
   * runtime disable makes it 404 at once. Customer-level config — rides the snapshot/export so
   * the chosen module set travels in the bundle — never project data. See lib/feature-modules.
   */
  disabledFeatures: string[];
}

/** One user's persisted UI/accessibility preferences. */
export interface UserPrefs {
  fontScale: number;
  backgroundColor: string | null;
  highContrast: boolean;
  reduceMotion: boolean;
  /** Switch-access scanning: off, single-switch (auto-scan) or two-switch (step). */
  switchScan: "off" | "single" | "two";
  /** Auto-scan dwell time per item, ms (single-switch only). */
  scanRateMs: number;
  /** Verbose live-region announcements to aid screen-reader users. */
  screenReader: boolean;
  /** Show the dictation mic (on-device speech-to-text via the user's own browser). */
  speechInput: boolean;
  /** Touch-optimised mobile layout: follow the device (auto) or force on/off. */
  mobileMode: "auto" | "on" | "off";
}

/**
 * The deployment state of a governed capability (an AI tool, the MCP, an AI provider
 * or a vendor):
 *   - "off"          — not used.
 *   - "user-defined" — runs somewhere the CUSTOMER controls: truly local (on-device /
 *                      in-cluster) or a customer-owned remote endpoint. Private.
 *   - "public"       — a third-party SaaS provider.
 * Each capability advertises only the states it actually supports; the UI offers those.
 */
export type DeploymentState = "off" | "user-defined" | "public";

/** An admin's chosen state for one governed capability (customer-level JSON). */
export interface CapabilitySetting {
  /** The chosen state. Ignored (treated as "off") if the capability can't support it. */
  state: DeploymentState;
  /** For "user-defined": the customer's own endpoint (local or remote). */
  endpoint?: string | null;
  /**
   * Per-surface overrides for AI tools — a screen/context id → state. Lets one piece
   * of AI be set differently per screen (e.g. TTS public everywhere but "user-defined"
   * or "off" on the finance screen). Only honoured for surface-aware capabilities.
   */
  surfaces?: Record<string, DeploymentState>;
}

/** A saved arrangement for one screen. */
export interface ScreenLayout {
  /** Panel ids in display order (panels not listed keep their original order, after). */
  order?: string[];
  /** Per-panel grid span override (1–12). */
  spans?: Record<string, number>;
  /** Panel ids hidden from this screen. */
  hidden?: string[];
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
    fontFamily: process.env["BRAND_FONT_FAMILY"]?.trim() || null,
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

/** Feature-module ids disabled via env (`DISABLED_FEATURES=odata,integrations`). */
function disabledFeaturesFromEnv(): string[] {
  return (process.env["DISABLED_FEATURES"]?.trim() || "").split(/[\s,]+/).filter(Boolean);
}

const initialProfile = coerceProfile(process.env["DEPLOYMENT_PROFILE"]);
const store: SettingsState = {
  brokerUrl: process.env["BROKER_URL"]?.trim() || null,
  aiProvider: coerceAiProvider(process.env["AI_PROVIDER"]?.trim() || "none"),
  sttProvider: coerceSttProvider(process.env["STT_PROVIDER"]?.trim() || "none"),
  // Omit (rather than set undefined) when no profile is configured — exactOptionalPropertyTypes.
  ...(initialProfile !== undefined ? { deploymentProfile: initialProfile } : {}),
  aiModel: process.env["AI_MODEL"] ?? null,
  backendSource: process.env["BACKEND_SOURCE"]?.trim() || "all",
  oidcIssuerUrl: process.env["OIDC_ISSUER_URL"] ?? null,
  branding: brandingFromEnv(),
  labelOverrides: labelsFromEnv(),
  webhooks: webhooksFromEnv(),
  loggingSync: loggingSyncFromEnv(),
  fieldOverrides: { fields: {}, entities: {} },
  screenLayouts: {},
  userPrefs: {},
  capabilityStates: {},
  disabledFeatures: disabledFeaturesFromEnv(),
};

/** True when historical time-travel is available (operator opted into egress). */
export function isTimeTravelEnabled(): boolean {
  return store.loggingSync.enabled;
}

const ALLOWED_KEYS: (keyof SettingsState)[] = [
  "brokerUrl",
  "aiProvider",
  "sttProvider",
  "deploymentProfile",
  "aiModel",
  "backendSource",
  "oidcIssuerUrl",
  "branding",
  "labelOverrides",
  "webhooks",
  "loggingSync",
  "fieldOverrides",
  "screenLayouts",
  "userPrefs",
  "capabilityStates",
  "disabledFeatures",
];

/** A snapshot copy of the current in-memory settings (never the live reference). */
export function getSettings(): SettingsState {
  return { ...store };
}

/**
 * A read-safe view of settings for the GET endpoint. `GET /settings` is readable
 * by any authenticated session — including read-only API tokens — so webhook
 * signing secrets must never be returned over it. Masks them; everything else
 * (which the admin UI needs) is preserved.
 */
export function redactSettingsForRead(s: SettingsState): SettingsState {
  return { ...s, webhooks: s.webhooks.map((w) => ({ ...w, secret: w.secret ? "********" : "" })) };
}

/**
 * Validate an untrusted settings patch before it is written. Only the fields
 * present in the patch are checked. Throws `SettingsValidationError` on the first
 * problem so the route can answer 400 instead of persisting a malformed config
 * (e.g. an `aiProvider` the AI layer can't resolve, or an unsafe outbound URL).
 */
/** A map of key → {surface, store} booleans, or throw. */
function validateSupportMap(value: unknown, what: string): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError(`fieldOverrides.${what} must be an object`);
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (!v || typeof v !== "object") throw new SettingsValidationError(`each ${what} override must be an object`);
    const { surface, store } = v as Record<string, unknown>;
    if (typeof surface !== "boolean" || typeof store !== "boolean") {
      throw new SettingsValidationError(`each ${what} override needs boolean surface and store`);
    }
  }
}

function validateFieldOverrides(value: unknown): void {
  if (typeof value !== "object" || value == null) throw new SettingsValidationError("fieldOverrides must be an object");
  const o = value as Record<string, unknown>;
  if ("fields" in o) validateSupportMap(o["fields"], "fields");
  if ("entities" in o) validateSupportMap(o["entities"], "entities");
}

function validatePatch(patch: Record<string, unknown>): void {
  if ("aiProvider" in patch && !(AI_PROVIDERS as readonly string[]).includes(patch["aiProvider"] as string)) {
    throw new SettingsValidationError(`aiProvider must be one of: ${AI_PROVIDERS.join(", ")}`);
  }
  if ("sttProvider" in patch && !(STT_PROVIDERS as readonly string[]).includes(patch["sttProvider"] as string)) {
    throw new SettingsValidationError(`sttProvider must be one of: ${STT_PROVIDERS.join(", ")}`);
  }
  if ("deploymentProfile" in patch && patch["deploymentProfile"] != null && !(DEPLOYMENT_PROFILES as readonly string[]).includes(patch["deploymentProfile"] as string)) {
    throw new SettingsValidationError(`deploymentProfile must be one of: ${DEPLOYMENT_PROFILES.join(", ")}`);
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
  if ("disabledFeatures" in patch) {
    const v = patch["disabledFeatures"];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError("disabledFeatures must be an array of strings");
    }
  }
  if ("fieldOverrides" in patch) validateFieldOverrides(patch["fieldOverrides"]);
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

/** Validate + apply a partial settings patch, returning the new settings. Throws
 *  SettingsValidationError on bad input (rejected atomically — nothing persists). */
export function updateSettings(patch: Record<string, unknown>): SettingsState {
  validatePatch(patch);
  const writable = store as unknown as Record<string, unknown>;
  for (const key of ALLOWED_KEYS) {
    if (key in patch) {
      writable[key] = patch[key];
    }
  }
  // A profile change takes effect for the runtime accessors (TLS posture, reporting, …).
  if ("deploymentProfile" in patch) setRuntimeProfile(store.deploymentProfile ?? null);
  return { ...store };
}

// Apply the initial (env-seeded) profile to the runtime accessor at module load.
setRuntimeProfile(store.deploymentProfile ?? null);
