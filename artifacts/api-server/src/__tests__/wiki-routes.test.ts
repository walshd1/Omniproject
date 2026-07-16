import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, cookie, type Harness } from "./_harness";

/**
 * routes/wiki.ts over the REAL app (demo broker). The knowledge base: read spaces/docs (viewer+), author a
 * document (contributor+) through the sanitising choke point, backlinks resolved server-side, delete
 * (manager+). Bodies live in the backend through the broker seam.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

test("wiki: list spaces and docs (bodies omitted in the list)", async () => {
  const spaces = (await (await req("/wiki/spaces")).json()) as Array<{ id: string }>;
  assert.ok(spaces.some((s) => s.id === "space-pmo"));
  const docs = (await (await req("/wiki/docs?spaceId=space-pmo")).json()) as Array<{ id: string; blocks: unknown[] }>;
  assert.ok(docs.some((d) => d.id === "doc-onboarding"));
  assert.equal(docs.find((d) => d.id === "doc-onboarding")!.blocks.length, 0, "list omits block bodies");
});

test("wiki: get one doc returns blocks + server-resolved backlinks", async () => {
  const doc = (await (await req("/wiki/docs/doc-standards")).json()) as { blocks: unknown[]; backlinks: Array<{ id: string }> };
  assert.ok(doc.blocks.length > 0);
  // The onboarding doc links to [[Delivery standards]], so it must be a backlink of doc-standards.
  assert.ok(doc.backlinks.some((b) => b.id === "doc-onboarding"), "onboarding backlinks to standards");
});

test("wiki: create a doc sanitises blocks (drops a bad embed scheme → 400)", async () => {
  const bad = await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Bad", blocks: [{ id: "b1", type: "embed", url: "javascript:alert(1)" }] } });
  assert.equal(bad.status, 400);

  const r = await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Runbook", blocks: [
    { id: "b1", type: "heading", level: 9, text: "Runbook", extra: "smuggle" },
    { id: "b2", type: "paragraph", text: "steps here" },
  ] } });
  assert.equal(r.status, 201);
  const created = (await r.json()) as { id: string; slug: string; blocks: Array<Record<string, unknown>> };
  assert.equal(created.slug, "runbook");
  assert.equal(created.blocks[0]!["level"], 2, "invalid heading level normalised");
  assert.equal(created.blocks[0]!["extra"], undefined, "smuggled field dropped");
});

test("wiki: update then delete a doc", async () => {
  const created = (await (await req("/wiki/docs", { method: "POST", body: { spaceId: "space-eng", title: "Temp", blocks: [] } })).json()) as { id: string };
  const upd = await req(`/wiki/docs/${created.id}`, { method: "PUT", body: { spaceId: "space-eng", title: "Temp v2", blocks: [{ id: "b1", type: "paragraph", text: "now with content" }] } });
  assert.equal(upd.status, 200);
  const updated = (await upd.json()) as { title: string; blocks: unknown[] };
  assert.equal(updated.title, "Temp v2");
  assert.equal(updated.blocks.length, 1);
  assert.equal((await req(`/wiki/docs/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/wiki/docs/${created.id}`)).status, 404);
});

test("wiki: RBAC — a viewer can read but not author; a contributor can author", async () => {
  // Leave demo mode so RBAC is real, and pin the group→role mapping so viewer/contributor resolve.
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const viewer = cookie({ sub: "v1", name: "Vee", email: "vee@x.io", roles: ["omni-viewers"] });
    assert.equal((await h.req("/wiki/spaces", { cookie: viewer })).status, 200, "viewer can read");
    const denied = await h.req("/wiki/docs", { cookie: viewer, method: "POST", body: { spaceId: "space-eng", title: "Nope", blocks: [] } });
    assert.equal(denied.status, 403, "viewer cannot author");

    const contributor = cookie({ sub: "c1", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
    const ok = await h.req("/wiki/docs", { cookie: contributor, method: "POST", body: { spaceId: "space-eng", title: "By contributor", blocks: [] } });
    assert.equal(ok.status, 201, "contributor can author");
  } finally {
    process.env["OIDC_ISSUER_URL"] = prev.iss ?? "";
    if (prev.iss === undefined) delete process.env["OIDC_ISSUER_URL"];
    if (prev.view === undefined) delete process.env["OIDC_VIEWER_ROLES"]; else process.env["OIDC_VIEWER_ROLES"] = prev.view;
    if (prev.contrib === undefined) delete process.env["OIDC_CONTRIBUTOR_ROLES"]; else process.env["OIDC_CONTRIBUTOR_ROLES"] = prev.contrib;
  }
});
