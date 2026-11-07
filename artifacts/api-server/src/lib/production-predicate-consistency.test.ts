import { test } from "node:test";
import assert from "node:assert/strict";
import { requireTls } from "./deployment-profile";
import { securityFindings } from "./security-check";
import { evaluateSessionSecret } from "./session-secret-guard";
import { checkRequiredEnv } from "./env-config";
import { runDevModeGuard } from "./dev-mode-guard";
import { isEntitled } from "./license";

/**
 * Cross-module consistency of the production decision. Every security-relevant gate —
 * dev mode, TLS/cookie posture, the deployment self-check, the session-secret guard,
 * required-env validation, and the LICENSE_DEV_FEATURES unlock — keys off the SAME
 * fail-safe predicate (lib/node-env isProductionEnv, plus productionSignals where the
 * gate is signal-aware). These tests pin the behaviours that predicate implies for the
 * labels that used to slip through a bare `NODE_ENV === "production"` compare:
 * mis-cased "Production" and unknown labels like "staging" now read as PRODUCTION
 * everywhere, and only an explicit development/test (or the unset local default) is lax.
 */

test("requireTls: an unknown or mis-cased NODE_ENV label reads as production (Secure cookies on)", () => {
  assert.equal(requireTls({ NODE_ENV: "staging" }), true, "staging must be treated as production-like");
  assert.equal(requireTls({ NODE_ENV: "Production" }), true, "mis-cased Production must be treated as production");
  assert.equal(requireTls({ NODE_ENV: "development" }), false);
  assert.equal(requireTls({ NODE_ENV: "test" }), false);
});

test("securityFindings: a staging-labelled deployment is checked, not skipped (the doc-comment's own customer)", () => {
  const staging = securityFindings({ NODE_ENV: "staging" });
  assert.ok(staging.some((f) => f.id === "demo-auth-in-prod"), "demo-auth must be flagged on a staging-labelled box");
  const dev = securityFindings({ NODE_ENV: "development" });
  assert.equal(dev.filter((f) => f.id === "demo-auth-in-prod").length, 0, "an explicit dev env stays relaxed");
});

test("session-secret guard: mis-cased/unknown NODE_ENV labels refuse the default secret", () => {
  assert.equal(evaluateSessionSecret({ NODE_ENV: "Production" }).ok, false, "mis-cased Production must refuse a missing secret");
  assert.equal(evaluateSessionSecret({ NODE_ENV: "staging" }).ok, false, "staging must refuse a missing secret");
  assert.equal(evaluateSessionSecret({ NODE_ENV: "development" }).ok, true, "an explicit dev env may use the dev default");
});

test("checkRequiredEnv: staging-labelled deployments get the production checks", () => {
  assert.ok(
    checkRequiredEnv({ NODE_ENV: "staging", SCIM_TOKEN: "short" } as NodeJS.ProcessEnv).some((i) => i.includes("SCIM_TOKEN")),
    "a weak SCIM_TOKEN must be flagged under a staging label",
  );
  assert.equal(
    checkRequiredEnv({ NODE_ENV: "development", SCIM_TOKEN: "short" } as NodeJS.ProcessEnv).length,
    0,
    "an explicit dev env skips the production-only checks",
  );
});

test("LICENSE_DEV_FEATURES unlock is inert under mis-cased/unknown production labels (same gate as dev mode)", () => {
  const KEYS = ["NODE_ENV", "PREMIUM_ENFORCEMENT", "LICENSE_DEV_FEATURES", "LICENSE_KEY", "LICENSE_TOKEN", "OMNI_DEV_MODE"];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, { PREMIUM_ENFORCEMENT: "on", LICENSE_DEV_FEATURES: "all" });
    process.env["NODE_ENV"] = "development";
    assert.equal(isEntitled("labels"), true, "the dev unlock works in an explicit dev env");
    for (const label of ["Production", "staging", "production"]) {
      process.env["NODE_ENV"] = label;
      assert.equal(isEntitled("labels"), false, `LICENSE_DEV_FEATURES must be ignored under NODE_ENV=${JSON.stringify(label)}`);
    }
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  }
});

test("boot guard warns loudly when dev mode arms with NODE_ENV unset (the one dev-arming case the label can't distinguish)", () => {
  const warns: string[] = [];
  const logger = { error() {}, info() {}, warn(_obj: unknown, msg?: string) { warns.push(msg ?? ""); } };
  runDevModeGuard({ OMNI_DEV_MODE: "1" }, logger);
  assert.ok(warns.some((m) => /NODE_ENV is unset/.test(m)), "must warn about the unset NODE_ENV");
  warns.length = 0;
  runDevModeGuard({ OMNI_DEV_MODE: "1", NODE_ENV: "development" }, logger);
  assert.equal(warns.filter((m) => /NODE_ENV is unset/.test(m)).length, 0, "no warning when the dev env is declared explicitly");
});
