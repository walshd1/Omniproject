import { test } from "node:test";
import assert from "node:assert/strict";
import { devModeActive } from "./dev-mode-guard";
import { isDevMode } from "./dev-mode";

/**
 * The "dev mode can NEVER activate in production" contract, proven as an exhaustive
 * truth table. `devModeActive(env)` is the single source of truth (isDevMode() delegates
 * to it over process.env), so if this holds, every surface gated on isDevMode() — user
 * impersonation, entitlement override, broker trace/capture, stateful persistence, the
 * debug bundle, the dev watermark — is provably off outside an explicit development/test env.
 */

// The four independent triggers that can arm dev mode.
const TRIGGERS = ["OMNI_DEV_MODE", "DEV_PERSIST_FILE", "BROKER_TRACE", "BROKER_CAPTURE"] as const;
const TRUTHY: Record<(typeof TRIGGERS)[number], string> = {
  OMNI_DEV_MODE: "1",
  DEV_PERSIST_FILE: "/tmp/omni-dev-state.json",
  BROKER_TRACE: "1",
  BROKER_CAPTURE: "/tmp/omni-capture.ndjson",
};

/** Every one of the 16 present/absent combinations of the four triggers. */
function everyTriggerCombo(): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (let mask = 0; mask < 1 << TRIGGERS.length; mask++) {
    const env: Record<string, string> = {};
    TRIGGERS.forEach((t, i) => { if (mask & (1 << i)) env[t] = TRUTHY[t]; });
    out.push(env);
  }
  return out;
}

// Anything that is NOT an explicit development/test declaration must fail closed to production.
const PRODUCTION_ENVS = ["production", "Production", "PRODUCTION", " production ", "staging", "prod", "qa", "uat", "garbage"];
const DEV_ENVS = ["development", "test", "Development", "TEST", "", "  "]; // "" / whitespace = unset default

test("NO combination of dev flags can arm dev mode when NODE_ENV is production-like (incl. mis-cased / unknown)", () => {
  for (const NODE_ENV of PRODUCTION_ENVS) {
    for (const combo of everyTriggerCombo()) {
      const env = { NODE_ENV, ...combo };
      assert.equal(
        devModeActive(env),
        false,
        `dev mode must be OFF for NODE_ENV=${JSON.stringify(NODE_ENV)} with flags ${JSON.stringify(combo)}`,
      );
    }
  }
});

test("in an explicit dev/test env, ANY single trigger arms dev mode — and none means off", () => {
  for (const NODE_ENV of DEV_ENVS) {
    // No trigger → dev mode stays off even in a dev env (it needs an explicit opt-in).
    assert.equal(devModeActive({ NODE_ENV }), false, `no trigger → off (NODE_ENV=${JSON.stringify(NODE_ENV)})`);
    // Each trigger alone → on.
    for (const t of TRIGGERS) {
      assert.equal(devModeActive({ NODE_ENV, [t]: TRUTHY[t] }), true, `${t} alone should arm dev mode (NODE_ENV=${JSON.stringify(NODE_ENV)})`);
    }
  }
});

test("OMNI_DEV_MODE only counts when exactly '1' (a truthy-looking string is not enough)", () => {
  for (const v of ["true", "yes", "0", "on", "TRUE", " 1 ", "2"]) {
    assert.equal(devModeActive({ NODE_ENV: "development", OMNI_DEV_MODE: v }), false, `OMNI_DEV_MODE=${JSON.stringify(v)} must not arm dev mode`);
  }
  assert.equal(devModeActive({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }), true);
});

test("isDevMode() delegates to devModeActive(process.env) — one source of truth, live over the environment", () => {
  const KEYS = ["NODE_ENV", ...TRIGGERS] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const restore = () => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } };
  try {
    // Representative envs spanning prod-like and dev, with and without triggers.
    const cases = [
      { NODE_ENV: "production", OMNI_DEV_MODE: "1" },
      { NODE_ENV: "Production", OMNI_DEV_MODE: "1", BROKER_TRACE: "1" }, // mis-cased prod must stay off
      { NODE_ENV: "staging", DEV_PERSIST_FILE: "/tmp/x" },
      { NODE_ENV: "development" },
      { NODE_ENV: "development", OMNI_DEV_MODE: "1" },
      { NODE_ENV: "test", BROKER_CAPTURE: "/tmp/c" },
    ];
    for (const c of cases) {
      for (const k of KEYS) delete process.env[k];
      Object.assign(process.env, c);
      assert.equal(isDevMode(), devModeActive(process.env), `isDevMode() must equal devModeActive(process.env) for ${JSON.stringify(c)}`);
    }
    // Spot-check the two that matter most for the "100%" claim.
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, { NODE_ENV: "Production", OMNI_DEV_MODE: "1", BROKER_TRACE: "1", BROKER_CAPTURE: "/tmp/c", DEV_PERSIST_FILE: "/tmp/x" });
    assert.equal(isDevMode(), false, "mis-cased production with EVERY dev flag set must still be dev-mode OFF");
  } finally {
    restore();
  }
});
