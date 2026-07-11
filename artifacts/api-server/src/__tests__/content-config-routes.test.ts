import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the three near-identical customer-config routes that persist a validated
 * slice of settings: content pages, built-in report overrides, and portfolio priority weights.
 * Each is READ-open to any authenticated user and PUT-gated to the `pmo` authority, returning a
 * 400 when updateSettings rejects the shape (SettingsValidationError). Under demo auth every
 * session clears the pmo gate, so the reachable branches here are: no cookie → 401, valid PUT →
 * 200 round-trip, invalid PUT → 400.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

afterEach(async () => {
  const { updateSettings, DEFAULT_PRIORITY_WEIGHTS } = await import("../lib/settings");
  updateSettings({ contentPages: [], reportOverrides: [], priorityWeights: { ...DEFAULT_PRIORITY_WEIGHTS } });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

// ── content pages ────────────────────────────────────────────────────────────
test("GET /content-pages: readable by any authenticated user; defaults to []", async () => {
  const r = await h.req("/content-pages", { cookie: memberCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).contentPages, []);
});

test("PUT /content-pages: no cookie → 401", async () => {
  const r = await h.req("/content-pages", { method: "PUT", body: { contentPages: [] } });
  assert.equal(r.status, 401);
});

test("PUT /content-pages: a valid page round-trips (200)", async () => {
  const page = { id: "p1", name: "Ops overview", componentIds: ["report.portfolio-health"] };
  const r = await h.req("/content-pages", { method: "PUT", cookie: adminCookie(), body: { contentPages: [page] } });
  assert.equal(r.status, 200);
  const saved = (await json(r)).contentPages;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, "p1");
  // GET now reflects the write.
  const back = await json(await h.req("/content-pages", { cookie: memberCookie() }));
  assert.equal(back.contentPages[0].name, "Ops overview");
});

test("PUT /content-pages: an invalid shape → 400 from validation", async () => {
  const r = await h.req("/content-pages", { method: "PUT", cookie: adminCookie(), body: { contentPages: [{ id: "p1" }] } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /content page/i);
});

// ── report overrides ─────────────────────────────────────────────────────────
test("GET /reports/overrides: defaults to []", async () => {
  const r = await h.req("/reports/overrides", { cookie: memberCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).reportOverrides, []);
});

test("PUT /reports/overrides: no cookie → 401", async () => {
  const r = await h.req("/reports/overrides", { method: "PUT", body: { reportOverrides: [] } });
  assert.equal(r.status, 401);
});

test("PUT /reports/overrides: a valid override round-trips (200)", async () => {
  const ov = { id: "evm", label: "Earned Value", order: 2, hidden: true };
  const r = await h.req("/reports/overrides", { method: "PUT", cookie: adminCookie(), body: { reportOverrides: [ov] } });
  assert.equal(r.status, 200);
  const saved = (await json(r)).reportOverrides;
  assert.equal(saved[0].label, "Earned Value");
  assert.equal(saved[0].hidden, true);
});

test("PUT /reports/overrides: a non-array → 400", async () => {
  const r = await h.req("/reports/overrides", { method: "PUT", cookie: adminCookie(), body: { reportOverrides: "nope" } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /reportOverrides must be an array/i);
});

test("PUT /reports/overrides: an entry with no id → 400", async () => {
  const r = await h.req("/reports/overrides", { method: "PUT", cookie: adminCookie(), body: { reportOverrides: [{ label: "x" }] } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /string id/i);
});

// ── portfolio priority weights ───────────────────────────────────────────────
test("GET /portfolio/priority-weights: returns the defaults when unset", async () => {
  const r = await h.req("/portfolio/priority-weights", { cookie: memberCookie() });
  assert.equal(r.status, 200);
  const w = (await json(r)).priorityWeights;
  assert.equal(typeof w.rice, "number");
});

test("PUT /portfolio/priority-weights: no cookie → 401", async () => {
  const r = await h.req("/portfolio/priority-weights", { method: "PUT", body: { priorityWeights: {} } });
  assert.equal(r.status, 401);
});

test("PUT /portfolio/priority-weights: valid weights round-trip (200)", async () => {
  const priorityWeights = { rice: 30, wsjf: 10, moscow: 20, strategic: 20, benefit: 20 };
  const r = await h.req("/portfolio/priority-weights", { method: "PUT", cookie: adminCookie(), body: { priorityWeights } });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).priorityWeights.rice, 30);
});

test("PUT /portfolio/priority-weights: a negative weight → 400", async () => {
  const priorityWeights = { rice: -1, wsjf: 10, moscow: 20, strategic: 20, benefit: 20 };
  const r = await h.req("/portfolio/priority-weights", { method: "PUT", cookie: adminCookie(), body: { priorityWeights } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /non-negative number/i);
});
