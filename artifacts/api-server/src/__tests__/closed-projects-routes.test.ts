import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the closed-project location registry (projectGuid → { disposition, … }). Read-open
 * to any authenticated session; writes gated to PMO/admin (the harness's demo admin clears that, so the
 * reachable branches are 200 / 400).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ closedProjects: {}, retiredGuids: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /closed-projects defaults to {}", async () => {
  const r = await h.req("/closed-projects", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).closedProjects, {});
});

test("a well-formed registry is saved and normalised", async () => {
  const body = { closedProjects: { "guid-1": { disposition: "archive", note: " moved " }, "guid-2": { disposition: "sor", source: "jira" } } };
  const r = await h.req("/closed-projects", { method: "PUT", cookie: adminCookie(), body });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).closedProjects, {
    "guid-1": { disposition: "archive", note: "moved" },
    "guid-2": { disposition: "sor", source: "jira" },
  });
});

test("a bad disposition is rejected → 400", async () => {
  const r = await h.req("/closed-projects", { method: "PUT", cookie: adminCookie(), body: { closedProjects: { g: { disposition: "somewhere" } } } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /disposition of sor or archive/);
});

test("POST /projects/:guid/close records the disposition and stickily retires the GUID", async () => {
  const close = await h.req("/projects/guid-close-1/close", { method: "POST", cookie: adminCookie(), body: { disposition: "archive", source: "jira", note: "Q3 decommission" } });
  assert.equal(close.status, 200);
  const rec = await json(close);
  assert.equal(rec.disposition, "archive");
  assert.equal(rec.source, "jira");
  assert.match(rec.closedAt, /^\d{4}-\d{2}-\d{2}T/);

  // The closed-project index now carries it…
  const reg = await json(await h.req("/closed-projects", { cookie: adminCookie() }));
  assert.equal(reg.closedProjects["guid-close-1"].disposition, "archive");
  // …and closing retired the GUID (sticky — no silent reactivation).
  const settings = await import("../lib/settings");
  assert.ok(settings.getSettings().retiredGuids.includes("guid-close-1"));
});

test("POST /projects/:guid/close rejects a bad disposition → 400", async () => {
  const r = await h.req("/projects/guid-x/close", { method: "POST", cookie: adminCookie(), body: { disposition: "nowhere" } });
  assert.equal(r.status, 400);
});

test("closing with the archive disposition captures a snapshot readable from the archive", async () => {
  const { __setArchiveStoreForTest, MemoryArchiveStore } = await import("../lib/archive/archive-store");
  __setArchiveStoreForTest(new MemoryArchiveStore());
  try {
    // A freshly-created project carries an omniInstanceId (the correlation GUID) to close by.
    const created = await json(await h.req("/projects", { method: "POST", cookie: adminCookie(), body: { name: "To archive" } }));
    const guid = created.omniInstanceId as string;
    assert.ok(guid, "created project has a correlation GUID");

    const close = await h.req(`/projects/${encodeURIComponent(guid)}/close`, { method: "POST", cookie: adminCookie(), body: { disposition: "archive", note: "decommissioned" } });
    assert.equal(close.status, 200);

    // The archive index + snapshot now hold it.
    const index = await json(await h.req("/archive/projects", { cookie: adminCookie() }));
    assert.ok(index.some((e: { guid: string }) => e.guid === guid));
    const snap = await json(await h.req(`/archive/projects/${encodeURIComponent(guid)}`, { cookie: adminCookie() }));
    assert.equal(snap.project.name, "To archive");
    assert.ok(Array.isArray(snap.issues));
    // OmniProject's own settings/references for the project are archived alongside its data.
    assert.equal(snap.settings.guid, guid);
    assert.ok(Array.isArray(snap.settings.programmes));
  } finally {
    __setArchiveStoreForTest(null);
  }
});
