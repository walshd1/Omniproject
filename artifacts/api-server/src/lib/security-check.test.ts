import { test } from "node:test";
import assert from "node:assert/strict";
import { securityFindings, runSecuritySelfCheck, type SecurityFinding } from "./security-check";

test("non-production deployments produce no findings (relaxed by design)", () => {
  assert.deepEqual(securityFindings({ NODE_ENV: "development" }), []);
  assert.deepEqual(securityFindings({}), []);
});

test("a likely env-var typo is flagged even in dev — a typo is just as silent there", () => {
  const f = securityFindings({ NODE_ENV: "development", OIDC_ISUER_URL: "https://idp.example.com" });
  const finding = f.find((x) => x.id === "env-var-typo");
  assert.ok(finding && finding.severity === "warn");
  assert.match(finding!.message, /OIDC_ISSUER_URL/);
});

test("production without OIDC is a CRITICAL finding (demo auth = everyone admin)", () => {
  const f = securityFindings({ NODE_ENV: "production" });
  const crit = f.find((x) => x.id === "demo-auth-in-prod");
  assert.ok(crit && crit.severity === "critical");
});

test("also runs when NODE_ENV isn't literally 'production' — by a real production signal OR any non-production label", () => {
  // The demo-auth-in-prod gap must not be silently skipped just because NODE_ENV isn't the literal
  // string "production". Two independent ways it still fires:
  //   1. a real production SIGNAL (public hostname, SSO, licence) regardless of the NODE_ENV string, and
  //   2. any non-production NODE_ENV label — "staging", a typo, a mis-cased "Production" — because the
  //      single production predicate (lib/node-env.isProductionEnv, via dev-mode-guard.isProductionLike)
  //      fails closed: ONLY an explicit development/test (or unset) reads as non-production.
  const bySignal = securityFindings({ PUBLIC_URL: "https://omni.example.com" });
  assert.ok(bySignal.find((x) => x.id === "demo-auth-in-prod")?.severity === "critical");
  const byLabel = securityFindings({ NODE_ENV: "staging" });
  assert.ok(byLabel.find((x) => x.id === "demo-auth-in-prod")?.severity === "critical");
  // Only an explicit development/test (or unset) stays fully relaxed.
  assert.deepEqual(securityFindings({ NODE_ENV: "development" }), []);
});

test("a self-hosted/charity profile makes no-IdP an accepted choice (warn, not critical)", () => {
  const f = securityFindings({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "self-hosted" });
  const finding = f.find((x) => x.id === "demo-auth-in-prod");
  assert.ok(finding && finding.severity === "warn");
  assert.equal(f.filter((x) => x.severity === "critical").length, 0); // won't trip SECURITY_STRICT
});

