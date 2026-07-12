import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the GUID translation table (oldGuid → newGuid) and the "forget project" delete.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ guidAliases: {}, closedProjects: {}, programmeRegistry: {}, retiredGuids: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /guid-aliases defaults to {} and PUT saves a relink", async () => {
  const g = await h.req("/guid-aliases", { cookie: adminCookie() });
  assert.deepEqual((await json(g)).guidAliases, {});
  const r = await h.req("/guid-aliases", { method: "PUT", cookie: adminCookie(), body: { guidAliases: { old: "new" } } });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).guidAliases, { old: "new" });
});

test("a cyclic alias table is rejected → 400", async () => {
  const r = await h.req("/guid-aliases", { method: "PUT", cookie: adminCookie(), body: { guidAliases: { a: "b", b: "a" } } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /cycle/);
});

test("DELETE /projects/:guid/links forgets the GUID from every list", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({
    closedProjects: { "g1": { disposition: "archive" } },
    programmeRegistry: { "prog-a": { name: "Alpha", instanceIds: ["g1"] } },
  });
  const r = await h.req("/projects/g1/links", { method: "DELETE", cookie: adminCookie() });
  assert.equal(r.status, 200);
  const body = await json(r);
  assert.equal(body.removedFromClosed, true);
  assert.deepEqual(body.removedFromProgrammes, ["prog-a"]);
  assert.equal(body.retired, true); // tombstoned
  // And it's actually gone.
  const closed = await json(await h.req("/closed-projects", { cookie: adminCookie() }));
  assert.equal("g1" in closed.closedProjects, false);
});

test("GET /projects/:guid/references exports what OmniProject holds (for export before delete)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ closedProjects: { "g9": { disposition: "sor", source: "jira" } }, programmeRegistry: { "prog-x": { name: "X", instanceIds: ["g9"] } } });
  const r = await h.req("/projects/g9/references", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  const refs = await json(r);
  assert.equal(refs.guid, "g9");
  assert.deepEqual(refs.closed, { disposition: "sor", source: "jira" });
  assert.deepEqual(refs.programmes, ["prog-x"]);
});
