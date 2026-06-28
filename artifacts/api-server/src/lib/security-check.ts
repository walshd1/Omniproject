/**
 * Startup security self-check — surface dangerous *production* configurations
 * loudly at boot so a customer can't silently deploy the headline. Pure + tested
 * (`securityFindings`), with a boot hook (`runSecuritySelfCheck`) that logs the
 * findings and, in strict mode (`SECURITY_STRICT=on`), refuses to boot on a
 * CRITICAL finding.
 *
 * It complements the hard fail-fast already in app.ts (default SESSION_SECRET in
 * prod) — this catches the *combinations* that are insecure but not individually
 * fatal.
 */
import { demoAuthSeverity } from "./deployment-profile";
import { checkRequiredEnv } from "./env-config";

export type Severity = "critical" | "warn" | "info";

export interface SecurityFinding {
  id: string;
  severity: Severity;
  message: string;
}

type Env = Record<string, string | undefined>;
const on = (v: string | undefined) => v?.trim().toLowerCase() === "true" || v?.trim().toLowerCase() === "on";
const set = (v: string | undefined) => !!v?.trim();

/** Evaluate the deployment config and return any security findings (pure). */
export function securityFindings(env: Env): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const prod = env["NODE_ENV"] === "production";
  if (!prod) return out; // dev/test deployments are expected to be relaxed

  // The big one: production with no OIDC means demo auth — every session is admin. Its
  // severity follows the DEPLOYMENT_PROFILE: a blocker for enterprise/business, an accepted
  // choice (warn/info) for a self-hoster/charity, or info once explicitly acknowledged
  // (ACCEPT_DEMO_AUTH=1) — so a deliberate small-org choice isn't treated as a critical fault.
  if (!set(env["OIDC_ISSUER_URL"])) {
    const severity = demoAuthSeverity(env);
    out.push({
      id: "demo-auth-in-prod",
      severity,
      message:
        "OIDC_ISSUER_URL is not set: authentication is in DEMO mode, where every session is " +
        "treated as admin. " + (severity === "critical"
          ? "Configure OIDC SSO (or set DEPLOYMENT_PROFILE / ACCEPT_DEMO_AUTH=1 to accept this for a small/LAN deployment)."
          : "Accepted for this deployment profile — use the bundled IdP if you need real per-user accounts."),
    });
  }
  // Broker traffic not encrypted: a plain http:// broker URL to a non-loopback
  // host means gateway↔broker data crosses the wire in clear.
  const brokerUrl = (env["BROKER_URL"] || env["BROKER_URLS"]?.split(",")[0] || env["N8N_WEBHOOK_URL"] || "").trim();
  if (brokerUrl && /^http:\/\//i.test(brokerUrl)) {
    let host = "";
    try { host = new URL(brokerUrl).hostname.toLowerCase(); } catch { /* ignore */ }
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (host && !loopback) {
      out.push({
        id: "broker-plaintext",
        severity: "warn",
        message:
          "Broker traffic uses plain http:// to a remote host — gateway↔broker data crosses the wire unencrypted. " +
          "Use https:// for BROKER_URL (with NODE_EXTRA_CA_CERTS for a private CA), or front the broker with a TLS " +
          "sidecar / service-mesh mTLS.",
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
  if (on(env["RATE_LIMIT_DISABLED"])) {
    out.push({
      id: "rate-limit-off",
      severity: "warn",
      message: "RATE_LIMIT_DISABLED is on in production — abuse/DoS protection is removed.",
    });
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
 * Boot hook: log findings at their severity. In strict mode, a CRITICAL finding
 * throws (fail-closed) so the gateway refuses to boot insecurely. Returns the
 * findings (for tests / diagnostics).
 */
export function runSecuritySelfCheck(env: Env, logger: Logger): SecurityFinding[] {
  const findings = securityFindings(env);
  for (const f of findings) {
    const line = `[security] ${f.id}: ${f.message}`;
    if (f.severity === "critical") logger.error({ finding: f }, line);
    else if (f.severity === "warn") logger.warn({ finding: f }, line);
    else logger.info({ finding: f }, line);
  }
  if (on(env["SECURITY_STRICT"])) {
    const critical = findings.filter((f) => f.severity === "critical");
    if (critical.length) {
      throw new Error(
        `SECURITY_STRICT is on and ${critical.length} critical security finding(s) were detected: ` +
          critical.map((f) => f.id).join(", ") + ". Fix them or disable SECURITY_STRICT to boot.",
      );
    }
  }
  return findings;
}
