import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the provenance verification edge (routes/provenance.ts), all admin-gated.
 * The chain is an in-memory ring in lib/provenance; we seed it directly with `record()` so the
 * per-call lookup + content-verify branches (200 with entries, matching / non-matching content)
 * are reachable alongside the not-found (404) branches.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

afterEach(async () => {
  const { __resetProvenance } = await import("../lib/provenance");
  __resetProvenance();
});

async function seed(): Promise<void> {
  const { record } = await import("../lib/provenance");
  record({ callId: "call-1", hop: "invoke", action: "listProjects", actor: "u@test", content: { q: "projects" } });
  record({ callId: "call-1", hop: "result", action: "listProjects", actor: "u@test", content: { rows: 3 } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /provenance: no cookie → 401", async () => {
  const r = await h.req("/provenance");
  assert.equal(r.status, 401);
});

test("GET /provenance: recent chain + a live integrity verdict", async () => {
  await seed();
  const r = await h.req("/provenance", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.ok(b.entries.length >= 2);
  assert.equal(b.chain.ok, true);
  assert.equal(b.chain.length, b.entries.length);
});

test("GET /provenance/anchor: the signed/unsigned tip anchor", async () => {
  await seed();
  const r = await h.req("/provenance/anchor", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.equal(b.algorithm, "HMAC-SHA256/chain");
  assert.equal(typeof b.seq, "number");
});

test("GET /provenance/call/:callId: 200 for a known call, 404 for an unknown one", async () => {
  await seed();
  const ok = await h.req("/provenance/call/call-1", { cookie: adminCookie() });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).entries.length, 2);

  const missing = await h.req("/provenance/call/nope", { cookie: adminCookie() });
  assert.equal(missing.status, 404);
  assert.match((await json(missing)).error, /no provenance/i);
});

test("POST /provenance/call/:callId/verify: matching content is true, altered content is false", async () => {
  await seed();
  const good = await h.req("/provenance/call/call-1/verify", {
    method: "POST", cookie: adminCookie(), body: { hop: "invoke", content: { q: "projects" } },
  });
  assert.equal(good.status, 200);
  const gb = await json(good);
  assert.equal(gb.matches, true);
  assert.equal(typeof gb.seq, "number");
  assert.ok(gb.contentMac);

  const tampered = await h.req("/provenance/call/call-1/verify", {
    method: "POST", cookie: adminCookie(), body: { hop: "invoke", content: { q: "TAMPERED" } },
  });
  assert.equal(tampered.status, 200);
  assert.equal((await json(tampered)).matches, false);
});

test("POST /provenance/call/:callId/verify: an unknown hop → 404", async () => {
  await seed();
  const r = await h.req("/provenance/call/call-1/verify", {
    method: "POST", cookie: adminCookie(), body: { hop: "does-not-exist", content: {} },
  });
  assert.equal(r.status, 404);
  assert.match((await json(r)).error, /no such hop/i);
});
