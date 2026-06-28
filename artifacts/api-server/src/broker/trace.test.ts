import { test } from "node:test";
import assert from "node:assert/strict";
import {
  debugAllowed,
  traceEnabled,
  payloadsEnabled,
  shape,
  redactDeep,
  wrapWithTrace,
  firstDifference,
} from "./trace";
import type { Broker } from "./types";

/**
 * Trace decorator + gating tests. The production-inert assertions here are the CI
 * guard the release posture requires: with NODE_ENV=production, no debug surface
 * activates regardless of the opt-in flags.
 */

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// --- Gating: shipped but inert in production (the CI guard) ---------------------

test("CI guard: every debug surface is inert under NODE_ENV=production", () => {
  withEnv({ NODE_ENV: "production", BROKER_TRACE: "1", BROKER_TRACE_PAYLOADS: "1" }, () => {
    assert.equal(debugAllowed(), false);
    assert.equal(traceEnabled(), false, "tracing must not activate in production even with BROKER_TRACE=1");
    assert.equal(payloadsEnabled(), false, "payload logging must not activate in production");
  });
});

test("tracing is off by default and opt-in only on non-prod", () => {
  withEnv({ NODE_ENV: "development", BROKER_TRACE: undefined, BROKER_TRACE_PAYLOADS: undefined }, () => {
    assert.equal(traceEnabled(), false);
    assert.equal(payloadsEnabled(), false);
  });
  withEnv({ NODE_ENV: "development", BROKER_TRACE: "1" }, () => {
    assert.equal(traceEnabled(), true);
  });
  withEnv({ NODE_ENV: "development", BROKER_TRACE: "1", BROKER_TRACE_PAYLOADS: "1" }, () => {
    assert.equal(payloadsEnabled(), true);
  });
});

// --- Redaction -----------------------------------------------------------------

test("redactDeep masks credentials at any depth, keeps non-secret values", () => {
  const ctx = { sub: "u1", email: "a@b.com", token: "SECRET", authHeader: "Bearer SECRET" };
  const out = redactDeep({ ctx, input: { title: "Hi", nested: { apiKey: "k" } } }) as Record<string, any>;
  assert.equal(out["ctx"].token, "[redacted]");
  assert.equal(out["ctx"].authHeader, "[redacted]");
  assert.equal(out["ctx"].email, "a@b.com");
  assert.equal(out["input"].title, "Hi");
  assert.equal(out["input"].nested.apiKey, "[redacted]");
});

test("shape emits structure only, never values", () => {
  assert.equal(shape("hello"), "string");
  assert.equal(shape(42), "number");
  assert.equal(shape([1, 2, 3]), "array(3)");
  assert.equal(shape({ b: 1, a: 2 }), "object{a,b}");
  // no actual value leaks into the descriptor
  assert.ok(!String(shape({ token: "SECRET" })).includes("SECRET"));
});

// --- Proxy delegation: observation only, value passthrough ---------------------

test("wrapWithTrace passes results and rejections through untouched", async () => {
  const calls: string[] = [];
  const fake = {
    kind: "demo",
    live: false,
    async listProjects(_ctx: unknown) {
      calls.push("listProjects");
      return [{ id: "p1", name: "One" }];
    },
    async boom(_ctx: unknown) {
      throw new Error("nope");
    },
  } as unknown as Broker;

  const traced = wrapWithTrace(fake);
  // non-function props pass through
  assert.equal((traced as unknown as { kind: string }).kind, "demo");
  // resolved value is identical
  const res = await traced.listProjects({} as never);
  assert.deepEqual(res, [{ id: "p1", name: "One" }]);
  assert.deepEqual(calls, ["listProjects"]);
  // rejection propagates
  await assert.rejects(() => (traced as unknown as { boom: (c: unknown) => Promise<unknown> }).boom({}), /nope/);
});

// --- Idempotency diff (the CLI's --twice) --------------------------------------

test("firstDifference returns null for identical results and a path otherwise", () => {
  assert.equal(firstDifference([{ id: 1 }], [{ id: 1 }]), null);
  assert.equal(firstDifference({ a: 1 }, { a: 1 }), null);
  assert.match(String(firstDifference({ a: 1 }, { a: 2 })), /\$\.a/);
  assert.match(String(firstDifference([1, 2], [1, 2, 3])), /length/);
  assert.match(String(firstDifference({ x: { y: 1 } }, { x: { y: 2 } })), /\$\.x\.y/);
});
