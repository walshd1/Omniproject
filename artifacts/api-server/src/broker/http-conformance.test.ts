import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createReferenceSidecar } from "./reference-sidecar";
import { structuralConformance, runReadConformance } from "./conformance";
import { updateSettings } from "../lib/settings";
import type { ActorContext } from "./types";

// webhookPool() prefers getSettings().brokerUrl (frozen at module load) over the
// BROKER_URL env, so point the broker at the sidecar via settings, not just env.
function pointBroker(url: string | null): void {
  updateSettings({ brokerUrl: url });
}

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
  pointBroker(`http://127.0.0.1:${port}`);

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
    pointBroker(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("reference sidecar handles the write path + error taxonomy over HTTP", async () => {
  const server = createReferenceSidecar();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prev = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  pointBroker(`http://127.0.0.1:${port}`);
  try {
    const { N8nBroker } = await import("./n8n");
    const { BrokerError } = await import("./types");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer test" };
    const pid = "proj-ref-1";

    // create → update (optimistic) → delete
    const created = await broker.writeIssue(ctx, "create", { projectId: pid, title: "Written via HTTP" });
    assert.ok(created && created.id, "create returned an issue");
    const updated = await broker.writeIssue(ctx, "update", { projectId: pid, issueId: created!.id, status: "in_progress", expectedVersion: created!.version });
    assert.equal(updated!.status, "in_progress");
    const deleted = await broker.writeIssue(ctx, "delete", { projectId: pid, issueId: created!.id });
    assert.equal(deleted, null);

    // project create + raid + task item exercise the rest of the write dispatch
    const proj = await broker.createProject(ctx, { name: "Sidecar Project", identifier: "SC" } as never);
    assert.ok(proj.id);
    assert.ok((await broker.addRaid(ctx, pid, { type: "risk", title: "r" })).id);

    // 404: updating a missing issue maps onto not_found
    await assert.rejects(
      () => broker.writeIssue(ctx, "update", { projectId: pid, issueId: "nope", status: "done" }),
      (e: unknown) => e instanceof BrokerError && e.code === "not_found",
    );

    // 409: a stale expectedVersion maps onto conflict
    const c2 = await broker.writeIssue(ctx, "create", { projectId: pid, title: "Conflict me" });
    await assert.rejects(
      () => broker.writeIssue(ctx, "update", { projectId: pid, issueId: c2!.id, status: "done", expectedVersion: 999 }),
      (e: unknown) => e instanceof BrokerError && e.code === "conflict",
    );
  } finally {
    if (prev === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prev;
    pointBroker(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