test("explicitly accepting demo auth downgrades it to info even on a strict profile", () => {
  const f = securityFindings({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise", ACCEPT_DEMO_AUTH: "1" });
  const finding = f.find((x) => x.id === "demo-auth-in-prod");
  assert.ok(finding && finding.severity === "info");
});

test("production with OIDC + rate limiting clears the criticals", () => {
  const f = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm" });
  assert.equal(f.filter((x) => x.severity === "critical").length, 0);
});

test("a SAML-only / OAuth2-only / named-OIDC production deploy is NOT falsely flagged as demo auth", () => {
  // The demo-auth blocker must use the same detector as the runtime gate, so a real auth method that
  // legitimately leaves the legacy OIDC_ISSUER_URL unset does not refuse boot on an enterprise profile.
  const saml = securityFindings({
    NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise",
    SAML_IDP_ENTRY_POINT: "https://idp/sso", SAML_IDP_CERT: "-----BEGIN CERTIFICATE-----x-----END CERTIFICATE-----",
    SAML_CALLBACK_URL: "https://omni.example.com/api/auth/saml/callback",
  });
  assert.equal(saml.some((x) => x.id === "demo-auth-in-prod"), false);

  const oauth2 = securityFindings({
    NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise",
    OAUTH2_AUTH_URL: "https://gh/login", OAUTH2_TOKEN_URL: "https://gh/token", OAUTH2_USERINFO_URL: "https://gh/user",
    OAUTH2_CLIENT_ID: "id", OAUTH2_CLIENT_SECRET: "secret",
  });
  assert.equal(oauth2.some((x) => x.id === "demo-auth-in-prod"), false);

  const namedOidc = securityFindings({
    NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise",
    OIDC_PROVIDERS: "microsoft", OIDC_MICROSOFT_ISSUER_URL: "https://login.microsoftonline.com/t/v2.0",
    OIDC_MICROSOFT_CLIENT_ID: "id", OIDC_MICROSOFT_CLIENT_SECRET: "secret",
  });
  assert.equal(namedOidc.some((x) => x.id === "demo-auth-in-prod"), false);
});

test("a SAML-only production deploy BOOTS (does not trip the default critical boot refusal)", () => {
  const log = fakeLogger();
  const findings = runSecuritySelfCheck({
    NODE_ENV: "production", DEPLOYMENT_PROFILE: "enterprise", EGRESS_ALLOWLIST: "idp",
    SAML_IDP_ENTRY_POINT: "https://idp/sso", SAML_IDP_CERT: "-----BEGIN CERTIFICATE-----x-----END CERTIFICATE-----",
    SAML_CALLBACK_URL: "https://omni.example.com/api/auth/saml/callback",
  }, log);
  assert.equal(findings.filter((x) => x.severity === "critical").length, 0);
});

test("flags a plain-http broker URL to a remote host (encrypt the broker hop)", () => {
  const remote = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://n8n.internal:5678/webhook" });
  assert.ok(remote.some((x) => x.id === "broker-plaintext" && x.severity === "warn"));
  // https or loopback is fine.
  const tls = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "https://n8n.internal:5678/webhook" });
  assert.ok(!tls.some((x) => x.id === "broker-plaintext"));
  const local = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://localhost:5678/webhook" });
  assert.ok(!local.some((x) => x.id === "broker-plaintext"));
});

test("the plaintext-broker warning notes PSK is not a TLS substitute (no forward secrecy / peer auth)", () => {
  // With PSK set on a plaintext remote hop, the warning must spell out that PSK ≠ TLS: no forward
  // secrecy, no peer authentication — mTLS/TLS is the answer.
  const withPsk = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://n8n.internal:5678/webhook", BROKER_PSK: "a-strong-broker-psk-value-1234" });
  const finding = withPsk.find((x) => x.id === "broker-plaintext");
  assert.ok(finding);
  assert.match(finding!.message, /forward secrecy/i);
  assert.match(finding!.message, /peer auth/i);
  // Without PSK the base warning stands but doesn't carry the PSK caveat.
  const noPsk = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://n8n.internal:5678/webhook" });
  assert.doesNotMatch(noPsk.find((x) => x.id === "broker-plaintext")!.message, /forward secrecy/i);
});

test("checks EVERY loaded broker, not just the primary (per-kind BROKER_ENDPOINTS)", () => {
  // Primary is TLS, but a per-kind secondary broker is plain http to a remote host → still flagged.
  const findings = securityFindings({
    NODE_ENV: "production",
    OIDC_ISSUER_URL: "https://idp/realm",
    BROKER_URL: "https://primary.internal/webhook",
    BROKER_ENDPOINTS: "node-red=http://node-red.internal:1880/omni,extra=https://ok.internal/x",
  });
  const plaintext = findings.filter((x) => x.id === "broker-plaintext");
  assert.equal(plaintext.length, 1); // only the node-red endpoint, not the TLS ones
  assert.match(plaintext[0]!.message, /node-red\.internal/);
});

test("flags BROKER_MTLS_INSECURE left on in production as CRITICAL (unverified broker cert)", () => {
  const f = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_MTLS_INSECURE: "true" });
  const finding = f.find((x) => x.id === "broker-mtls-insecure");
  assert.ok(finding && finding.severity === "critical");
  assert.equal(securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm" }).some((x) => x.id === "broker-mtls-insecure"), false);
});

