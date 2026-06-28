import { test } from "node:test";
import assert from "node:assert/strict";
import { securityFindings, runSecuritySelfCheck, type SecurityFinding } from "./security-check";

test("non-production deployments produce no findings (relaxed by design)", () => {
  assert.deepEqual(securityFindings({ NODE_ENV: "development" }), []);
  assert.deepEqual(securityFindings({}), []);
});

test("production without OIDC is a CRITICAL finding (demo auth = everyone admin)", () => {
  const f = securityFindings({ NODE_ENV: "production" });
  const crit = f.find((x) => x.id === "demo-auth-in-prod");
  assert.ok(crit && crit.severity === "critical");
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

test("flags a plain-http broker URL to a remote host (encrypt the broker hop)", () => {
  const remote = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://n8n.internal:5678/webhook" });
  assert.ok(remote.some((x) => x.id === "broker-plaintext" && x.severity === "warn"));
  // https or loopback is fine.
  const tls = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "https://n8n.internal:5678/webhook" });
  assert.ok(!tls.some((x) => x.id === "broker-plaintext"));
  const local = securityFindings({ NODE_ENV: "production", OIDC_ISSUER_URL: "https://idp/realm", BROKER_URL: "http://localhost:5678/webhook" });
  assert.ok(!local.some((x) => x.id === "broker-plaintext"));
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

test("runSecuritySelfCheck logs findings at their severity", () => {
  const log = fakeLogger();
  runSecuritySelfCheck({ NODE_ENV: "production" }, log);
  assert.ok(log.calls.some((c) => c.level === "error")); // the critical demo-auth finding
});

test("SECURITY_STRICT refuses to boot on a critical finding", () => {
  const log = fakeLogger();
  assert.throws(
    () => runSecuritySelfCheck({ NODE_ENV: "production", SECURITY_STRICT: "on" }, log),
    /critical security finding/i,
  );
  // …but a clean prod config in strict mode boots fine.
  const clean: SecurityFinding[] = runSecuritySelfCheck(
    { NODE_ENV: "production", SECURITY_STRICT: "on", OIDC_ISSUER_URL: "https://idp/realm", EGRESS_ALLOWLIST: "idp" },
    log,
  );
  assert.equal(clean.filter((x) => x.severity === "critical").length, 0);
});
