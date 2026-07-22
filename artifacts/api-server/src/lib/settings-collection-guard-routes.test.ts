import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";

// Store + sealing need these before the modules load.
process.env["SESSION_SECRET"] ??= "collection-guard-test-secret";
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "collection-guard-"));

const { SECURITY_CONFIGS } = await import("./security-config");
const { settingsCollectionRouter } = await import("./settings-collection-router");
const { writeOrgConfigCollection } = await import("./scoped-config");

/**
 * The `settings-collection-router` config-def mode routes a SECURITY-classified config (registered in
 * `SECURITY_CONFIGS`) through the floor gate: a relaxation is held (HTTP 202 + pending), a strengthening applies
 * (200). A CHOICE config (unregistered) always applies (200). Proven over a real router on an ephemeral app.
 */
const CONFIG_ID = "__test-collection-egress";
SECURITY_CONFIGS[CONFIG_ID] = (o, n) => n === true && o !== true; // enabling egress relaxes

let base: string;
let server: ReturnType<express.Express["listen"]>;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", settingsCollectionRouter({ path: "/test-egress", configId: CONFIG_ID, responseKey: "enabled", versionLabel: "test egress", validate: (v) => v === true }));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const put = (enabled: unknown): Promise<Response> =>
  fetch(`${base}/api/test-egress`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });

test("relaxing (enable egress) is held for a signed sign-off → 202 + pending", async () => {
  writeOrgConfigCollection(CONFIG_ID, "test egress", false); // strengthened baseline
  const r = await put(true);
  assert.equal(r.status, 202);
  const body = await r.json() as { pending?: { proposalId: string; relaxes: string[] } };
  assert.ok(body.pending?.proposalId, "a proposal id is returned");
  assert.deepEqual(body.pending?.relaxes, [CONFIG_ID]);
});

test("strengthening (disable egress) applies immediately → 200", async () => {
  writeOrgConfigCollection(CONFIG_ID, "test egress", true); // start ON so OFF is a strengthening move
  const r = await put(false);
  assert.equal(r.status, 200);
  assert.equal((await r.json() as { enabled: boolean }).enabled, false);
});
