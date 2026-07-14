import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOmniStoreServer } from "./server";
import { structuralConformance, runReadConformance } from "../conformance";
import { updateSettings } from "../../lib/settings";
import type { ActorContext } from "../types";

/**
 * OmniStore as a BACKEND behind the wire: a real broker (ReferenceBroker) drives the OmniStore server
 * over HTTP and passes broker conformance — proving it "drops into any broker". Also proves durability
 * (survives a restart via the sealed file) and SUPERSET storage (extension fields round-trip).
 */
const ctx: ActorContext = { sub: "t", email: "t@x.test", role: "admin", authHeader: "Bearer test" };

async function withServer(file: string | undefined, fn: (broker: any, url: string) => Promise<void>): Promise<void> {
  const server = createOmniStoreServer(file ? { file } : {});
  await new Promise<void>((r) => server.listen(0, () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const prev = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = url;
  updateSettings({ brokerUrl: url });
  try {
    const { ReferenceBroker } = await import("../reference-broker");
    await fn(new ReferenceBroker(), url);
  } finally {
    if (prev === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prev;
    updateSettings({ brokerUrl: null });
    server.close();
  }
}

test("a real broker drives OmniStore over the wire and passes conformance (drops into any broker)", async () => {
  await withServer(undefined, async (broker) => {
    const p = await broker.createProject(ctx, { name: "Seed" });
    await broker.writeIssue(ctx, "create", { projectId: p.id, title: "Seed issue", status: "todo" });
    const structural = structuralConformance(broker);
    assert.ok(structural.ok, `structural: ${JSON.stringify(structural.checks.filter((c: any) => !c.ok))}`);
    const read = await runReadConformance(broker, ctx);
    assert.ok(read.ok, `read: ${JSON.stringify(read.checks.filter((c: any) => !c.ok))}`);
    assert.equal(read.broker, "n8n"); // it really reported the wire binding, not demo
  });
});

test("stores the SUPERSET — extension fields no vendor API exposes round-trip", async () => {
  await withServer(undefined, async (broker) => {
    // Fields a third-party API wouldn't hold: OmniProject's correlation GUID + a custom field.
    const p = await broker.createProject(ctx, { name: "Sup", omniInstanceId: "guid-123", cf_costCentre: "CC-42" } as any);
    const back = (await broker.listProjects(ctx)).find((x: any) => x.id === p.id);
    assert.equal(back.omniInstanceId, "guid-123");
    assert.equal((back as any).cf_costCentre, "CC-42"); // preserved, not allow-listed away
  });
});

test("durable — data survives a restart via the sealed, chain-verified file", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omnistore-")), "store.sealed");
  let projectId = "";
  await withServer(file, async (broker) => {
    const p = await broker.createProject(ctx, { name: "Persisted" });
    projectId = p.id;
  });
  assert.ok(fs.existsSync(file), "sealed file written");
  const bytes = fs.readFileSync(file, "utf8");
  assert.ok(bytes.startsWith("og1.") && !bytes.includes("Persisted"), "encrypted at rest, not plaintext");
  // A fresh server on the same file recovers the state.
  await withServer(file, async (broker) => {
    const p = (await broker.listProjects(ctx)).find((x: any) => x.id === projectId);
    assert.equal(p?.name, "Persisted");
  });
});
