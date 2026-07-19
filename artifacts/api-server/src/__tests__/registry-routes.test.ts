import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/registry.ts over the REAL app (org-wide store of approved bespoke items), behind the default-off
 * `registry` module. Flow: submit (contributor+) → review approve/reject (admin) → optionally release to the
 * community (admin; the community-marketplace seam is a no-op until a real online marketplace connects).
 * Read is viewer+, but a non-admin sees only APPROVED items + their OWN submissions. Items are pure JSON.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "registry,defImporter";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "registry-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

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

const SUBMIT = {
  kind: "report", name: "Burn rate", publisher: "Acme", version: "2.1.0",
  description: "A curated burn-rate report", tags: ["finance", "kpi"],
  payload: { id: "burn-rate", engine: "custom" },
};

test("submit → review → release → retract lifecycle, sealed at rest", async () => {
  const submitted = await req("/registry", { method: "POST", body: SUBMIT, cookie: CONTRIBUTOR });
  assert.equal(submitted.status, 201);
  const item = (await submitted.json()) as { id: string; approvalStatus: string; visibility: string; submittedBy: string };
  assert.equal(item.approvalStatus, "draft");
  assert.equal(item.visibility, "internal");
  assert.equal(item.submittedBy, "cee@x.io");

  // sealed at rest: the payload id must not appear in plaintext on disk.
  const file = path.join(CONFIG_DIR, "artifacts", "registry-item", "org.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("burn-rate"), "payload must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");

  // list projection omits the payload.
  const metas = (await req("/registry").then((x) => x.json())) as Array<{ id: string; payload?: unknown }>;
  const meta = metas.find((m) => m.id === item.id)!;
  assert.equal((meta as { payload?: unknown }).payload, undefined, "list omits payload");

  // release before approval is 409.
  assert.equal((await req(`/registry/${item.id}/release`, { method: "POST" })).status, 409);

  // approve (admin).
  const reviewed = await req(`/registry/${item.id}/review`, { method: "POST", body: { decision: "approved", note: "ok" } });
  assert.equal(reviewed.status, 200);
  assert.equal(((await reviewed.json()) as { approvalStatus: string }).approvalStatus, "approved");

  // release to the community — no marketplace connected, so published:false but the item is community locally.
  const released = await req(`/registry/${item.id}/release`, { method: "POST" });
  assert.equal(released.status, 200);
  const rel = (await released.json()) as { item: { visibility: string; releasedAt: string }; published: boolean; reason?: string };
  assert.equal(rel.item.visibility, "community");
  assert.equal(rel.published, false);
  assert.match(rel.reason ?? "", /no community marketplace is connected/);

  // retract back to internal.
  const retracted = await req(`/registry/${item.id}/retract`, { method: "POST" });
  assert.equal(((await retracted.json()) as { visibility: string }).visibility, "internal");
});

test("community status reports no connected marketplace", async () => {
  const status = (await req("/registry/community/status").then((x) => x.json())) as { connected: boolean; name: string | null };
  assert.equal(status.connected, false);
  assert.equal(status.name, null);
});

test("a bad submission is 400", async () => {
  assert.equal((await req("/registry", { method: "POST", body: { kind: "report", name: "x" } })).status, 400);
});

test("visibility: a viewer sees approved items but not another user's draft", async () => {
  // A fresh draft by the contributor.
  const draft = await (await req("/registry", { method: "POST", body: { ...SUBMIT, name: "Secret draft" }, cookie: CONTRIBUTOR })).json() as { id: string };
  // An approved item.
  const pub = await (await req("/registry", { method: "POST", body: { ...SUBMIT, name: "Public one" }, cookie: CONTRIBUTOR })).json() as { id: string };
  await req(`/registry/${pub.id}/review`, { method: "POST", body: { decision: "approved" } });

  const prev = { iss: process.env["OIDC_ISSUER_URL"], v: process.env["OIDC_VIEWER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  try {
    const seen = (await req("/registry", { cookie: VIEWER }).then((x) => x.json())) as Array<{ id: string }>;
    const ids = seen.map((m) => m.id);
    assert.ok(ids.includes(pub.id), "viewer sees the approved item");
    assert.ok(!ids.includes(draft.id), "viewer does not see another user's draft");
    // Direct GET of another user's draft is 404 for the viewer.
    assert.equal((await req(`/registry/${draft.id}`, { cookie: VIEWER })).status, 404);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.v]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});

test("org PRIMITIVE authoring: submit is safety-checked, approve ACTIVATES it as an org def, reject removes it", async () => {
  // A well-formed org primitive that EXTENDS a shipped one (a scoped tile) — safety-checked at submit.
  const good = { kind: "primitive", name: "Acme tile", publisher: "Acme", version: "1.0.0",
    payload: { id: "acme-tile", label: "Acme tile", category: "tile", description: "an org tile", extends: "tile", params: [] } };
  const draft = await req("/registry", { method: "POST", body: good, cookie: CONTRIBUTOR });
  assert.equal(draft.status, 201);
  const item = (await draft.json()) as { id: string };

  // Malformed / unsafe primitive submissions are refused up front (never enter the queue).
  assert.equal((await req("/registry", { method: "POST", body: { ...good, name: "Bad shape", payload: { id: "Bad Id", category: "nope" } }, cookie: CONTRIBUTOR })).status, 400);
  assert.equal((await req("/registry", { method: "POST", body: { ...good, name: "Injected", payload: { id: "x-inj", label: "<script>", category: "tile", description: "d", extends: "tile", params: [] } }, cookie: CONTRIBUTOR })).status, 400);
  // A ROOTLESS primitive (no extends) is refused — a customer primitive must sit BELOW a system primitive.
  assert.equal((await req("/registry", { method: "POST", body: { ...good, name: "New root", payload: { id: "x-root", label: "X root", category: "chart", description: "d", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "d" }] } }, cookie: CONTRIBUTOR })).status, 400);

  // Before approval, the primitive does NOT resolve (it's inactive).
  const before = (await req("/defs/resolved/primitive").then((x) => x.json())) as Array<{ payload: { id: string } }>;
  assert.ok(!before.some((d) => d.payload.id === "acme-tile"), "an un-approved primitive is not live");

  // A direct import bypass stays blocked — the ONLY activation path is approval.
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "org", name: "x", payload: good.payload } })).status, 403);

  // Admin approves → the primitive is ACTIVATED into the org def scope and now resolves.
  assert.equal((await req(`/registry/${item.id}/review`, { method: "POST", body: { decision: "approved" } })).status, 200);
  const live = (await req("/defs/resolved/primitive").then((x) => x.json())) as Array<{ id: string; kind: string; createdBy: string | null; payload: { id: string; extends?: string } }>;
  const activated = live.find((d) => d.payload.id === "acme-tile");
  assert.ok(activated, "an approved primitive is live in the org scope");
  assert.equal(activated!.kind, "primitive");
  assert.equal(activated!.payload.extends, "tile");
  // DOWNWARD-ONLY: it is activated at the ORG (customer) level, never above — its def id is org-scoped, so the
  // shadow only flows DOWN (org → programme → project → user); it never mutates the system primitive above it.
  assert.match(activated!.id, /^org~/, "the org primitive lives at the org scope, not above");

  // Rejecting it removes the activated def again.
  assert.equal((await req(`/registry/${item.id}/review`, { method: "POST", body: { decision: "rejected" } })).status, 200);
  const after = (await req("/defs/resolved/primitive").then((x) => x.json())) as Array<{ payload: { id: string } }>;
  assert.ok(!after.some((d) => d.payload.id === "acme-tile"), "a rejected primitive stops resolving");
});

