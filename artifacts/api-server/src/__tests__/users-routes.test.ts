import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, type Harness } from "./_harness";

/**
 * Native in-app users over the REAL app (demo broker, no IdP). Covers the first-admin bootstrap, the demo
 * interlock (creating the first user turns demo OFF), the local login, and the admin-gated roster. CSRF is
 * disabled here so the test can drive authed mutations with just the captured session cookie.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
process.env["CSRF_DISABLED"] = "true";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "users-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
/** Fold a response's Set-Cookie headers into a `name=value; …` cookie string for the next request. */
function cookiesFrom(r: Response): string {
  const set = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

test("a fresh IdP-less deployment reports needsFirstAdmin", async () => {
  const me = await json(await h.req("/auth/me"));
  assert.equal(me.localSignInEnabled, true);
  assert.equal(me.needsFirstAdmin, true);
});

let adminCookie = "";

test("POST /auth/local/bootstrap claims the first admin (once)", async () => {
  const r = await h.req("/auth/local/bootstrap", { method: "POST", body: { userName: "root", password: "first-admin-pw!" } });
  assert.equal(r.status, 201);
  const body = await json(r);
  assert.equal(body.user.userName, "root");
  assert.ok(body.user.groups.length >= 1, "the first admin gets an admin group");
  adminCookie = cookiesFrom(r);
  assert.match(adminCookie, /omni_session=/);

  // Now that an active user exists, demo is off and the bootstrap door is closed.
  const me = await json(await h.req("/auth/me"));
  assert.equal(me.needsFirstAdmin, false);
  assert.equal((await h.req("/auth/local/bootstrap", { method: "POST", body: { userName: "x", password: "another-pw!!" } })).status, 409);
});

test("the bootstrapped local admin can administer the roster", async () => {
  // GET /users is admin-gated; the local admin (password-only admin allowed by default) clears it.
  const list = await h.req("/users", { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.equal((await json(list)).users.length, 1);

  // Create a second (contributor) user with a password.
  const create = await h.req("/users", { method: "POST", cookie: adminCookie, body: { userName: "alice", groups: ["omni-members"], password: "alice-password" } });
  assert.equal(create.status, 201);
  assert.equal((await json(create)).user.userName, "alice");
  assert.equal((await json(await h.req("/users", { cookie: adminCookie }))).users.length, 2);
});

test("POST /auth/local signs a user in; wrong password is 401", async () => {
  assert.equal((await h.req("/auth/local", { method: "POST", body: { userName: "alice", password: "nope" } })).status, 401);
  const ok = await h.req("/auth/local", { method: "POST", body: { userName: "alice", password: "alice-password" } });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).ok, true);
});

test("an unauthenticated caller can't reach the roster", async () => {
  assert.equal((await h.req("/users")).status, 401);
});
