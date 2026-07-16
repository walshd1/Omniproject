import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR; // enable the encrypted-JSON artifact store for the JSON targets
import { startHarness, adminCookie, cookie, type Harness } from "./_harness";

/**
 * routes/wiki.ts over the REAL app. A page saves to a STORAGE TARGET the author picks: their private area
 * (default), the org-wide area, a project area, or the sidecar (the demo broker here). The JSON areas are
 * AES-256-GCM sealed under OMNI_CONFIG_DIR; ids are self-describing so a read routes to the right store.
 * These tests exercise the sidecar path (demo seed docs, ids prefixed `sidecar~`), the JSON CRUD + version
 * ring, user isolation, org gating, and the RBAC floor.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

test("wiki: sidecar docs are listed with self-describing ids; bodies omitted in the list", async () => {
  const spaces = (await (await req("/wiki/spaces")).json()) as Array<{ id: string }>;
  assert.ok(spaces.some((s) => s.id === "space-pmo"), "broker spaces surface");
  assert.ok(spaces.some((s) => s.id === "general"), "a General fallback space always exists");
  const docs = (await (await req("/wiki/docs?spaceId=space-pmo")).json()) as Array<{ id: string; blocks: unknown[] }>;
  const onboarding = docs.find((d) => d.id === "sidecar~doc-onboarding");
  assert.ok(onboarding, "a sidecar doc carries a self-describing sidecar id");
  assert.equal(onboarding!.blocks.length, 0, "list omits block bodies");
});

test("wiki: get a sidecar doc returns blocks + server-resolved backlinks across the corpus", async () => {
  const doc = (await (await req("/wiki/docs/sidecar~doc-standards")).json()) as { blocks: unknown[]; backlinks: Array<{ id: string }> };
  assert.ok(doc.blocks.length > 0);
  assert.ok(doc.backlinks.some((b) => b.id === "sidecar~doc-onboarding"), "onboarding backlinks to standards");
});

test("wiki: create defaults to the private user area (self-describing id, sealed at rest)", async () => {
  const created = (await (await req("/wiki/docs", { method: "POST", body: { spaceId: "general", title: "My notes", blocks: [] } })).json()) as { id: string };
  assert.match(created.id, /^user~/, "default target is the private user area");
  assert.equal((await (await req(`/wiki/docs/${created.id}`)).json() as { title: string }).title, "My notes");
  // Sealed at rest: the title is not plaintext on disk.
  const file = path.join(CONFIG_DIR, "artifacts", "wiki-doc", "user-u-harness.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("My notes"), "the title must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");
});

test("wiki: create a doc sanitises blocks (bad embed scheme → 400; smuggled field dropped)", async () => {
  const bad = await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Bad", blocks: [{ id: "b1", type: "embed", url: "javascript:alert(1)" }] } });
  assert.equal(bad.status, 400);

  const r = await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Runbook", blocks: [
    { id: "b1", type: "heading", level: 9, text: "Runbook", extra: "smuggle" },
    { id: "b2", type: "paragraph", text: "steps here" },
  ] } });
  assert.equal(r.status, 201);
  const created = (await r.json()) as { slug: string; blocks: Array<Record<string, unknown>> };
  assert.equal(created.slug, "runbook");
  assert.equal(created.blocks[0]!["level"], 2, "invalid heading level normalised");
  assert.equal(created.blocks[0]!["extra"], undefined, "smuggled field dropped");
});

test("wiki: update then delete a JSON doc", async () => {
  const created = (await (await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Temp", blocks: [] } })).json()) as { id: string };
  const upd = await req(`/wiki/docs/${created.id}`, { method: "PUT", body: { spaceId: "space-eng", title: "Temp v2", blocks: [{ id: "b1", type: "paragraph", text: "now with content" }] } });
  assert.equal(upd.status, 200);
  const updated = (await upd.json()) as { title: string; blocks: unknown[] };
  assert.equal(updated.title, "Temp v2");
  assert.equal(updated.blocks.length, 1);
  assert.equal((await req(`/wiki/docs/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/wiki/docs/${created.id}`)).status, 404);
});

test("wiki: a JSON doc retains a revision per write and serves the pre-edit body for restore", async () => {
  const created = (await (await req("/wiki/docs", { method: "POST", body: { spaceId: "general", title: "Versioned", blocks: [{ id: "b1", type: "paragraph", text: "v1" }] } })).json()) as { id: string };
  const one = (await (await req(`/wiki/docs/${created.id}/versions`)).json()) as Array<{ versionId: string; title: string }>;
  assert.equal(one.length, 1, "create captured a baseline revision");

  await req(`/wiki/docs/${created.id}`, { method: "PUT", body: { spaceId: "general", title: "Versioned v2", blocks: [{ id: "b1", type: "paragraph", text: "v2" }] } });
  const list = (await (await req(`/wiki/docs/${created.id}/versions`)).json()) as Array<{ versionId: string; title: string }>;
  assert.equal(list.length, 2, "update appended a revision");
  assert.equal(list[0]!.title, "Versioned v2", "newest revision is first");

  const oldest = list[list.length - 1]!;
  const full = (await (await req(`/wiki/docs/${created.id}/versions/${oldest.versionId}`)).json()) as { blocks: Array<{ text: string }> };
  assert.equal(full.blocks[0]!.text, "v1", "the oldest revision carries the pre-edit content");
  assert.equal((await req(`/wiki/docs/${created.id}/versions/nope`)).status, 404, "unknown revision → 404");
});

test("wiki: sidecar version history still works via the self-describing id", async () => {
  const list = (await (await req("/wiki/docs/sidecar~doc-standards/versions")).json()) as Array<{ versionId: string }>;
  assert.ok(list.length >= 1, "the sidecar retains history");
  const full = await req(`/wiki/docs/sidecar~doc-standards/versions/${list[0]!.versionId}`);
  assert.equal(full.status, 200);
});

test("wiki: user areas are isolated — one user cannot read another's private doc", async () => {
  const alice = cookie({ sub: "alice", name: "Alice", email: "alice@x.io", roles: ["omni-admins"] });
  const bob = cookie({ sub: "bob", name: "Bob", email: "bob@x.io", roles: ["omni-admins"] });
  const created = (await (await h.req("/wiki/docs", { cookie: alice, method: "POST", body: { spaceId: "general", title: "Alice private", blocks: [] } })).json()) as { id: string };
  assert.equal((await h.req(`/wiki/docs/${created.id}`, { cookie: bob })).status, 404, "bob cannot read alice's user doc");
  assert.equal((await h.req(`/wiki/docs/${created.id}`, { cookie: alice })).status, 200, "alice still can");
});

test("wiki: org target — a manager writes org-wide, a contributor is refused the org write but can read", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], mgr: process.env["OIDC_MANAGER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const manager = cookie({ sub: "m1", name: "Em", email: "em@x.io", roles: ["omni-managers"] });
    const contributor = cookie({ sub: "c1", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
    const ok = await h.req("/wiki/docs", { cookie: manager, method: "POST", body: { spaceId: "general", title: "Org doc", storage: "org", blocks: [] } });
    assert.equal(ok.status, 201, "manager can create an org doc");
    const orgId = ((await ok.json()) as { id: string }).id;
    assert.match(orgId, /^org~/);
    assert.equal((await h.req(`/wiki/docs/${orgId}`, { cookie: contributor })).status, 200, "contributor reads the org doc");
    assert.equal((await h.req("/wiki/docs", { cookie: contributor, method: "POST", body: { spaceId: "general", title: "No", storage: "org", blocks: [] } })).status, 403, "contributor cannot write org-wide");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_MANAGER_ROLES", prev.mgr], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("wiki: RBAC floor — a viewer can read but not author; a contributor can", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const viewer = cookie({ sub: "v1", name: "Vee", email: "vee@x.io", roles: ["omni-viewers"] });
    assert.equal((await h.req("/wiki/spaces", { cookie: viewer })).status, 200, "viewer can read");
    assert.equal((await h.req("/wiki/docs", { cookie: viewer, method: "POST", body: { spaceId: "general", title: "Nope", blocks: [] } })).status, 403, "viewer cannot author");
    const contributor = cookie({ sub: "c1", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
    assert.equal((await h.req("/wiki/docs", { cookie: contributor, method: "POST", body: { spaceId: "general", title: "By contributor", blocks: [] } })).status, 201, "contributor can author");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.view], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
