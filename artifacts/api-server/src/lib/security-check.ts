/**
 * Startup security self-check — surface dangerous *production* configurations
 * loudly at boot so a customer can't silently deploy the headline. Pure + tested
 * (`securityFindings`), with a boot hook (`runSecuritySelfCheck`) that logs every
 * finding and, by DEFAULT, refuses to boot on a CRITICAL one (e.g. demo auth —
 * every session is admin — reaching production with no override). A log-only
 * check that a customer can simply ignore is not a control; refusing to boot is
 * what makes it one. `SECURITY_STRICT=off` is the one explicit escape hatch, for
 * a deliberate staged rollout — anything else (unset, "on", "1"...) enforces.
 *
 * It complements the hard fail-fast already in app.ts (default SESSION_SECRET in
 * prod) — this catches the *combinations* that are insecure but not individually
 * fatal.
 */
import { demoAuthSeverity } from "./deployment-profile";
import { configuredBrokerUrls } from "./broker-url";
import { checkRequiredEnv, detectEnvVarTypos, isTruthy } from "./env-config";
import { isProductionLike } from "./dev-mode-guard";
import { isDemoAuthFrom } from "./auth-config";
import { isBlockedHostLiteral } from "./ip-ranges";

export type Severity = "critical" | "warn" | "info";

export interface SecurityFinding {
  id: string;
  severity: Severity;
  message: string;
}

type Env = Record<string, string | undefined>;
const set = (v: string | undefined) => !!v?.trim();

/** The literal hostname of a URL-ish connection string (a URL, or `host:port`, with an optional
 *  scheme and `user:pass@`), lower-cased with IPv6 brackets stripped — or null if there's nothing
 *  usable. Used to spot a non-HTTP egress target (SMTP/Redis) pointed at a known-bad literal. */
function outboundHostLiteral(url: string | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  try { return new URL(v).hostname.replace(/^\[|\]$/g, "").toLowerCase() || null; } catch { /* not a full URL */ }
  const hostPort = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0]!.split("@").pop() ?? "";
  return hostPort.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase() || null;
}
const explicitlyOff = (v: string | undefined) => {
  const t = v?.trim().toLowerCase();
  return t === "off" || t === "false" || t === "0" || t === "no";
};

/**
 * Is the CRITICAL-finding boot refusal active? True unless an operator has explicitly opted
 * out (`SECURITY_STRICT=off`) — refusal is the default, not something that must be turned on.
 * Exported so the setup UI's hardening checklist reports the SAME thing the boot hook enforces.
 */
export function bootRefusalActive(env: Env): boolean {
  return !explicitlyOff(env["SECURITY_STRICT"]);
}

/**
 * Evaluate the deployment config and return any security findings (pure).
 *
 * `NODE_ENV === "production"` alone is NOT a sufficient trigger: this self-check exists
 * specifically to catch a customer silently deploying a dangerous combination, and a
 * deployment with real OIDC/SAML configured (or a licence, or a public hostname) but
 * NODE_ENV unset/misspelled/"staging" is exactly that customer — skipping every check
 * here would defeat the self-check's whole purpose. So this also runs whenever
 * `productionSignals` sees a real-looking deployment, regardless of the NODE_ENV string
 * (the same detector `session-secret-guard.ts` and `requireTls()` use for the same class
 * of gap).
 */
