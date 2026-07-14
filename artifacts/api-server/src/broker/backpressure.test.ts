import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createReferenceSidecar } from "./reference-sidecar";
import { retryAfterMs } from "./reference-broker/index";
import { updateSettings } from "../lib/settings";
import { BrokerError, type ActorContext } from "./types";

/**
 * Backpressure end-to-end: the reference sidecar sheds load with 429 + Retry-After, and the gateway
 * broker (callBroker) honours it — retrying a bounded number of times, then surfacing a clean
 * rate_limited (429) error once the retries are exhausted. This is the wire contract a DB-backed
 * sidecar uses to protect its connection pool at massive scale.
 */
const ctx: ActorContext = { sub: "t", email: "t@x.test", role: "admin", authHeader: "Bearer test" };

async function withSidecar(opts: { rejectFirst?: number }, fn: (broker: { listProjects(c: ActorContext): Promise<unknown> }) => Promise<void>): Promise<void> {
  const server = createReferenceSidecar(opts);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const prev = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = url;
  updateSettings({ brokerUrl: url });
  try {
    const { ReferenceBroker } = await import("./reference-broker");
    await fn(new ReferenceBroker());
  } finally {
    if (prev === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prev;
    updateSettings({ brokerUrl: null });
    server.close();
  }
}

test("gateway retries past a transient 429 and the read succeeds", async () => {
  await withSidecar({ rejectFirst: 1 }, async (broker) => {
    const projects = (await broker.listProjects(ctx)) as unknown[];
    assert.ok(Array.isArray(projects) && projects.length >= 1, "read succeeded after the sidecar's one 429");
  });
});

test("a sustained 429 (beyond the retry budget) surfaces as a clean rate_limited error", async () => {
  await withSidecar({ rejectFirst: 5 }, async (broker) => {
    await assert.rejects(
      () => broker.listProjects(ctx),
      (err: unknown) => err instanceof BrokerError && err.code === "rate_limited",
    );
  });
});

test("retryAfterMs honours Retry-After (seconds), caps long waits, and falls back to backoff", () => {
  const hdr = (v: string | null) => ({ headers: { get: () => v } });
  assert.equal(retryAfterMs(hdr("2"), 0, 0), 2000); // 2s honoured
  assert.equal(retryAfterMs(hdr("999"), 0, 0), 3000); // capped at the 3s ceiling
  assert.equal(retryAfterMs(hdr("0"), 0, 0), 0); // immediate
  assert.equal(retryAfterMs(hdr(null), 0, 0), 250); // backoff fallback, attempt 0
  assert.equal(retryAfterMs(hdr(null), 2, 0), 1000); // backoff fallback, attempt 2
});
