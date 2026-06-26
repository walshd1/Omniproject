import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createReferenceSidecar } from "./reference-sidecar";
import { updateSettings } from "../lib/settings";
import { openPayload, sealPayload } from "../lib/broker-psk";
import type { ActorContext } from "./types";

// webhookPool() prefers getSettings().brokerUrl (frozen at module load) over the
// BROKER_URL env, so point the broker at the test server via settings too.
function pointBroker(url: string | null): void {
  updateSettings({ brokerUrl: url });
}

const PSK = "integration-test-shared-broker-key";

/**
 * Proves the security claim end-to-end: with BROKER_PSK set, what OmniProject
 * actually writes on the wire is opaque ciphertext — a `tcpdump`/Wireshark sees
 * neither the action, the project data, nor the user's bearer token in cleartext.
 * And the reference sidecar decrypts it, dispatches, and re-encrypts its reply, so
 * the whole hop round-trips while staying encrypted in both directions.
 */
test("PSK on: the gateway's wire body is ciphertext with no plaintext action/data/token", async () => {
  const captured: string[] = [];
  // A recording broker: capture the exact bytes, prove they decrypt only with the
  // key, then answer with a properly-encrypted envelope the gateway can unwrap.
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      captured.push(raw);
      const body = JSON.parse(raw) as { enc?: string };
      const inner = JSON.parse(openPayload(body.enc!)!) as { action: string };
      assert.equal(inner.action, "list_projects"); // decryptable with the key, as expected
      const reply = sealPayload(JSON.stringify({ success: true, data: [{ id: "p1", name: "Secret Programme" }], message: null }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ v: 1, enc: reply }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"];
  const prevPsk = process.env["BROKER_PSK"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  process.env["BROKER_PSK"] = PSK;
  pointBroker(`http://127.0.0.1:${port}`);

  try {
    const { N8nBroker } = await import("./n8n");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer super-secret-token-xyz" };

    const projects = await broker.listProjects(ctx);
    assert.deepEqual(projects, [{ id: "p1", name: "Secret Programme" }]); // reply decrypted

    assert.equal(captured.length, 1);
    const wire = captured[0]!;
    // The smoking gun: none of the sensitive material appears in cleartext.
    assert.ok(!wire.includes("list_projects"), "action leaked in cleartext");
    assert.ok(!wire.includes("super-secret-token-xyz"), "bearer token leaked in cleartext");
    assert.ok(!wire.includes("Authorization"), "auth header name leaked");
    assert.ok(wire.includes('"enc"'), "body is the encrypted envelope");
    // And it is genuinely undecryptable without the key.
    const prev = process.env["BROKER_PSK"];
    process.env["BROKER_PSK"] = "the-wrong-key";
    assert.equal(openPayload((JSON.parse(wire) as { enc: string }).enc), null);
    process.env["BROKER_PSK"] = prev;
  } finally {
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    if (prevPsk === undefined) delete process.env["BROKER_PSK"]; else process.env["BROKER_PSK"] = prevPsk;
    pointBroker(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("PSK on: full encrypted round-trip through the reference sidecar (read + write)", async () => {
  const server = createReferenceSidecar();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"];
  const prevPsk = process.env["BROKER_PSK"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  process.env["BROKER_PSK"] = PSK;
  pointBroker(`http://127.0.0.1:${port}`);

  try {
    const { N8nBroker } = await import("./n8n");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer test" };

    // Read path: the sidecar decrypts, dispatches, re-encrypts — and it works.
    const projects = await broker.listProjects(ctx);
    assert.ok(projects.length >= 1 && projects[0]!.id === "proj-ref-1");

    // Write path through the same encrypted hop.
    const created = await broker.writeIssue(ctx, "create", { projectId: "proj-ref-1", title: "Encrypted write" });
    assert.ok(created && created.id, "create round-tripped through the encrypted hop");
  } finally {
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    if (prevPsk === undefined) delete process.env["BROKER_PSK"]; else process.env["BROKER_PSK"] = prevPsk;
    pointBroker(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
});
