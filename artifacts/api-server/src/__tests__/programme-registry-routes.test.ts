import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the programme registry slice (programmeId → { name, instanceIds }). Read-open to
 * any authenticated session; writes are gated to the PMO/admin authorities (under the harness's demo
 * auth every session clears that, so the reachable branches are 200 / 400).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ programmeRegistry: {} });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /programme-registry defaults to {}", async () => {
  const r = await h.req("/programme-registry", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).programmeRegistry, {});
});

test("a well-formed registry is saved and normalised (name defaults to id, GUIDs deduped)", async () => {
  const body = { programmeRegistry: { "prog-a": { name: "Apollo", instanceIds: ["g1", "g1", "g2"] }, "prog-b": { instanceIds: ["g3"] } } };
  const r = await h.req("/programme-registry", { method: "PUT", cookie: adminCookie(), body });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).programmeRegistry, {
    "prog-a": { name: "Apollo", instanceIds: ["g1", "g2"] },
    "prog-b": { name: "prog-b", instanceIds: ["g3"] },
  });
});

test("a bad shape is rejected → 400", async () => {
  const r = await h.req("/programme-registry", { method: "PUT", cookie: adminCookie(), body: { programmeRegistry: { p: { name: "x" } } } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /instanceIds/);
});

test("programme registry drives /programmes membership by GUID", async () => {
  // Create a project (it gets an omniInstanceId), then group it under a programme by that GUID.
  const created = await h.req("/projects", { method: "POST", cookie: adminCookie(), body: { name: "Apollo build" } });
  assert.equal(created.status, 201);
  const guid = ((await json(created)) as { omniInstanceId: string }).omniInstanceId;
  await h.req("/programme-registry", { method: "PUT", cookie: adminCookie(), body: { programmeRegistry: { "prog-a": { name: "Apollo", instanceIds: [guid] } } } });

  const progs = (await json(await h.req("/programmes", { cookie: adminCookie() }))) as Array<{ id: string; name: string; projectCount: number }>;
  const apollo = progs.find((p) => p.id === "prog-a");
  assert.ok(apollo, "the programme surfaces once a project GUID is in its list");
  assert.equal(apollo!.name, "Apollo");
});