test("flags CSRF_DISABLED left on in production (warn, not critical — SameSite=Lax still mitigates)", () => {
  const f = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", CSRF_DISABLED: "true" });
  const finding = f.find((x) => x.id === "csrf-disabled");
  assert.ok(finding && finding.severity === "warn");
  assert.equal(securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm" }).some((x) => x.id === "csrf-disabled"), false);
});

test("flags disabled rate limiting and surfaces egress/logging notes", () => {
  const f = securityFindings({
    NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm",
    RATE_LIMIT_DISABLED: "true", LOGGING_SYNC_URL: "https://logs.example.com",
  });
  assert.ok(f.some((x) => x.id === "rate-limit-off" && x.severity === "warn"));
  assert.ok(f.some((x) => x.id === "egress-not-pinned" && x.severity === "info"));
  assert.ok(f.some((x) => x.id === "logging-egress"));
});

function fakeLogger() {
  const calls: Array<{ level: string; msg: unknown }> = [];
  const rec = (level: string) => (obj: unknown, msg?: string) => calls.push({ level, msg: msg ?? obj });
  return { calls, error: rec("error"), warn: rec("warn"), info: rec("info") };
}

test("runSecuritySelfCheck logs findings at their severity, and REFUSES TO BOOT by default on a critical one", () => {
  const log = fakeLogger();
  assert.throws(() => runSecuritySelfCheck({ NODE_ENV: "production" }, log), /critical security finding/i);
  assert.ok(log.calls.some((c) => c.level === "error")); // the critical demo-auth finding was still logged first
});

test("SECURITY_STRICT=off downgrades the boot refusal to a log-only warning (explicit opt-out only)", () => {
  const log = fakeLogger();
  const findings = runSecuritySelfCheck({ NODE_ENV: "production", SECURITY_STRICT: "off" }, log);
  assert.ok(findings.some((f) => f.id === "demo-auth-in-prod" && f.severity === "critical"));
  assert.ok(log.calls.some((c) => c.level === "error"));
});

test("an explicit SECURITY_STRICT=on is redundant but harmless — still refuses to boot", () => {
  const log = fakeLogger();
  assert.throws(
    () => runSecuritySelfCheck({ NODE_ENV: "production", SECURITY_STRICT: "on" }, log),
    /critical security finding/i,
  );
  // …but a clean prod config boots fine either way.
  const clean: SecurityFinding[] = runSecuritySelfCheck(
    { NODE_ENV: "production", SECURITY_STRICT: "on", OIDC_ISSUER_URL: "https://idp/realm", EGRESS_ALLOWLIST: "idp" },
    log,
  );
  assert.equal(clean.filter((x) => x.severity === "critical").length, 0);
  const cleanDefault: SecurityFinding[] = runSecuritySelfCheck(
    { NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", EGRESS_ALLOWLIST: "idp" },
    log,
  );
  assert.equal(cleanDefault.filter((x) => x.severity === "critical").length, 0);
});

test("a self-hosted/nonprofit profile with no override never trips the default boot refusal", () => {
  const log = fakeLogger();
  const findings = runSecuritySelfCheck({ NODE_ENV: "production", DEPLOYMENT_PROFILE: "self-hosted" }, log);
  assert.equal(findings.filter((f) => f.severity === "critical").length, 0); // warn, not critical — boots fine
});

test("flags SMTP_URL / REDIS_URL pointed at the link-local/metadata range (critical), but not a normal host", () => {
  // The self-check is production-scoped (it returns early in dev), so pin NODE_ENV=production.
  const P = { NODE_ENV: "production" } as const;
  // A literal metadata/link-local target is never a real mail/cache server → critical.
  const smtp = securityFindings({ ...P, SMTP_URL: "smtp://user:pass@169.254.169.254:587" }).find((x) => x.id === "egress-host-metadata");
  assert.ok(smtp && smtp.severity === "critical", "SMTP_URL at 169.254.169.254 should be critical");
  assert.match(smtp.message, /SMTP_URL/);

  const redis = securityFindings({ ...P, REDIS_URL: "redis://169.254.169.254:6379" }).find((x) => x.id === "egress-host-metadata");
  assert.ok(redis && redis.severity === "critical", "REDIS_URL at 169.254.169.254 should be critical");

  const metaHost = securityFindings({ ...P, SMTP_URL: "smtp://metadata.google.internal" }).find((x) => x.id === "egress-host-metadata");
  assert.ok(metaHost, "the metadata hostname is also caught");

  // Ordinary hosts (name or private IP) produce NO such finding — Redis on a private IP is normal.
  for (const env of [{ ...P, SMTP_URL: "smtp://mail.example.com:587" }, { ...P, REDIS_URL: "redis://10.0.0.9:6379" }, { ...P, REDIS_URL: "redis://redis:6379" }]) {
    assert.equal(securityFindings(env).find((x) => x.id === "egress-host-metadata"), undefined, `${JSON.stringify(env)} must not flag`);
  }
});
