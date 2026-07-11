import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  decideCapability,
  recentCapabilityLog,
  recentCapabilityLogShared,
  setCapabilityState,
  __resetCapabilityLogSink,
} from "./capability-governance";
import { sharedKv, __resetSharedStateForTest, __setRedisKvForTest } from "./shared-state";
import { FakeRedis } from "../__tests__/fake-redis";

/**
 * Governance decision log — the two OPT-IN extensions layered on the RAM ring:
 *  - durability via an external append sink (CAPABILITY_LOG_HTTP_URL), mirroring audit.ts;
 *  - fleet-sharing via the shared-state ring (active only under Redis).
 * The default (no env) behaviour is exercised by tools.test.ts and stays a plain RAM ring.
 */
const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env["CAPABILITY_LOG_HTTP_URL"];
  delete process.env["CAPABILITY_LOG_HTTP_TOKEN"];
  delete process.env["CAPABILITY_LOG_BATCH"];
  __resetCapabilityLogSink();
  await sharedKv.clear();
  __resetSharedStateForTest();
});

test("durability: each decision is POSTed to the external append sink as NDJSON with the bearer", async () => {
  const posts: { url: string; body: string; auth: string | null }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    posts.push({ url: String(url), body: String(init?.body ?? ""), auth: headers.get("authorization") });
    return new Response("", { status: 200 });
  }) as typeof fetch;

  process.env["CAPABILITY_LOG_HTTP_URL"] = "https://siem.acme.io/ingest";
  process.env["CAPABILITY_LOG_HTTP_TOKEN"] = "s3cret";
  process.env["CAPABILITY_LOG_BATCH"] = "1"; // auto-flush on every enqueue

  setCapabilityState("provider:openai", { state: "public" });
  decideCapability("provider:openai", { actor: { sub: "u1" } }); // a governance "use" decision
  await new Promise((r) => setTimeout(r, 10)); // let the best-effort flush run

  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, "https://siem.acme.io/ingest");
  assert.equal(posts[0]!.auth, "Bearer s3cret");
  const entry = JSON.parse(posts[0]!.body) as { action: string; capability: string };
  assert.equal(entry.capability, "provider:openai");
  assert.equal(entry.action, "use");
});

test("no sink env: nothing is POSTed (default RAM-only behaviour preserved)", async () => {
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("", { status: 200 }); }) as typeof fetch;
  decideCapability("provider:anthropic"); // off ⇒ a "blocked" decision, still RAM-only
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(called, false);
  assert.ok(recentCapabilityLog().some((e) => e.capability === "provider:anthropic"));
});

test("fleet-sharing: recentCapabilityLogShared reflects the shared ring under Redis", async () => {
  __setRedisKvForTest(new FakeRedis());
  setCapabilityState("provider:openai", { state: "public" });
  decideCapability("provider:openai", { actor: { sub: "a" } });
  decideCapability("provider:anthropic"); // blocked
  await new Promise((r) => setTimeout(r, 15)); // let the best-effort mirrors settle

  const fleet = await recentCapabilityLogShared();
  assert.ok(fleet.length >= 2);
  // Newest first: the anthropic "blocked" decision was mirrored last.
  assert.equal(fleet[0]!.capability, "provider:anthropic");
  assert.equal(fleet[0]!.action, "blocked");
  assert.ok(fleet.some((e) => e.capability === "provider:openai" && e.action === "use"));
});

test("fleet reader falls back to the local ring when no Redis is bound", async () => {
  decideCapability("provider:openai", { actor: { sub: "a" } });
  const shared = await recentCapabilityLogShared();
  const local = recentCapabilityLog();
  assert.deepEqual(shared, local); // identical without Redis
});
