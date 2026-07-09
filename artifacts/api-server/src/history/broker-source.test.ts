import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { brokerRetentionSource, registerBrokerRetentionFromEnv } from "./broker-source";
import { retentionSourceFor, resetRetentionProvider, buildTrend } from "./retention";
import type { EntitySnapshot } from "./types";

afterEach(resetRetentionProvider);

/** A fake fetch that records calls and returns canned JSON per op path. */
function fakeFetch(replies: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const op = u.split("/retention/")[1] ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => replies[op] ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const snap = (asOf: string): EntitySnapshot => ({ entity: "issue", id: "1", asOf, values: { percentWorkComplete: 40 }, provenance: "replayed" });

test("brokerRetentionSource POSTs each op to /retention/<op> with the args", async () => {
  const { fn, calls } = fakeFetch({ "read-snapshots": [snap("2026-01-10T00:00:00Z")], "last-snapshot-at": { asOf: "2026-01-10T00:00:00Z" } });
  const src = brokerRetentionSource({ baseUrl: "http://broker:8090/", fetchImpl: fn });

  const snaps = await src.readSnapshots("issue", ["1"], { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  assert.equal(snaps[0]!.asOf, "2026-01-10T00:00:00Z");
  assert.equal(await src.lastSnapshotAt("issue", "1"), "2026-01-10T00:00:00Z");

  const readCall = calls.find((c) => c.url.endsWith("/retention/read-snapshots"))!;
  assert.deepEqual((readCall.body as { ids: string[] }).ids, ["1"]);
  // trailing slash on baseUrl is normalised (no //)
  assert.ok(!readCall.url.includes("//retention"));
});

test("a bearer token is attached when configured", async () => {
  let seenAuth: string | undefined;
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    seenAuth = (init?.headers as Record<string, string>)["authorization"];
    return { ok: true, status: 200, json: async () => ({ asOf: null }) } as Response;
  }) as unknown as typeof fetch;
  const src = brokerRetentionSource({ baseUrl: "http://broker", token: "s3cr3t", fetchImpl: fn });
  await src.lastSnapshotAt("issue", "1");
  assert.equal(seenAuth, "Bearer s3cr3t");
});

test("a non-2xx broker reply throws (so a write surfaces, not silently drops)", async () => {
  const fn = (async () => ({ ok: false, status: 503, json: async () => ({}) } as Response)) as unknown as typeof fetch;
  const src = brokerRetentionSource({ baseUrl: "http://broker", fetchImpl: fn });
  await assert.rejects(() => src.writeSnapshot(snap("2026-01-10T00:00:00Z")), /append|write|503|failed/i);
});

test("registerBrokerRetentionFromEnv wires a provider when RETENTION_BROKER_URL is set", () => {
  assert.equal(registerBrokerRetentionFromEnv({} as NodeJS.ProcessEnv), false, "no url ⇒ no-op");
  assert.equal(retentionSourceFor(), null);

  const ok = registerBrokerRetentionFromEnv({ RETENTION_BROKER_URL: "http://broker:8090" } as unknown as NodeJS.ProcessEnv);
  assert.equal(ok, true);
  assert.notEqual(retentionSourceFor(), null, "provider now resolves a source");
});

test("once registered, buildTrend flows through the broker source", async () => {
  const { fn } = fakeFetch({ "read-snapshots": [snap("2026-01-10T00:00:00Z")] });
  // Register a provider that uses the fake-fetch broker source.
  const { registerRetentionProvider } = await import("./retention");
  registerRetentionProvider(() => brokerRetentionSource({ baseUrl: "http://broker", fetchImpl: fn }));
  const series = await buildTrend("issue", ["1"], "completionPct", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "month");
  assert.equal(series.available, true);
  assert.equal(series.points[0]!.value, 40);
});
