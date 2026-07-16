import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/push.ts over the REAL app — behind the default-off `pushNotifications` module. A signed-in user
 * registers their device's browser push subscription (endpoint must be an allowed push-service host);
 * subscriptions are stored per-user, AES-256-GCM sealed under OMNI_CONFIG_DIR. Routes 501 when VAPID keys
 * aren't configured. Here they ARE configured so the happy path is exercised.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "pushNotifications";
process.env["SECURITY_STRICT"] = "off";
process.env["VAPID_PUBLIC_KEY"] = "BExamplePublicVapidKey";
process.env["VAPID_PRIVATE_KEY"] = "examplePrivateVapidKey";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "push-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); delete process.env["VAPID_PUBLIC_KEY"]; delete process.env["VAPID_PRIVATE_KEY"]; });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? VIEWER, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

const FCM = "https://fcm.googleapis.com/fcm/send/device-x";
const SUBSCRIPTION = { endpoint: FCM, keys: { p256dh: "BpubKey", auth: "authSecret" } };

test("GET /push/vapid-key returns the configured public key (viewer+)", async () => {
  const r = await req("/push/vapid-key");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { publicKey: "BExamplePublicVapidKey" });
});

test("subscribe → the subscription is sealed at rest, then unsubscribe removes it", async () => {
  const r = await req("/push/subscribe", { method: "POST", body: { subscription: SUBSCRIPTION } });
  assert.equal(r.status, 201);

  // Sealed on disk — the endpoint URL must not appear in plaintext.
  const file = path.join(CONFIG_DIR, "artifacts", "push-subscription", "user-v.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("device-x"), "the endpoint must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");

  const un = await req("/push/unsubscribe", { method: "POST", body: { endpoint: FCM } });
  assert.equal(un.status, 204);
});

test("subscribe rejects a disallowed (SSRF) endpoint with 400", async () => {
  const r = await req("/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://169.254.169.254/latest", keys: { p256dh: "p", auth: "a" } } } });
  assert.equal(r.status, 400);
});

test("push routes require a signed-in caller", async () => {
  const r = await req("/push/subscribe", { method: "POST", body: { subscription: SUBSCRIPTION }, cookie: "omni_session=bogus" });
  assert.equal(r.status, 401);
});
