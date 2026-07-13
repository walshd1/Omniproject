import { isSafeOutboundUrl } from "./url-safety";
import { samlConfigStatusFrom } from "./saml";
import { productionSignals } from "./dev-mode-guard";

/**
 * Validated, typed environment access — the zero-trust stance applied to configuration:
 * env vars are UNTRUSTED input too, so read them through typed accessors that enforce a rule
 * (presence, type, range, format) instead of scattering `process.env[X]` casts. `envFlag`
 * lives in lib/env; this adds the typed string/int/url/enum accessors and a boot-time check
 * of the SECURITY-CRITICAL vars so a misconfigured production deployment fails loudly, not
 * silently with a weak default.
 */

/** A trimmed string env var, or `fallback` (default undefined) when unset/empty. */
export function envStr(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

/** An integer env var validated against an optional range; falls back when unset/invalid. */
export function envInt(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  if (opts.min !== undefined && n < opts.min) return fallback;
  if (opts.max !== undefined && n > opts.max) return fallback;
  return n;
}

/** One of a fixed set; falls back when unset or not in the set. */
export function envEnum<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const v = process.env[name]?.trim() as T | undefined;
  return v && (values as readonly string[]).includes(v) ? v : fallback;
}

/** An http(s) URL that passes the outbound-safety guard (no metadata/link-local), or undefined. */
export function envUrl(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && isSafeOutboundUrl(v) ? v : undefined;
}

/**
 * The one affirmative-flag vocabulary for the whole codebase: `1` / `true` / `on` / `yes`
 * (case-insensitive, trimmed). Use this for an already-extracted string value; use `envBool`
 * (which shares it) when reading straight from an env var by name. Consolidating on one parser
 * means a toggle like `X=on` behaves identically everywhere instead of per-site guesswork.
 */
export function isTruthy(value: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(value?.trim() ?? "");
}

/** Is this env var set to a truthy flag (per `isTruthy`)? Unset ⇒ false. Takes an explicit env
 *  map (defaulting to `process.env`) so callers like `checkRequiredEnv` can evaluate an arbitrary
 *  env object, not just the live process. */
export function envBool(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env[name]);
}

/**
 * Every environment variable name OmniProject reads somewhere in the codebase. Used only by
 * `detectEnvVarTypos`, below — kept as a flat list rather than derived from anything, since
 * there's no single source of truth to generate it from (env vars are read ad hoc via
 * `process.env[name]` throughout `lib/`, `routes/`, and `index.ts`).
 */
