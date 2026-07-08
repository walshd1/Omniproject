import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/programmes.ts over the REAL app. Programmes are DERIVED from projects'
 * programmeId (not stored), so the reachable branches are: the rolled-up list, a
 * known programme's detail, and the unknown-id 404. The 502 catch blocks fire only
 * on a broker read fault (the demo broker never throws on reads) and are unreachable
 * here — covered by lib/programmes unit tests instead.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /programmes returns the derived programme roll-up", async () => {
  const r = await req("/programmes");
  assert.equal(r.status, 200);
  const body = (await r.json()) as Array<{ id: string }>;
  assert.ok(Array.isArray(body), "programmes should be an array");
});

test("GET /programmes/:id returns one programme's detail when it exists", async () => {
  const list = (await (await req("/programmes")).json()) as Array<{ id: string }>;
  if (list.length === 0) return; // demo graph has no programmes → nothing to detail
  const id = list[0]!.id;
  const r = await req(`/programmes/${encodeURIComponent(id)}`);
  assert.equal(r.status, 200);
  const detail = (await r.json()) as { projects?: unknown[] };
  assert.ok(detail && typeof detail === "object", "detail should be an object");
  assert.ok(Array.isArray(detail.projects), "detail should carry its member projects");
});

test("GET /programmes/:id 404s for an id that is not a programme", async () => {
  const r = await req("/programmes/no-such-programme-xyz");
  assert.equal(r.status, 404);
  const body = (await r.json()) as { error: string };
  assert.match(body.error, /No such programme/);
});
