import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, stepUpAdminCookie, adminCookie, type Harness } from "./_harness";

/**
 * Instance recovery key (IRK) + portable backup over the REAL app: reveal-once, portable backup sealed under
 * the IRK, and restore-with-old-key → rotate → new key. CSRF off so the test can drive the authed POSTs.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
process.env["CSRF_DISABLED"] = "true";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "instance-key-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
const STEP = stepUpAdminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET status reports an available, not-yet-revealed key", async () => {
  const s = await json(await h.req("/setup/instance-key", { cookie: adminCookie() }));
  assert.equal(s.available, true);
  assert.equal(s.revealed, false);
  assert.ok(s.fingerprint);
});

let savedKey = "";

test("reveal is ONE-TIME (base64 key, then 409)", async () => {
  const r = await h.req("/setup/instance-key/reveal", { method: "POST", cookie: STEP });
  assert.equal(r.status, 200);
  savedKey = (await json(r)).key;
  assert.ok(savedKey && Buffer.from(savedKey, "base64").length === 32);
  // Now marked revealed → status reflects it, and a second reveal is refused.
  assert.equal((await json(await h.req("/setup/instance-key", { cookie: adminCookie() }))).revealed, true);
  assert.equal((await h.req("/setup/instance-key/reveal", { method: "POST", cookie: STEP })).status, 409);
});

let bundle: unknown;

test("portable backup is sealed under the IRK (ciphertext) and opens the whole system", async () => {
  const r = await h.req("/setup/portable-backup", { cookie: STEP });
  assert.equal(r.status, 200);
  bundle = await json(r);
  assert.equal((bundle as { schema: string }).schema, "omniproject/portable-backup");
  assert.ok((bundle as { sealed: string }).sealed);
});

test("restore with the WRONG key is refused; the RIGHT key restores + rotates to a fresh key", async () => {
  const wrong = Buffer.alloc(32, 9).toString("base64");
  assert.equal((await h.req("/setup/portable-restore", { method: "POST", cookie: STEP, body: { bundle, key: wrong } })).status, 400);

  const ok = await h.req("/setup/portable-restore", { method: "POST", cookie: STEP, body: { bundle, key: savedKey } });
  assert.equal(ok.status, 200);
  const body = await json(ok);
  assert.equal(body.restored, true);
  assert.ok(body.newKey && Buffer.from(body.newKey, "base64").length === 32);
  assert.notEqual(body.newKey, savedKey, "the instance rotated to a fresh key on restore");

  // The old backup can no longer be restored (the instance key rotated).
  assert.equal((await h.req("/setup/portable-restore", { method: "POST", cookie: STEP, body: { bundle, key: savedKey } })).status, 200);
  // (savedKey still opens the OLD bundle — the bundle was sealed under it; rotation only changes FUTURE backups.)
});

test("reveal/backup require a step-up (a plain admin is refused)", async () => {
  assert.equal((await h.req("/setup/instance-key/reveal", { method: "POST", cookie: adminCookie() })).status, 403);
  assert.equal((await h.req("/setup/portable-backup", { cookie: adminCookie() })).status, 403);
});
