import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/proofs.ts over the REAL app. A proof references a deliverable (image/PDF, never inlined), carries
 * annotation primitives, and holds a review decision bound to the version. Saved to a storage target
 * (private user area by default / org / project), AES-256-GCM sealed under OMNI_CONFIG_DIR. Ids are
 * self-describing so a read routes to the right store; a `user` scope always uses the caller's own sub.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "proofing";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "proof-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

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

const DELIVERABLE = { kind: "image", url: "https://cdn.example/mockup-v1.png", label: "Mockup v1" };

test("create defaults to the private user area, sanitises annotations, seals at rest", async () => {
  const r = await req("/proofs", { method: "POST", body: {
    name: "Homepage review",
    deliverable: DELIVERABLE,
    annotations: [
      { id: "p1", type: "pin", x: 0.5, y: 2.0, text: "logo too big", evil: "drop" }, // y clamped to 1, extra dropped
      { id: "b1", type: "box", x: 0.1, y: 0.1, w: 0.3, h: 0.2, text: "crop here" },
      { id: "x", type: "scribble" }, // unknown type → dropped
    ],
  } });
  assert.equal(r.status, 201);
  const proof = (await r.json()) as { id: string; version: number; decision: string; ownerSub: string; annotations: Array<Record<string, unknown>> };
  assert.match(proof.id, /^user~/, "default target is the private user area");
  assert.equal(proof.version, 1);
  assert.equal(proof.decision, "pending");
  assert.equal(proof.ownerSub, "a", "owner stamped from the session");
  assert.equal(proof.annotations.length, 2, "unknown-type annotation dropped");
  assert.equal(proof.annotations[0]!["y"], 1, "coordinate clamped to the normalised range");
  assert.equal("evil" in proof.annotations[0]!, false, "smuggled field dropped");

  const file = path.join(CONFIG_DIR, "artifacts", "proof", "user-a.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("logo too big"), "the annotation note must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");
});

test("a deliverable with an unsafe url is rejected (400)", async () => {
  const r = await req("/proofs", { method: "POST", body: { name: "Bad", deliverable: { kind: "image", url: "javascript:alert(1)" }, annotations: [] } });
  assert.equal(r.status, 400);
});

test("decision is stamped server-side and bound to the version; replacing the deliverable re-opens it", async () => {
  const created = (await (await req("/proofs", { method: "POST", body: { name: "Flyer", deliverable: DELIVERABLE, annotations: [] } })).json()) as { id: string };
  const decided = await req(`/proofs/${created.id}/decision`, { method: "POST", body: { decision: "approved" } });
  assert.equal(decided.status, 200);
  const d = (await decided.json()) as { decision: string; decidedBy: string; decisionVersion: number };
  assert.equal(d.decision, "approved");
  assert.equal(d.decidedBy, "ada@x.io", "reviewer stamped from the session");
  assert.equal(d.decisionVersion, 1, "decision bound to version 1");

  // Replacing the deliverable bumps the version and re-opens the review.
  const upd = await req(`/proofs/${created.id}`, { method: "PUT", body: { name: "Flyer", deliverable: { kind: "image", url: "https://cdn.example/flyer-v2.png" }, annotations: [] } });
  const u = (await upd.json()) as { version: number; decision: string; decidedBy: string | null };
  assert.equal(u.version, 2, "new deliverable bumps the version");
  assert.equal(u.decision, "pending", "the decision re-opens on a new version");
  assert.equal(u.decidedBy, null);

  // An invalid decision value is refused.
  assert.equal((await req(`/proofs/${created.id}/decision`, { method: "POST", body: { decision: "meh" } })).status, 400);
});

test("update then delete round-trips through the sealed store", async () => {
  const created = (await (await req("/proofs", { method: "POST", body: { name: "Temp", deliverable: DELIVERABLE, annotations: [] } })).json()) as { id: string };
  const upd = await req(`/proofs/${created.id}`, { method: "PUT", body: { name: "Temp v2", deliverable: DELIVERABLE, annotations: [{ id: "p1", type: "pin", x: 0.2, y: 0.2 }] } });
  assert.equal(upd.status, 200);
  assert.equal(((await upd.json()) as { annotations: unknown[] }).annotations.length, 1);
  assert.equal((await req(`/proofs/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/proofs/${created.id}`)).status, 404);
});

test("user areas are isolated: one user cannot read another's private proof", async () => {
  const alice = cookie({ sub: "alice", email: "alice@x.io", roles: ["omni-admins"] });
  const bob = cookie({ sub: "bob", email: "bob@x.io", roles: ["omni-admins"] });
  const created = (await (await req("/proofs", { cookie: alice, method: "POST", body: { name: "Alice private", deliverable: DELIVERABLE, annotations: [] } })).json()) as { id: string };
  assert.equal((await req(`/proofs/${created.id}`, { cookie: bob })).status, 404, "bob cannot read alice's user proof");
  assert.equal((await req(`/proofs/${created.id}`, { cookie: alice })).status, 200, "alice still can");
});

test("org target: a manager writes org-wide, a contributor is refused the org write but can read + list", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], mgr: process.env["OIDC_MANAGER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const manager = cookie({ sub: "m1", email: "em@x.io", roles: ["omni-managers"] });
    const contributor = cookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    const ok = await req("/proofs", { cookie: manager, method: "POST", body: { name: "Org proof", storage: "org", deliverable: DELIVERABLE, annotations: [] } });
    assert.equal(ok.status, 201, "manager can create an org proof");
    const orgId = ((await ok.json()) as { id: string }).id;
    assert.match(orgId, /^org~/);
    assert.equal((await req(`/proofs/${orgId}`, { cookie: contributor })).status, 200, "contributor reads the org proof");
    assert.equal((await req("/proofs", { cookie: contributor, method: "POST", body: { name: "No", storage: "org", deliverable: DELIVERABLE, annotations: [] } })).status, 403, "contributor cannot write org-wide");
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
    assert.equal((await req("/proofs", { cookie: viewer })).status, 200, "viewer can list");
    assert.equal((await req("/proofs", { cookie: viewer, method: "POST", body: { name: "No", deliverable: DELIVERABLE, annotations: [] } })).status, 403, "viewer cannot author");
    const contributor = cookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    assert.equal((await req("/proofs", { cookie: contributor, method: "POST", body: { name: "Yes", deliverable: DELIVERABLE, annotations: [] } })).status, 201, "contributor can author");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.view], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
