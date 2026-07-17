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
  // Author a shipped "risk" mapping into the system store (stands in for an org-authored mapping def). It
  // DECLARES the all-in-one home (built-in broker + sidecar backend) — the admin's explicit choice.
  seedSystemDef("mapping", "Risk register mapping", { id: "risk", broker: "builtin", backend: "sidecar", fields: { id: "id", title: "title", severity: "severity" } }, "2026-01-01T00:00:00.000Z");
  // A mapping with NO declared home — its fields are homeless until an admin gives them one.
  seedSystemDef("mapping", "Homeless-fields mapping", { id: "gap", fields: { id: "id", note: "note" } }, "2026-01-01T00:00:00.000Z");
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

test("homeless fields are surfaced to the admin, never silently written", async () => {
  // GET surfaces them so the admin can decide (map to a backend, use the sidecar, or remove the field).
  const g = await h.req(`/projects/${PID}/mapping/gap`, { cookie: ADMIN });
  assert.equal(g.status, 200);
  const m = (await g.json()) as { homeless: string[] };
  assert.deepEqual([...m.homeless].sort(), ["id", "note"]);   // the whole mapping has no home — every field is homeless
  // A write reports the homeless field and writes nothing.
  const put = await h.req(`/projects/${PID}/mapping/gap/G-1`, { method: "PUT", cookie: ADMIN, body: { fields: { note: "hi" } } });
  const w = (await put.json()) as { written: string[]; homeless: string[] };
  assert.deepEqual(w.written, []);
  assert.deepEqual(w.homeless, ["note"]);
});

test("empty rows (no 404) when a mapping exists but nothing is authored yet", async () => {
  const r = await h.req(`/projects/proj-empty-map/mapping/risk/rows`, { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { rows: [] });
});

test("a UI field inherits its backend's validation: enum options are surfaced and enforced on write", async () => {
  // Pick a LIVE superset field with an enum constraint (the demo advertises `customerTier`), then map a UI
  // element onto it — the derived rule must come from the backend, not be hand-set.
  const sup = (await (await h.req(`/fields/superset`, { cookie: ADMIN })).json()) as { fields: { canonicalKey: string; broker: string; system: string; nativeField: string; options?: string[] }[] };
  const tier = sup.fields.find((f) => f.canonicalKey === "customerTier" && f.options?.length)!;
  assert.ok(tier, "the demo backend advertises an enum field");
  seedSystemDef("mapping", "Tier mapping", { id: "cust", broker: tier.broker, fields: { Tier: { broker: tier.broker, backend: tier.system, field: tier.nativeField, superset: "customerTier" } } }, "2026-01-01T00:00:00.000Z");

  // GET surfaces the inherited validation (the enum options) for the UI element.
  const g = (await (await h.req(`/projects/${PID}/mapping/cust`, { cookie: ADMIN })).json()) as { validation: { field: string; options?: string[] }[] };
  const rule = g.validation.find((r) => r.field === "Tier")!;
  assert.deepEqual(rule.options, tier.options);

  // A write outside the backend's allowed set is rejected; an allowed one succeeds.
  const bad = await h.req(`/projects/${PID}/mapping/cust/C-1`, { method: "PUT", cookie: ADMIN, body: { fields: { Tier: "platinum" } } });
  assert.equal(bad.status, 400);
  const ok = await h.req(`/projects/${PID}/mapping/cust/C-1`, { method: "PUT", cookie: ADMIN, body: { fields: { Tier: tier.options![0] } } });
  assert.equal(ok.status, 200);
});

test("a UI field inherits its backend's REGEX (email shape) — enforced on write", async () => {
  const sup = (await (await h.req(`/fields/superset`, { cookie: ADMIN })).json()) as { fields: { canonicalKey: string; broker: string; system: string; nativeField: string; pattern?: string }[] };
  const email = sup.fields.find((f) => f.canonicalKey === "contactEmail" && f.pattern)!;
  assert.ok(email, "the demo backend advertises a regex-constrained field");
  seedSystemDef("mapping", "Email mapping", { id: "contact", broker: email.broker, fields: { Email: { broker: email.broker, backend: email.system, field: email.nativeField, superset: "contactEmail" } } }, "2026-01-01T00:00:00.000Z");
  const bad = await h.req(`/projects/${PID}/mapping/contact/E-1`, { method: "PUT", cookie: ADMIN, body: { fields: { Email: "not-an-email" } } });
  assert.equal(bad.status, 400);
  const ok = await h.req(`/projects/${PID}/mapping/contact/E-1`, { method: "PUT", cookie: ADMIN, body: { fields: { Email: "a@b.co" } } });
  assert.equal(ok.status, 200);
});
