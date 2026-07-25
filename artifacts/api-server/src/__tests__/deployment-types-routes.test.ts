import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/deployment-types.ts over the REAL app — the on-ramp archetype catalogue + answer resolver, plus the
 * org's ONE active deployment type (admin-gated) with a change function. The active type persists via the
 * sealed config store, so enable it.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-types-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

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

test("the org's active deployment type: unset → null, then PUT sets it (admin), and CHANGE replaces it", async () => {
  // Unset.
  assert.equal((await json(await h.req("/deployment-type", { cookie: adminCookie() }))).deploymentType, null);

  // Set to solo-selfhost, overriding the broker (a pickable setting).
  const put = await h.req("/deployment-type", {
    method: "PUT", cookie: adminCookie(),
    body: { deploymentType: "solo-selfhost", overrides: { broker: "builtin:postgres", auth: "none" } },
  });
  assert.equal(put.status, 200);
  const set = await json(put);
  assert.equal(set.deploymentType, "solo-selfhost");
  assert.equal(set.setup.broker, "builtin:postgres");   // pickable override accepted
  assert.deepEqual(set.rejectedOverrides, ["auth"]);     // non-pickable override rejected
  assert.ok(set.settings.some((s: { key: string }) => s.key === "storage"));

  // The active type persists + resolves.
  const got = await json(await h.req("/deployment-type", { cookie: adminCookie() }));
  assert.equal(got.deploymentType, "solo-selfhost");
  assert.equal(got.setup.broker, "builtin:postgres");

  // CHANGE to a different type — one per org, so it replaces.
  const change = await json(await h.req("/deployment-type", { method: "PUT", cookie: adminCookie(), body: { deploymentType: "enterprise-onprem" } }));
  assert.equal(change.deploymentType, "enterprise-onprem");
  assert.equal((await json(await h.req("/deployment-type", { cookie: adminCookie() }))).deploymentType, "enterprise-onprem");
});

test("PUT /deployment-type rejects an unknown type (400) and requires admin (401)", async () => {
  assert.equal((await h.req("/deployment-type", { method: "PUT", cookie: adminCookie(), body: { deploymentType: "nope" } })).status, 400);
  assert.equal((await h.req("/deployment-type", { method: "PUT", body: { deploymentType: "solo-selfhost" } })).status, 401);
});
