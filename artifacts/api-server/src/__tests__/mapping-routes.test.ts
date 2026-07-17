import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "mapping-routes-"));
import { startHarness, adminCookie, type Harness } from "./_harness";
import { seedSystemDef } from "../lib/def-import";

/**
 * The GENERIC mapping surface (roadmap §4.6, "across the board") — the SAME (broker, backend) addressing +
 * sidecar the WBS cost screen uses, exposed for ANY slot. Here a "risk" mapping (not WBS) is authored, rows are
 * written through it into the sealed sidecar, and read back projected — proving any form/report/screen can bind
 * a mapped, sidecar-backed table with no bespoke code.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => {
  h = await startHarness();
  // Author a shipped "risk" mapping into the system store (stands in for an org-authored mapping def).
  seedSystemDef("mapping", "Risk register mapping", { id: "risk", fields: { id: "id", title: "title", severity: "severity" } }, "2026-01-01T00:00:00.000Z");
});
after(() => { h?.close(); fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); });

const PID = "proj-generic-map";

test("GET /mapping/:slot returns the resolved generic mapping", async () => {
  const r = await h.req(`/projects/${PID}/mapping/risk`, { cookie: ADMIN });
  assert.equal(r.status, 200);
  const m = (await r.json()) as { id: string; fields: Record<string, unknown> };
  assert.equal(m.id, "risk");
  assert.equal(m.fields["severity"], "severity");
});

test("an unknown slot is 404 (not a silent empty mapping)", async () => {
  assert.equal((await h.req(`/projects/${PID}/mapping/nope`, { cookie: ADMIN })).status, 404);
});

test("write → read round-trip: author rows through the mapping into the sidecar, read them projected", async () => {
  const put = await h.req(`/projects/${PID}/mapping/risk/R-1`, {
    method: "PUT", cookie: ADMIN, body: { fields: { title: "Data loss", severity: "high" } },
  });
  assert.equal(put.status, 200);
  const w = (await put.json()) as { written: string[]; external: unknown[] };
  assert.deepEqual([...w.written].sort(), ["severity", "title"]);
  assert.equal(w.external.length, 0);          // all-in-one: every field routed home to the sidecar

  const rows = await h.req(`/projects/${PID}/mapping/risk/rows`, { cookie: ADMIN });
  assert.equal(rows.status, 200);
  const body = (await rows.json()) as { rows: { id: string; title: string; severity: string }[] };
  const row = body.rows.find((x) => x.id === "R-1")!;
  assert.ok(row, "the authored row is served from the sidecar");
  assert.equal(row.title, "Data loss");
  assert.equal(row.severity, "high");
});

test("empty rows (no 404) when a mapping exists but nothing is authored yet", async () => {
  const r = await h.req(`/projects/proj-empty-map/mapping/risk/rows`, { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rows: [] });
});
