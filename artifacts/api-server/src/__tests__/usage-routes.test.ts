import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";
import { recordUsage } from "../lib/usage-metering";
import { __resetSharedStateForTest } from "../lib/shared-state";

/**
 * routes/usage.ts — the external-API usage + limits surface. Drives: the pmo/admin GET report
 * (vendors with volume totals + limit warning), the policy write (validated) + read-back, RBAC,
 * and the 400 on a malformed policy.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  __resetSharedStateForTest();
  (await import("../lib/settings")).updateSettings({ usagePolicies: {} });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: adminCookie(), ...opts });

test("GET /usage requires authentication (no session is refused)", async () => {
  // The report is behind requireAuth + requireAnyRole("pmo","admin"). Demo auth grants every SESSION
  // all authorities, so a member cookie can't exercise the role gate here — but an UNauthenticated
  // request is stopped at requireAuth (401), proving the surface isn't public.
  const r = await h.req("/usage", {});
  assert.equal(r.status, 401);
});

test("GET /usage surfaces a vendor's recorded volume with hour/day/month totals", async () => {
  await recordUsage("openai", { calls: 2, tokens: 800 });
  const r = await req("/usage");
  assert.equal(r.status, 200);
  const json = (await r.json()) as { vendors: { vendor: string; totals: { day: { calls: number; tokens: number } } }[] };
  const openai = json.vendors.find((v) => v.vendor === "openai")!;
  assert.ok(openai, "openai vendor present");
  assert.equal(openai.totals.day.calls, 2);
  assert.equal(openai.totals.day.tokens, 800);
});

test("PUT /usage/policies stores a limit + cost; GET /usage reflects the warning + cost", async () => {
  await recordUsage("openai", { tokens: 900 });
  const put = await req("/usage/policies", {
    method: "PUT",
    body: { usagePolicies: { openai: { limit: { period: "day", metric: "tokens", max: 1000 }, cost: { per: "ktoken", amount: 0.5, currency: "USD" } } } },
  });
  assert.equal(put.status, 200);
  const r = await req("/usage");
  const json = (await r.json()) as { vendors: { vendor: string; limit: { level: string; fraction: number } | null; cost: { currency: string; day: number } | null }[] };
  const openai = json.vendors.find((v) => v.vendor === "openai")!;
  assert.equal(openai.limit?.level, "critical"); // 900/1000 = 90%
  assert.equal(openai.limit?.fraction, 0.9);
  assert.equal(openai.cost?.currency, "USD");
  assert.equal(openai.cost?.day, 0.45); // 900 tokens / 1000 * 0.5
});

test("PUT /usage/policies rejects a malformed policy with 400", async () => {
  const r = await req("/usage/policies", {
    method: "PUT",
    body: { usagePolicies: { jira: { limit: { period: "fortnight", metric: "calls", max: 10 } } } },
  });
  assert.equal(r.status, 400);
});

test("POST /usage/notify summarises limit breaches (and reports all-clear otherwise)", async () => {
  const clear = await req("/usage/notify", { method: "POST" });
  assert.equal(clear.status, 200);
  assert.equal(((await clear.json()) as { worst: string }).worst, "ok");

  await recordUsage("openai", { calls: 100 });
  await req("/usage/policies", { method: "PUT", body: { usagePolicies: { openai: { limit: { period: "day", metric: "calls", max: 100 } } } } });
  const r = await req("/usage/notify", { method: "POST" });
  const json = (await r.json()) as { worst: string; flagged: { vendor: string; level: string }[]; notified: boolean };
  assert.equal(json.worst, "over"); // 100/100 = 100%
  assert.equal(json.flagged[0]?.vendor, "openai");
  assert.equal(json.flagged[0]?.level, "over");
});

test("GET /usage/policies reads back what was written", async () => {
  await req("/usage/policies", { method: "PUT", body: { usagePolicies: { jira: { cost: { per: "call", amount: 0.01, currency: "GBP" } } } } });
  const r = await req("/usage/policies");
  assert.equal(r.status, 200);
  const json = (await r.json()) as { usagePolicies: Record<string, { cost?: { amount: number } }> };
  assert.equal(json.usagePolicies["jira"]?.cost?.amount, 0.01);
});
