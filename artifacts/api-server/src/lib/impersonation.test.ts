import { test } from "node:test";
import assert from "node:assert/strict";
import { activeImpersonation, effectiveSession, IMPERSONATION_TTL_MS } from "./impersonation";
import type { Session } from "./oidc";

/**
 * Ephemeral, dev-only impersonation. The guardrails (dev-gated, time-boxed,
 * accountable) are enforced here in the pure read side.
 */

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const NOW = 1_000_000;
const base: Session = { sub: "admin-1", email: "admin@x.com", roles: ["omni-admin"], accessToken: "t" };
const withImp = (over: Partial<Session["impersonation"]> = {}): Session => ({
  ...base,
  impersonation: { sub: "user-9", email: "user9@x.com", roles: ["viewer"], reason: "repro bug 42", by: "admin-1", expiresAt: NOW + IMPERSONATION_TTL_MS, ...over },
});

test("impersonation is honoured only in dev mode", () => {
  const s = withImp();
  withEnv({ NODE_ENV: "production", OMNI_DEV_MODE: "1" }, () => {
    assert.equal(activeImpersonation(s, NOW), null, "never in production");
  });
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    assert.ok(activeImpersonation(s, NOW));
  });
});

test("impersonation is ephemeral — expired ones are inert", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    const expired = withImp({ expiresAt: NOW - 1 });
    assert.equal(activeImpersonation(expired, NOW), null);
  });
});

test("effectiveSession overlays the impersonated identity + role (dev)", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    const eff = effectiveSession(withImp(), NOW)!;
    assert.equal(eff.sub, "user-9");
    assert.equal(eff.email, "user9@x.com");
    assert.deepEqual(eff.roles, ["viewer"]);
    assert.equal(eff.impersonation?.by, "admin-1"); // retained for audit
    assert.equal(eff.impersonation?.reason, "repro bug 42");
  });
});

test("effectiveSession strips an inert/expired impersonation so it can't leak", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    const expired = withImp({ expiresAt: NOW - 1 });
    const eff = effectiveSession(expired, NOW)!;
    assert.equal(eff.sub, "admin-1"); // back to the real identity
    assert.equal(eff.impersonation, undefined);
  });
  // Outside dev mode the block is also stripped from the effective view.
  withEnv({ NODE_ENV: "production" }, () => {
    const eff = effectiveSession(withImp(), NOW)!;
    assert.equal(eff.sub, "admin-1");
    assert.equal(eff.impersonation, undefined);
  });
});

test("a session with no impersonation passes through unchanged", () => {
  assert.equal(effectiveSession(base, NOW), base);
  assert.equal(effectiveSession(null, NOW), null);
});