const KNOWN_ENV_VARS = [
  "AI_BUDGET_WINDOW_HOURS", "AI_DLP_REDACT", "AI_KEY_MAX_AGE_DAYS", "AI_MODEL", "AI_MODEL_ALLOWLIST",
  "AI_PROVIDER", "AI_TOKEN_BUDGET", "API_TOKENS", "AUDIT_BATCH", "AUDIT_FLUSH_MS", "AUDIT_HTTP_TOKEN",
  "AUDIT_HTTP_URL", "AUDIT_KEY", "AUDIT_LEVEL", "AUTH_RATE_LIMIT_MAX", "AUTONOMOUS_SESSION_SECONDS",
  "AWS_ACCESS_KEY_ID", "AWS_REGION", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "BACKEND_SOURCE", "BRAND_APP_NAME", "BRAND_FONT_FAMILY",
  "BRAND_FOOTER_TEXT", "BRAND_LOGIN_HEADING", "BRAND_LOGO_URL", "BRAND_PRIMARY_COLOR", "BRAND_SHORT_NAME",
  "BRAND_SUPPORT_URL", "BROKER_CAPTURE", "BROKER_LOG_SIZE", "BROKER_MTLS_CA", "BROKER_MTLS_CERT",
  "BROKER_MTLS_INSECURE", "BROKER_MTLS_KEY", "BROKER_PSK", "BROKER_TRACE", "BROKER_URL",
  "BREAK_GLASS_TOKEN",
  "BUSINESS_FIELD_RULES", "BUSINESS_RULE_MODES", "CAPABILITIES", "CONFIG_KEY_ENC", "CONFIG_KEY_RAW",
  "CONTENT_SECURITY_POLICY", "COPILOT_PERSONAS", "CSP_CONNECT_SRC", "CSP_REPORT_ONLY", "CSP_REPORT_URI",
  "CSRF_DISABLED", "CSRF_TRUSTED_ORIGINS", "DATA_RESIDENCY_POLICY", "DEPLOYMENT_PROFILE",
  "DEV_PERSIST_FILE", "DISABLED_FEATURES", "DRIFT_CANARY_INTERVAL_HOURS", "DUAL_CONTROL_ACTIONS",
  "EGRESS_ALLOWLIST", "EMAIL_FROM", "ENABLED_FEATURES", "EXEC_DIGEST_INTERVAL_HOURS", "FEDERATED_PEERS",
  "FEDERATION_SELF_LABEL", "FX_RATE_AS_OF_DATE", "FX_RATE_POLICY", "IMPOSSIBLE_TRAVEL_MAX_KMH",
  "IMPOSSIBLE_TRAVEL_MIN_KM", "IP_ALLOWLIST", "KMS_PROVIDER", "LABEL_OVERRIDES", "LICENSE_DEV_FEATURES",
  "LICENSE_KEY", "LICENSE_PUBLIC_KEY", "LOG_LEVEL", "LOGGING_SYNC_ACK_WARRANTY", "LOGGING_SYNC_URL",
  "MAGIC_LINK_ENABLED", "MAGIC_LINK_TTL_MINUTES", "MAX_SESSIONS_PER_USER", "NODE_ENV",
  "NOTIFY_INGEST_SECRET", "OIDC_ADMIN_ROLES", "OIDC_DEFAULT_ROLE", "OIDC_ISSUER_URL", "OIDC_LABEL",
  "OIDC_MANAGER_ROLES", "OIDC_PMO_ROLES", "OIDC_PROVIDERS", "OIDC_SKIP_TOKEN_VERIFY", "OLLAMA_URL",
  "OMNI_CONFIG_DIR", "OMNI_DEV_MODE", "OMNI_DEV_MODE_ACK_INSECURE", "OMNI_MESSY_DATA",
  "OMNI_MESSY_GREMLINS", "OMNI_MESSY_INTENSITY", "OMNI_MESSY_SEED", "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_METRIC_EXPORT_INTERVAL", "OTEL_SERVICE_NAME", "PORT",
  "PREMIUM_ENFORCEMENT", "PROACTIVE_DIGEST_INTERVAL_HOURS", "PROPTEST_RUNS", "PROPTEST_SEED",
  "PROVENANCE_KEY", "PUBLIC_URL", "RATE_CARD_FILE", "RATE_CARD_KEY", "RATE_LIMIT_DISABLED",
  "READ_CACHE_TTL_MS", "REDIS_URL", "REPLICA_ID", "REPORTING_CURRENCY", "SAML_ACR_ATTR",
  "SAML_AUDIENCE", "SAML_CALLBACK_URL", "SAML_EMAIL_ATTR", "SAML_ENTRY_POINT", "SAML_GROUPS_ATTR",
  "SAML_IDP_CERT", "SAML_IDP_ENTRY_POINT", "SAML_NAME_ATTR", "SAML_SP_ENTITY_ID",
  "SAML_WANT_RESPONSE_SIGNED", "SCIM_TOKEN", "SECURITY_CONTACT_URL", "SECURITY_POLICY_URL",
  "SECURITY_STATE_FILE", "SECURITY_STRICT", "SESSION_ABSOLUTE_HOURS", "SESSION_IDLE_MINUTES",
  "SESSION_SECRET", "SESSION_SEQUENCE_ENFORCE", "SESSION_SEQUENCE_GRACE", "SIGNING_PRIVATE_KEY",
  "SMTP_URL", "STEP_UP_MINUTES", "STT_PROVIDER", "TRUST_PROXY",
  "VAULT_ADDR", "VAULT_AWS_SECRET_ID", "VAULT_AZURE_SECRET_NAME", "VAULT_AZURE_VAULT_URL",
  "VAULT_BACKEND", "VAULT_FILE", "VAULT_HTTP_TOKEN", "VAULT_HTTP_URL", "VAULT_KEY", "VAULT_KEY_ENC",
  "VAULT_KMS_KEY_URL", "VAULT_KV_MOUNT", "VAULT_KV_PATH", "VAULT_TOKEN", "WEBHOOKS", "WHISPER_MODEL",
  "WHISPER_URL",
] as const;

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const prevRow = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, prevRow, dp[j - 1]!);
      prevDiag = prevRow;
    }
  }
  return dp[b.length]!;
}

/**
 * Env vars actually SET whose name looks like a near-miss on a known OmniProject var (e.g.
 * `OIDC_ISUER_URL`) but doesn't exactly match one — a likely typo that would otherwise silently
 * fall back to a default with zero signal, since env vars are opaque strings with no compiler to
 * catch a misspelled key. Scoped to names sharing a known var's leading word (`OIDC`, `SAML`, ...)
 * so unrelated host/platform env vars (PATH, DATABASE_URL, KUBERNETES_SERVICE_HOST) are never
 * touched — only candidates that already look like an attempt at one of ours are compared.
 */
