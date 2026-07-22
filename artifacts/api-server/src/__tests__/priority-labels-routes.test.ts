import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Custom priority-level labels — admin/PMO relabel the canonical priorities (none/low/medium/high/urgent).
 * Held as a scope-layered `priority-labels` config def (no settings key); the route contract is unchanged.
 */

// The labels live in the sealed store now, so enable it on a temp dir before the app boots.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "priority-labels-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => { await h.req("/priority-labels", { method: "PUT", cookie: adminCookie(), body: { labels: {} } }); });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /priority-labels returns the canonical levels and (empty) custom labels", async () => {
  const r = await h.req("/priority-labels", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.deepEqual(b.canonical, ["none", "low", "medium", "high", "urgent"]);
  assert.deepEqual(b.labels, {});
});

test("PUT /priority-labels sets custom labels; canonical-only keys, capped length", async () => {
  const ok = await h.req("/priority-labels", { method: "PUT", cookie: adminCookie(), body: { labels: { urgent: "P0", high: "Critical", low: "" } } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await json(ok)).labels, { urgent: "P0", high: "Critical" }); // empty dropped

  // The saved labels resolve back out of the config def on the next GET.
  assert.deepEqual((await json(await h.req("/priority-labels", { cookie: adminCookie() }))).labels, { urgent: "P0", high: "Critical" });

  const bad = await h.req("/priority-labels", { method: "PUT", cookie: adminCookie(), body: { labels: { bogus: "X" } } });
  assert.equal(bad.status, 400);
});
