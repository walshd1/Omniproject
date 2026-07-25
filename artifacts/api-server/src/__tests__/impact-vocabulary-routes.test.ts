import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the scope-overridable RAID/risk IMPACT vocabulary AND the relaxed RAID write-gate:
 *  - GET  /api/impact-vocabulary — the resolved grades for the caller's scope (any authed user).
 *  - PUT  /api/impact-vocabulary — write the org-scope override (admin/PMO), through the validated def path.
 *  - POST /api/projects/:id/raid accepts a scope-ADDED impact (the frozen enum gate is relaxed) but 400s garbage.
 */

process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "impact-vocab-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /impact-vocabulary returns the shipped 3 RAID impact grades before anything is authored", async () => {
  const r = await h.req("/impact-vocabulary", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).levels.map((l: { id: string }) => l.id), ["low", "medium", "high"]);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/impact-vocabulary")).status, 401);
});

test("PUT /impact-vocabulary adds a grade; a RAID entry can then be written with it, garbage is 400", async () => {
  const before = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "Impacted risk", severity: "high", impact: "severe" } });
  assert.equal(before.status, 400);

  const put = await h.req("/impact-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [
    { id: "severe", label: "Severe", level: 4, order: 3 },
  ] } });
  assert.equal(put.status, 200);
  assert.ok((await json(put)).levels.some((l: { id: string }) => l.id === "severe"), "the added grade resolves");

  const created = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "Impacted risk", severity: "high", impact: "severe" } });
  assert.equal(created.status, 201);
  assert.equal((await json(created)).impact, "severe");

  const garbage = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "x", severity: "high", impact: "banana" } });
  assert.equal(garbage.status, 400);
});

test("PUT /impact-vocabulary rejects a new grade with no ordinal level → 400", async () => {
  assert.equal((await h.req("/impact-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [{ id: "severe", label: "Severe", order: 3 }] } })).status, 400);
});
