import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/disabled-screens.ts over the REAL app. The OFF switch for screens: a list of screen ids an admin
 * or PMO turned off. READ open (the SPA needs it to hide them); WRITE gated to admin OR pmo.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ disabledScreens: [] });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /disabled-screens returns the (empty by default) list", async () => {
  const r = await req("/disabled-screens");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { disabledScreens: unknown[] };
  assert.deepEqual(body.disabledScreens, []);
});

test("PUT /disabled-screens turns a screen off and reads it back", async () => {
  const r = await req("/disabled-screens", { method: "PUT", body: { disabledScreens: ["kanban"] } });
  assert.equal(r.status, 200);
  const saved = (await r.json()) as { disabledScreens: string[] };
  assert.deepEqual(saved.disabledScreens, ["kanban"]);
});

test("write is gated to admin OR pmo (reads stay open) under real RBAC", async () => {
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const write = await h.req("/disabled-screens", { cookie: memberCookie(), method: "PUT", body: { disabledScreens: [] } });
    assert.equal(write.status, 403); // a plain member is neither admin nor pmo
    const read = await h.req("/disabled-screens", { cookie: memberCookie() });
    assert.equal(read.status, 200);
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
