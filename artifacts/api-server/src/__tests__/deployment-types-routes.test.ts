import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/deployment-types.ts over the REAL app — the on-ramp archetype catalogue + answer resolver.
 * GET is the pickable list; POST /:id/resolve folds answers into the known-good setup.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /deployment-types lists the archetypes", async () => {
  const r = await h.req("/deployment-types", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const ids = (await json(r)).deploymentTypes.map((d: { id: string }) => d.id);
  assert.ok(ids.includes("solo-selfhost"));
  assert.ok(ids.includes("enterprise-onprem"));
});

test("GET /deployment-types/:id returns its questions; unknown → 404", async () => {
  const r = await h.req("/deployment-types/solo-selfhost", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const t = await json(r);
  assert.ok(Array.isArray(t.questions) && t.questions.length > 0);
  const miss = await h.req("/deployment-types/no-such", { cookie: adminCookie() });
  assert.equal(miss.status, 404);
});

test("POST /:id/resolve folds answers into the known-good setup", async () => {
  const r = await h.req("/deployment-types/solo-selfhost/resolve", {
    method: "POST", cookie: adminCookie(), body: { answers: { idp: "yes" } },
  });
  assert.equal(r.status, 200);
  const out = await json(r);
  assert.equal(out.setup.storage, "omnistore");
  assert.equal(out.setup.auth, "both");       // idp=yes refinement applied
  assert.equal(out.setup.methodology, "gtd");
});

test("GET without a cookie → 401 (requireAuth)", async () => {
  const r = await h.req("/deployment-types");
  assert.equal(r.status, 401);
});
