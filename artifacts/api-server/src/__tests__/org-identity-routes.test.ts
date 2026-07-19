import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the org's canonical identity (id + name), a scope-layered `org-identity` config def:
 *  - GET /api/org-identity — the current identity (any authed user); the id is minted at boot.
 *  - PUT /api/org-identity — mint-if-needed + set the (ungated) name; the id is immutable. Admin/PMO.
 */

// The sealed store must be on a temp dir so the config def persists where the booted app reads it.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "org-identity-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /org-identity returns an id minted on first read (org id always exists)", async () => {
  const r = await h.req("/org-identity", { cookie: memberCookie() });
  assert.equal(r.status, 200);
  const { identity } = await json(r);
  assert.match(identity.id, /^org_/, "the org id is minted");
  assert.equal(typeof identity.name, "string");

  // A second read is stable — the id is minted once, never rewritten.
  const again = (await json(await h.req("/org-identity", { cookie: memberCookie() }))).identity;
  assert.equal(again.id, identity.id);
});

test("PUT /org-identity sets the ungated name; the id is stable across the write", async () => {
  const before = (await json(await h.req("/org-identity", { cookie: adminCookie() }))).identity;

  const put = await h.req("/org-identity", { method: "PUT", cookie: adminCookie(), body: { name: "Acme Inc." } });
  assert.equal(put.status, 200);
  const named = (await json(put)).identity;
  assert.equal(named.name, "Acme Inc.");
  assert.equal(named.id, before.id, "the org id never changes when the name is set");

  // The read reflects the new name, same id.
  const after = (await json(await h.req("/org-identity", { cookie: memberCookie() }))).identity;
  assert.deepEqual(after, { id: before.id, name: "Acme Inc.", logo: "", showLogo: false });
});

test("PUT /org-identity stores an org logo (ungated) + the show-on-surfaces opt-in", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const put = await h.req("/org-identity", { method: "PUT", cookie: adminCookie(), body: { logo: png, showLogo: true } });
  assert.equal(put.status, 200);
  const identity = (await json(put)).identity;
  assert.equal(identity.logo, png);
  assert.equal(identity.showLogo, true);
  assert.equal(identity.name, "Acme Inc.", "the earlier name is preserved by the logo-only patch");

  // An unsafe logo (inline SVG can carry script) is refused → 400, leaving the stored logo untouched.
  const bad = await h.req("/org-identity", { method: "PUT", cookie: adminCookie(), body: { logo: "data:image/svg+xml;base64,PHN2Zz4=" } });
  assert.equal(bad.status, 400);
  assert.equal((await json(await h.req("/org-identity", { cookie: memberCookie() }))).identity.logo, png, "unchanged after the rejected logo");
});

test("a caller can NEVER change the immutable id via PUT", async () => {
  const original = (await json(await h.req("/org-identity", { cookie: adminCookie() }))).identity;
  const put = await h.req("/org-identity", { method: "PUT", cookie: adminCookie(), body: { id: "org_hacked", name: "Still Acme" } });
  assert.equal(put.status, 200);
  assert.equal((await json(put)).identity.id, original.id, "the supplied id is ignored");
});

// NB the demo-auth harness treats every session as admin (roles aren't downgraded), so the admin/PMO gate on PUT
// can't be exercised here; the gate itself is asserted by the shared route-scope/RBAC unit coverage. The
// auth-boundary that DOES bite in this harness is "no session at all":

test("GET requires auth", async () => {
  assert.equal((await h.req("/org-identity")).status, 401);
});