test("RBAC: a viewer can't submit; a non-admin can't review or release", async () => {
  const draft = await (await req("/registry", { method: "POST", body: { ...SUBMIT, name: "For rbac" }, cookie: CONTRIBUTOR })).json() as { id: string };

  const prev = {
    iss: process.env["OIDC_ISSUER_URL"],
    v: process.env["OIDC_VIEWER_ROLES"],
    c: process.env["OIDC_CONTRIBUTOR_ROLES"],
  };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    assert.equal((await req("/registry", { method: "POST", body: SUBMIT, cookie: VIEWER })).status, 403, "viewer can't submit");
    assert.equal((await req(`/registry/${draft.id}/review`, { method: "POST", body: { decision: "approved" }, cookie: CONTRIBUTOR })).status, 403, "contributor can't review");
    assert.equal((await req(`/registry/${draft.id}/release`, { method: "POST", cookie: CONTRIBUTOR })).status, 403, "contributor can't release");
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.v], ["OIDC_CONTRIBUTOR_ROLES", prev.c]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});

test("a submitter can delete their own draft; a stranger cannot", async () => {
  const draft = await (await req("/registry", { method: "POST", body: { ...SUBMIT, name: "Deletable" }, cookie: CONTRIBUTOR })).json() as { id: string };

  const prev = { iss: process.env["OIDC_ISSUER_URL"], c: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    // A different contributor cannot delete someone else's draft.
    const other = cookie({ sub: "c2", name: "Dee", email: "dee@x.io", roles: ["omni-contributors"] });
    assert.equal((await req(`/registry/${draft.id}`, { method: "DELETE", cookie: other })).status, 403);
    // The submitter can.
    assert.equal((await req(`/registry/${draft.id}`, { method: "DELETE", cookie: CONTRIBUTOR })).status, 204);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});