export function securityFindings(env: Env): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  // A misspelled env var (e.g. OIDC_ISUER_URL) silently falls back to a default with zero signal —
  // env vars are opaque strings with no compiler to catch a typo'd key. Checked in every
  // environment (not gated on `prod`, below), since a typo is just as silent in dev/staging.
  for (const issue of detectEnvVarTypos(env)) out.push({ id: "env-var-typo", severity: "warn", message: issue });

  const prod = isProductionLike(env);
  if (!prod) return out; // dev/test deployments (no production signals either) are expected to be relaxed

  // The big one: production with NO real auth method means demo auth — every session is admin. This
  // uses the SAME detector as the runtime gate (lib/auth-config `isDemoAuthFrom`), so a correctly-
  // configured SAML / OAuth2 / named-OIDC / magic-link deployment (which legitimately leaves the
  // legacy OIDC_ISSUER_URL unset) is NOT falsely flagged and refused boot. Its severity follows the
  // DEPLOYMENT_PROFILE: a blocker for enterprise/business, an accepted choice (warn/info) for a
  // self-hoster/charity, or info once explicitly acknowledged (ACCEPT_DEMO_AUTH=1).
  if (isDemoAuthFrom(env)) {
    const severity = demoAuthSeverity(env);
    out.push({
      id: "demo-auth-in-prod",
      severity,
      message:
        "No real authentication method is configured (OIDC / SAML / OAuth2 / magic-link): authentication " +
        "is in DEMO mode, where every session is treated as admin. " + (severity === "critical"
          ? "Configure an SSO method (or set DEPLOYMENT_PROFILE / ACCEPT_DEMO_AUTH=1 to accept this for a small/LAN deployment)."
          : "Accepted for this deployment profile — use the bundled IdP if you need real per-user accounts."),
    });
  }
  // Broker traffic not encrypted: a plain http:// endpoint to a non-loopback host means
  // gateway↔broker data crosses the wire in clear. Checked for EVERY loaded broker (the default
  // endpoint, any pool, and per-kind BROKER_ENDPOINTS) — not just the primary — so a secondary
  // broker on plaintext is caught too.
  for (const brokerUrl of configuredBrokerUrls(env)) {
    if (!/^http:\/\//i.test(brokerUrl)) continue;
    let host = "";
    try { host = new URL(brokerUrl).hostname.toLowerCase(); } catch { continue; }
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (host && !loopback) {
      const pskOn = set(env["BROKER_PSK"]);
      out.push({
        id: "broker-plaintext",
        severity: "warn",
        message:
          `Broker endpoint ${brokerUrl} uses plain http:// to a remote host — gateway↔broker data crosses the wire ` +
          "unencrypted. Use https:// for the broker endpoint (with NODE_EXTRA_CA_CERTS for a private CA), or front the " +
          "broker with a TLS sidecar / service-mesh mTLS." +
          (pskOn
            ? " BROKER_PSK is set, so the payload is sealed — but PSK is a below-TLS fallback: it gives NO forward " +
              "secrecy (one static key; a leak decrypts past captures) and NO peer authentication (anyone with the key " +
              "is 'the broker'). Only TLS + mTLS (BROKER_MTLS_CERT/KEY) provide those."
            : ""),
      });
    }
  }
  // Opt-in read cache relaxes the stateless "never stale" guarantee.
  if (set(env["READ_CACHE_TTL_MS"]) && Number(env["READ_CACHE_TTL_MS"]) > 0) {
    out.push({
      id: "read-cache-on",
      severity: "warn",
      message:
        `READ_CACHE_TTL_MS is set in production (${env["READ_CACHE_TTL_MS"]}ms): reads may be served stale up to this TTL — ` +
        "the zero-drift guarantee is relaxed and backend data is briefly held in RAM. Intentional for high-latency/dispersed " +
        "deployments; unset it to return to fully live reads.",
    });
  }
  // Abuse protection disabled.
  if (isTruthy(env["RATE_LIMIT_DISABLED"])) {
    out.push({
      id: "rate-limit-off",
      severity: "warn",
      message: "RATE_LIMIT_DISABLED is on in production — abuse/DoS protection is removed.",
    });
  }
  // SCIM token present but too weak to be trusted. SCIM drives deprovisioning + group→role membership,
  // so a short/brute-forceable token is a privilege-escalation vector — the gate DISABLES SCIM when the
  // token is under the floor (fail-closed, see lib/scim), which would silently stop provisioning; surface
  // it loudly so the operator sets a strong token rather than wondering why SCIM went dark.
  {
    const scimTok = env["SCIM_TOKEN"]?.trim();
    if (scimTok && scimTok.length < 24) {
      out.push({
        id: "scim-token-weak",
        severity: "warn",
        message: `SCIM_TOKEN is set but shorter than the 24-char minimum — SCIM provisioning is DISABLED until it is strengthened ` +
          "(a weak SCIM token would let an attacker deprovision users or grant admin via group membership). Use a strong random token.",
      });
    }
  }
  // mTLS deliberately downgraded to accept an unverified broker certificate — the same class
  // of "explicit insecure escape hatch left on in prod" as the checks above, so it gets the
  // same CRITICAL treatment (refuses to boot by default) rather than a log-only warning.
  if (isTruthy(env["BROKER_MTLS_INSECURE"])) {
    out.push({
      id: "broker-mtls-insecure",
      severity: "critical",
      message: "BROKER_MTLS_INSECURE is on in production — the broker's TLS certificate is not verified " +
        "(rejectUnauthorized: false). This is a testing-only escape hatch for a self-signed broker cert; " +
        "remove it (or install the broker's real/private CA cert via BROKER_MTLS_CA) before going live.",
    });
  }
  // CSRF guard disabled — SameSite=Lax cookies already block most cross-site vectors, so this
  // is a relaxation rather than the full authentication bypass OIDC_SKIP_TOKEN_VERIFY is, but a
  // deployment that quietly disabled it (e.g. to work around a legacy reverse proxy) should
  // still see that surfaced at every boot, not just once when it was set.
  if (isTruthy(env["CSRF_DISABLED"])) {
    out.push({
      id: "csrf-disabled",
      severity: "warn",
      message: "CSRF_DISABLED is on in production — the Origin/Referer + double-submit-token guard for " +
        "cookie-authenticated mutations is off (SameSite=Lax cookies still block most cross-site vectors).",
    });
  }
  // Non-HTTP egress (SMTP, Redis) reaches a FIXED operator host, so it sits outside the HTTP egress
  // guard (safeFetch/guardedLookup). It isn't request-influenced, but a config that literally points
  // mail or the shared-state cache at the link-local/cloud-metadata range is never legitimate — a
  // misconfiguration or an exfil/pivot attempt. Flagged as CRITICAL (refuse boot) on the LITERAL host
  // only: a hostname is the operator's own infra and blocking boot on a transient DNS resolve would
  // be worse than the risk.
  for (const name of ["SMTP_URL", "REDIS_URL"] as const) {
    const host = outboundHostLiteral(env[name]);
    if (host && isBlockedHostLiteral(host)) {
      out.push({
        id: "egress-host-metadata",
        severity: "critical",
        message: `${name} points at ${host}, in the link-local/cloud-metadata range — never a legitimate ` +
          `${name === "SMTP_URL" ? "mail server" : "cache"}. Point it at your real host.`,
      });
    }
  }
  // Premium/labels free-to-run is a business choice, not security — skip.
  // Egress not pinned (link-local/metadata are still blocked regardless).
  if (!set(env["EGRESS_ALLOWLIST"])) {
    out.push({
      id: "egress-not-pinned",
      severity: "info",
      message: "EGRESS_ALLOWLIST is not set: outbound egress is open (metadata/link-local still blocked). " +
        "Set it to pin egress to your broker/IdP hosts for defence in depth.",
    });
  }
  // Time-travel egress without an obvious owner of the store — informational.
  if (set(env["LOGGING_SYNC_URL"]) && !set(env["EGRESS_ALLOWLIST"])) {
    out.push({
      id: "logging-egress",
      severity: "info",
      message: "Logging-server egress (LOGGING_SYNC_URL) is enabled — project state leaves the stateless core. " +
        "Ensure the destination store is one you own and govern.",
    });
  }
  // Validated security-critical env (weak/missing secrets, disabled rate-limit): each issue is
  // a CRITICAL finding so it surfaces at boot (and refuses to boot under SECURITY_STRICT).
  for (const issue of checkRequiredEnv(env)) {
    out.push({ id: "env-config", severity: "critical", message: issue });
  }
  return out;
}

