import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createReferenceSidecar } from "./reference-sidecar";
import { structuralConformance, runReadConformance } from "./conformance";
import type { ActorContext } from "./types";

/**
 * Proves the broker HTTP binding end-to-end: the reference broker (N8nBroker)
 * talks over real HTTP to the reference sidecar, and the broker-agnostic
 * conformance suite passes. This is the acceptance test a DB-backed sidecar
 * (RFC-003) must also pass — when it does, it drops in with zero core changes
 * (point BROKER_URL at it). If this is green, the seam is proven for any
 * out-of-process broker, not just the in-process demo.
 */
test("reference HTTP sidecar passes broker conformance over the wire", async () => {
  const server = createReferenceSidecar();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prev = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;

  try {
    // Import after pointing BROKER_URL at the sidecar; webhookUrl() reads live.
    const { N8nBroker } = await import("./n8n");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer test" };

    const structural = structuralConformance(broker);
    assert.ok(structural.ok, `structural failures: ${JSON.stringify(structural.checks.filter((c) => !c.ok))}`);

    const read = await runReadConformance(broker, ctx);
    assert.ok(read.ok, `read failures: ${JSON.stringify(read.checks.filter((c) => !c.ok))}`);
    // The broker really reported "n8n" (the reference HTTP binding), not demo.
    assert.equal(read.broker, "n8n");
  } finally {
    if (prev === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prev;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
