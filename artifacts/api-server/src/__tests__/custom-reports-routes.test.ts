import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The def store must be configured + the importer module on BEFORE the app is imported by the harness.
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "reports-conv-"));
process.env["ENABLED_FEATURES"] = "defImporter";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/custom-reports.ts after the def-store convergence (roadmap X.10 reports). Bespoke report DEFINITIONS
 * are now artifacts authored through the importer (`POST /api/defs`, kind `report`); the CustomReport renderer
 * reads them from `GET /reports/custom/resolved`, and the legacy `PUT /reports/custom` survives only to DRAIN
 * to `[]`. (Overrides of the built-in reports stay in the separate `reportOverrides` settings overlay.)
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); });
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ customReports: [] });
  const { replaceArtifacts } = await import("../lib/artifact-store");
  const { DEF_ARTIFACT } = await import("../lib/def-import");
  replaceArtifacts(DEF_ARTIFACT, { kind: "org" }, []);
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const REPORT = { id: "spend", label: "Spend by status", scope: "project", groupBy: "status", metrics: [{ id: "m1", field: "budget", agg: "sum" }], viz: "table" };
const authorReport = (report: object, cookie = ADMIN) =>
  req("/defs", { method: "POST", cookie, body: { kind: "report", storage: "org", name: (report as { label?: string }).label ?? "Report", payload: report } });

test("a report authored via the importer resolves via GET /reports/custom/resolved", async () => {
  assert.equal((await authorReport(REPORT)).status, 201);
  const resolved = (await req("/reports/custom/resolved").then((x) => x.json())) as { customReports: { id: string; label: string }[] };
  const spend = resolved.customReports.find((r) => r.id === "spend");
  assert.ok(spend, "the report is in the resolved set");
  assert.equal(spend!.label, "Spend by status");
});

test("a legacy settings.customReports entry still resolves (migration bridge)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ customReports: [REPORT] });
  const resolved = (await req("/reports/custom/resolved").then((x) => x.json())) as { customReports: { id: string }[] };
  assert.ok(resolved.customReports.some((r) => r.id === "spend"));
});

test("the legacy PUT /reports/custom is retired — a non-empty write is 410, draining to [] is allowed", async () => {
  assert.equal((await req("/reports/custom", { method: "PUT", body: { customReports: [REPORT] } })).status, 410);
  assert.equal((await req("/reports/custom", { method: "PUT", body: { customReports: [] } })).status, 200);
});

test("draining custom reports is gated to pmo (reads stay open) under real RBAC", async () => {
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    assert.equal((await h.req("/reports/custom", { cookie: memberCookie(), method: "PUT", body: { customReports: [] } })).status, 403);
    assert.equal((await h.req("/reports/custom", { cookie: memberCookie() })).status, 200);
    assert.equal((await h.req("/reports/custom/resolved", { cookie: memberCookie() })).status, 200);
  } finally { if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});