export function detectEnvVarTypos(env: NodeJS.ProcessEnv = process.env): string[] {
  const families = new Map<string, string[]>();
  for (const name of KNOWN_ENV_VARS) {
    const lead = name.split("_", 1)[0]!;
    families.set(lead, [...(families.get(lead) ?? []), name]);
  }
  const known = new Set<string>(KNOWN_ENV_VARS);
  const issues: string[] = [];
  for (const name of Object.keys(env)) {
    if (known.has(name)) continue;
    const candidates = families.get(name.split("_", 1)[0]!);
    if (!candidates) continue;
    let best = { name: "", dist: Infinity };
    for (const c of candidates) {
      const dist = levenshtein(name, c);
      if (dist < best.dist) best = { name: c, dist };
    }
    if (best.dist > 0 && best.dist <= 2) issues.push(`${name} is set but is not a recognized variable — did you mean ${best.name}?`);
  }
  return issues;
}

/**
 * Validate the security-critical env at boot. Returns a list of issues (empty = OK). In
 * production, callers should treat a non-empty list as fatal. SESSION_SECRET strength is
 * ALREADY enforced (hard fail-fast) in app.ts, so it's intentionally not repeated here — this
 * covers the checks that weren't centralised, so they can't silently regress.
 *
 * Runs whenever NODE_ENV is literally "production" OR `productionSignals` sees a real-looking
 * deployment (real SSO, a licence, a public hostname) — the same detector used by
 * `session-secret-guard.ts` and `requireTls()` for the equivalent gap: a deployment that looks
 * production but has NODE_ENV unset/misspelled/"staging" must not silently skip these checks.
 */
export function checkRequiredEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const issues: string[] = [];
  const isProd = env["NODE_ENV"] === "production" || productionSignals(env).length > 0;
  if (!isProd) return issues; // dev/test (no production signals either) may use defaults

  // If SCIM lifecycle is on, its bearer token must be strong (it can deprovision every user).
  const scimToken = env["SCIM_TOKEN"]?.trim();
  if (scimToken !== undefined && scimToken.length < 24) issues.push("SCIM_TOKEN must be at least 24 characters when SCIM is enabled");

  // The broker pre-shared key authenticates the gateway↔backend channel (HMAC + envelope seal)
  // AND seeds at-rest key derivation via the master fallback chain — a weak/short one undermines
  // both. When set, require the same strength as the SCIM bearer.
  const brokerPsk = env["BROKER_PSK"]?.trim();
  if (brokerPsk !== undefined && brokerPsk.length < 24) issues.push("BROKER_PSK must be at least 24 characters");

  // BROKER_PSK and SESSION_SECRET seed independent key domains, but the broker-PSK envelope derives
  // its key as SHA-256(secret) (un-labelled) just like the legacy session codec — so reusing ONE
  // secret for both makes a broker-PSK ciphertext and a session cookie cross-decryptable. Refuse it.
  const sessionSecret = env["SESSION_SECRET"]?.trim();
  if (brokerPsk && sessionSecret && brokerPsk === sessionSecret) {
    issues.push("BROKER_PSK must not equal SESSION_SECRET (they key separate crypto domains; sharing one secret makes broker ciphertext and session cookies cross-decryptable)");
  }

  // API bearer tokens can pull the WHOLE portfolio (OData / export / /portfolio/summary), so a weak
  // one is a data-exfiltration vector. Each comma-separated token must meet the same strength bar.
  const apiTokens = env["API_TOKENS"]?.trim();
  if (apiTokens) {
    const weak = apiTokens.split(",").map((t) => t.trim()).filter((t) => t.length > 0 && t.length < 24);
    if (weak.length) issues.push("every API_TOKENS entry must be at least 24 characters");
  }

  // The notification ingest secret lets a caller fan messages into every user's stream + webhooks;
  // require the same strength as the other shared secrets.
  const notifyIngest = env["NOTIFY_INGEST_SECRET"]?.trim();
  if (notifyIngest !== undefined && notifyIngest.length < 24) issues.push("NOTIFY_INGEST_SECRET must be at least 24 characters");

  // Disabling rate limiting in production removes a key DoS/brute-force control.
  if (envBool("RATE_LIMIT_DISABLED", env)) issues.push("RATE_LIMIT_DISABLED must not be set in production");

  // OIDC_SKIP_TOKEN_VERIFY is a debug-only escape hatch that disables JWT signature
  // verification entirely — anyone can forge an arbitrary token/claims and walk in as any
  // user or role. Left on in production it's a full authentication bypass, not a mere
  // relaxation, so it gets the same hard interlock as every other critical finding here.
  if (envBool("OIDC_SKIP_TOKEN_VERIFY", env)) {
    issues.push("OIDC_SKIP_TOKEN_VERIFY must not be set in production — it disables OIDC token signature verification (authentication bypass)");
  }

  // A HALF-configured SAML rollout silently stays disabled — surface it as a boot issue so the
  // operator finishes the SSO setup instead of shipping with an unexpectedly-off login path.
  const saml = samlConfigStatusFrom(env);
  if (saml.partial) issues.push(`SAML SSO is partially configured and will stay disabled; missing ${saml.missing.join(", ")}`);

  return issues;
}
