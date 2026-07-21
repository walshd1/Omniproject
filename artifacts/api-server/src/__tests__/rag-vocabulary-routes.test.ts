import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the scope-overridable RAG/health BAND vocabulary (DISPLAY/relabel layer):
 *  - GET  /api/rag-vocabulary — the resolved bands for the caller's scope (any authed user).
 *  - PUT  /api/rag-vocabulary — write the org-scope override (admin/PMO); a plain member is forbidden.
 */

process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rag-vocab-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /rag-vocabulary returns the shipped 3 RAG bands before anything is authored", async () => {
  const r = await h.req("/rag-vocabulary", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).bands.map((b: { id: string }) => b.id), ["red", "amber", "green"]);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/rag-vocabulary")).status, 401);
});

test("PUT /rag-vocabulary relabels a band (Green → On Track) and can add a band", async () => {
  const put = await h.req("/rag-vocabulary", { method: "PUT", cookie: adminCookie(), body: { bands: [
    { id: "green", label: "On Track" }, // relabel
    { id: "blue", label: "Complete", level: 4, order: 3 }, // add a band
  ] } });
  assert.equal(put.status, 200);
  const resolved = await json(put);
  assert.equal(resolved.bands.find((b: { id: string }) => b.id === "green").label, "On Track");
  assert.ok(resolved.bands.some((b: { id: string }) => b.id === "blue"), "the added band resolves");
});

test("PUT /rag-vocabulary rejects a new band with no ordinal level → 400", async () => {
  assert.equal((await h.req("/rag-vocabulary", { method: "PUT", cookie: adminCookie(), body: { bands: [{ id: "blue", label: "Complete", order: 3 }] } })).status, 400);
});