export interface Logger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

/**
 * Boot hook: log findings at their severity. By default, a CRITICAL finding throws
 * (fail-closed) so the gateway refuses to boot insecurely — e.g. a production-like
 * deployment with no OIDC (demo auth: every session is admin) and no explicit
 * DEPLOYMENT_PROFILE/ACCEPT_DEMO_AUTH override. Set `SECURITY_STRICT=off` to
 * downgrade this to a log-only warning (a deliberate, explicit choice — never the
 * default). Returns the findings (for tests / diagnostics).
 */
export function runSecuritySelfCheck(env: Env, logger: Logger): SecurityFinding[] {
  const findings = securityFindings(env);
  for (const f of findings) {
    const line = `[security] ${f.id}: ${f.message}`;
    if (f.severity === "critical") logger.error({ finding: f }, line);
    else if (f.severity === "warn") logger.warn({ finding: f }, line);
    else logger.info({ finding: f }, line);
  }
  if (bootRefusalActive(env)) {
    const critical = findings.filter((f) => f.severity === "critical");
    if (critical.length) {
      throw new Error(
        `${critical.length} critical security finding(s) were detected: ` +
          critical.map((f) => f.id).join(", ") +
          ". Refusing to boot. Fix them, or set SECURITY_STRICT=off to boot anyway (soft-check only — not recommended in production).",
      );
    }
  }
  return findings;
}
