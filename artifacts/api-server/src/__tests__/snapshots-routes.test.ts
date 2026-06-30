import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { SnapshotBundle } from "../lib/snapshot";

/** Snapshot capture + verify over the REAL app (any authed session). Signing is OFF in tests, so the
 *  proof is content-integrity; the signed path is unit-tested in lib/snapshot.test.ts. */
const SECRET = "test-session-secret-snapshots";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const USER = cookie({ sub: "u-snap", name: "Grace", email: "grace@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const post = (path: string, body: unknown) =>
  fetch(`${base}/api${path}`, { method: "POST", headers: { cookie: USER, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("capture returns a signed-or-hashed bundle; verify confirms it intact, and detects tampering", async () => {
  const data = [{ programme: "Platform", budget: 1000 }, { programme: "Mobile", budget: 500 }];
  const cap = await post("/snapshots/capture", { scope: "portfolio-financials", label: "March pack", data });
  assert.equal(cap.status, 200);
  const bundle = (await cap.json()) as SnapshotBundle;
  assert.ok(bundle.manifest.contentHash && bundle.manifest.createdAt && bundle.manifest.id);

  const ok = await post("/snapshots/verify", bundle).then((r) => r.json()) as { ok: boolean; contentMatches: boolean };
  assert.equal(ok.ok, true);
  assert.equal(ok.contentMatches, true);

  // Alter the data after the fact → verify fails.
  const tampered = { manifest: bundle.manifest, data: [{ programme: "Platform", budget: 999999 }] };
  const bad = await post("/snapshots/verify", tampered).then((r) => r.json()) as { ok: boolean };
  assert.equal(bad.ok, false);
});

test("capture without a data payload is a 400", async () => {
  assert.equal((await post("/snapshots/capture", { scope: "x" })).status, 400);
});
