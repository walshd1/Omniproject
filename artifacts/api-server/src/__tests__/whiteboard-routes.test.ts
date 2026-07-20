import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/whiteboard.ts over the REAL app. A board is saved to a STORAGE TARGET the author chooses:
 *   - `user`     the caller's private encrypted-JSON area (default; only they see it),
 *   - `project`  a project's shared area (gated by project scope),
 *   - `org`      the org-wide shared area (writing needs manager+),
 *   - `sidecar`  the built-in SoR (the demo broker here).
 * The JSON stores are AES-256-GCM sealed at rest under OMNI_CONFIG_DIR; ids are self-describing so a read
 * routes to the right store. These tests exercise the choke-point sanitiser and the per-target RBAC.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "whiteboard"; // default-off feature module — opt in for these route tests
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wb-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR; // enable the encrypted-JSON artifact store

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? ADMIN, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("create defaults to the private user area with a self-describing id; get returns the scene", async () => {
  const created = (await (await req("/whiteboards", { method: "POST", body: { name: "Mine", scene: { elements: [] } } })).json()) as { id: string; storage: string; ownerSub: string };
  assert.match(created.id, /^user~/, "default target is the private user area");
  assert.equal(created.storage, "user");
  assert.equal(created.ownerSub, "a", "owner is stamped from the session, not the client");
  const got = (await (await req(`/whiteboards/${created.id}`)).json()) as { id: string; name: string };
  assert.equal(got.name, "Mine");
});

test("create sanitises the scene (strips an embedded image, drops an unsafe link)", async () => {
  const r = await req("/whiteboards", { method: "POST", body: {
    name: "Sketch",
    scene: { elements: [
      { id: "img", type: "image", fileId: "blob" },
      { id: "t", type: "text", link: "javascript:alert(1)", text: "hi" },
    ] },
  } });
  assert.equal(r.status, 201);
  const created = (await r.json()) as { scene: { elements: Array<Record<string, unknown>> } };
  assert.equal(created.scene.elements.length, 1, "image element stripped");
  assert.equal("link" in created.scene.elements[0]!, false, "unsafe link dropped");
});

test("update then delete round-trips through the sealed JSON store", async () => {
  const created = (await (await req("/whiteboards", { method: "POST", body: { name: "Temp", scene: { elements: [] } } })).json()) as { id: string };
  const upd = await req(`/whiteboards/${created.id}`, { method: "PUT", body: { name: "Temp v2", scene: { elements: [{ id: "e1", type: "shape", shape: "ellipse", x: 0, y: 0 }] } } });
  assert.equal(upd.status, 200);
  assert.equal(((await upd.json()) as { name: string }).name, "Temp v2");
  assert.equal((await req(`/whiteboards/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/whiteboards/${created.id}`)).status, 404);
});

test("user areas are isolated: one user cannot read another's private board", async () => {
  const alice = cookie({ sub: "alice", email: "alice@x.io", roles: ["omni-admins"] });
  const bob = cookie({ sub: "bob", email: "bob@x.io", roles: ["omni-admins"] });
  const created = (await (await req("/whiteboards", { cookie: alice, method: "POST", body: { name: "Alice private", scene: { elements: [] } } })).json()) as { id: string };
  // Bob addresses Alice's id, but the user scope always uses the CALLER's sub → he sees nothing.
  assert.equal((await req(`/whiteboards/${created.id}`, { cookie: bob })).status, 404, "bob cannot read alice's user board");
  assert.equal((await req(`/whiteboards/${created.id}`, { cookie: alice })).status, 200, "alice still can");
});

test("the board is SEALED at rest (its name is not plaintext on disk)", async () => {
  await req("/whiteboards", { method: "POST", body: { name: "TopSecretBoardName", scene: { elements: [] } } });
  const file = path.join(CONFIG_DIR, "artifacts", "whiteboard", "user-a.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("TopSecretBoardName"), "the board name must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");
});

test("org target: a manager writes org-wide, a contributor is refused the org write", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], mgr: process.env["OIDC_MANAGER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const manager = cookie({ sub: "m1", email: "em@x.io", roles: ["omni-managers"] });
    const contributor = cookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    const ok = await req("/whiteboards", { cookie: manager, method: "POST", body: { name: "Org board", storage: "org", scene: { elements: [] } } });
    assert.equal(ok.status, 201, "manager can create an org board");
    const orgId = ((await ok.json()) as { id: string }).id;
    assert.match(orgId, /^org~/);
    // The contributor can READ the shared org board…
    assert.equal((await req(`/whiteboards/${orgId}`, { cookie: contributor })).status, 200, "contributor reads org board");
    // …but cannot CREATE or overwrite one.
    assert.equal((await req("/whiteboards", { cookie: contributor, method: "POST", body: { name: "No", storage: "org", scene: { elements: [] } } })).status, 403, "contributor cannot write org-wide");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_MANAGER_ROLES", prev.mgr], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("RBAC floor: a viewer reads but cannot author; a contributor can", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const viewer = cookie({ sub: "v1", email: "vee@x.io", roles: ["omni-viewers"] });
    assert.equal((await req("/whiteboards", { cookie: viewer })).status, 200, "viewer can read");
    assert.equal((await req("/whiteboards", { cookie: viewer, method: "POST", body: { name: "No", scene: { elements: [] } } })).status, 403, "viewer cannot author");
    const contributor = cookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    assert.equal((await req("/whiteboards", { cookie: contributor, method: "POST", body: { name: "Yes", scene: { elements: [] } } })).status, 201, "contributor can author");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.view], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("sidecar target still works through the broker (id prefixed sidecar~)", async () => {
  const created = (await (await req("/whiteboards", { method: "POST", body: { name: "Via SoR", storage: "sidecar", scene: { elements: [] } } })).json()) as { id: string; storage: string };
  assert.match(created.id, /^sidecar~/, "a sidecar board carries a self-describing sidecar id");
  assert.equal(created.storage, "sidecar");
  const got = await req(`/whiteboards/${created.id}`);
  assert.equal(got.status, 200);
  assert.equal((await req(`/whiteboards/${created.id}`, { method: "DELETE" })).status, 204);
});
