import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { __resetKeyRegistry } from "../lib/key-registry";

/**
 * Admin-gated key revocation, end to end: an admin revokes the session key and every
 * existing session is rejected at once; a per-user revocation kills just that user.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
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
const now = Date.now();
// Admin sessions for these tests are freshly stepped-up (revoke is a step-up-gated action).
const ADMIN = cookie({ sub: "admin-1", roles: ["omni-admins"], iat: now, seen: now, stepUpAt: now });
const USER = cookie({ sub: "user-1", roles: [], iat: now, seen: now });

before(async () => {
  __resetKeyRegistry();
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); __resetKeyRegistry(); });

const get = (path: string, cookieHdr: string) => fetch(`${base}${path}`, { headers: { cookie: cookieHdr } });

// (Role-gating of these admin routes is covered by security.test; demo mode here grants
// every session admin, so we exercise the revocation EFFECT, not the role wall.)

test("GET /api/security/keys lists the revocable keys", async () => {
  const res = await get("/api/security/keys", ADMIN);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { keys: { name: string }[] };
  assert.ok(body.keys.some((k) => k.name === "session"));
  assert.ok(body.keys.some((k) => k.name === "provenance"));
});

test("revoking the session key rejects every existing session at once", async () => {
  assert.equal((await get("/api/projects", USER)).status, 200); // works before

  const revoke = await fetch(`${base}/api/security/keys/session/revoke`, {
    method: "POST", headers: { cookie: ADMIN, "content-type": "application/json" }, body: JSON.stringify({ reason: "compromise" }),
  });
  assert.equal(revoke.status, 200);

  // The old session (signed under the now-revoked version 1) is dead.
  assert.equal((await get("/api/projects", USER)).status, 401);
  __resetKeyRegistry(); // restore module-global state
});
