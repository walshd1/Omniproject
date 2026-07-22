import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the scope-overridable RAID/risk SEVERITY vocabulary AND the relaxed RAID write-gate:
 *  - GET  /api/severity-vocabulary — the resolved grades for the caller's scope (any authed user).
 *  - PUT  /api/severity-vocabulary — write the org-scope override (admin/PMO), through the validated def path.
 *  - POST /api/projects/:id/raid accepts a scope-ADDED severity (the frozen enum gate is relaxed) but 400s garbage.
 */

process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "severity-vocab-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /severity-vocabulary returns the shipped 4 RAID severity grades before anything is authored", async () => {
  const r = await h.req("/severity-vocabulary", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).levels.map((l: { id: string }) => l.id), ["low", "medium", "high", "critical"]);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/severity-vocabulary")).status, 401);
});

test("PUT /severity-vocabulary adds a grade; a RAID entry can then be written with it, garbage is 400", async () => {
  // Before: the scope-added grade is not yet a valid severity → the RAID write is rejected.
  const before = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "Exotic risk", severity: "catastrophic" } });
  assert.equal(before.status, 400);

  // Org adds a "catastrophic" severity grade bound to ordinal 5.
  const put = await h.req("/severity-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [
    { id: "catastrophic", label: "Catastrophic", level: 5, order: 4, methodologies: ["prince2"] },
    { id: "low", label: "Minor" }, // relabel a shipped one too
  ] } });
  assert.equal(put.status, 200);
  const resolved = await json(put);
  assert.ok(resolved.levels.some((l: { id: string }) => l.id === "catastrophic"), "the added grade resolves");
  assert.equal(resolved.levels.find((l: { id: string }) => l.id === "low").label, "Minor");

  // After: the scope-added grade is accepted on a RAID write.
  const created = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "Exotic risk", severity: "catastrophic", likelihood: "high", impact: "high" } });
  assert.equal(created.status, 201);
  assert.equal((await json(created)).severity, "catastrophic");

  // A truly-unknown grade is still rejected.
  const garbage = await h.req("/projects/proj-001/raid", { method: "POST", cookie: adminCookie(), body: { type: "risk", title: "x", severity: "banana" } });
  assert.equal(garbage.status, 400);
});

test("PUT /severity-vocabulary rejects a new grade with no ordinal level → 400", async () => {
  assert.equal((await h.req("/severity-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [{ id: "catastrophic", label: "Catastrophic", order: 4 }] } })).status, 400);
  assert.equal((await h.req("/severity-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [{ id: "catastrophic", label: "Catastrophic", level: 0, order: 4 }] } })).status, 400);
});
