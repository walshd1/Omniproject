import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/bulk.ts — the declarative bulk-action runner (POST /api/admin/bulk). Drives the GUARD
 * branches that make it safe: it's off-by-default (opted in here via ENABLED_FEATURES so the route
 * mounts at all), RBAC-gated (manager), step-up gated (a batch is high-blast-radius), shape- and
 * cap-validated, and returns a per-item partial-success outcome. A dry-run writes nothing.
 */
// Opt the default-off `bulkActions` feature module in BEFORE the app boots (startHarness imports the
// app, which seeds settings from env at that point). Isolated to this test process.
process.env["ENABLED_FEATURES"] = "bulkActions";

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

const bulk = (body: unknown, cookie: string) => h.req("/admin/bulk", { method: "POST", cookie, body });

test("a non-manager is refused by RBAC → 403", async () => {
  const r = await bulk({ action: "create_project", names: ["X"] }, memberCookie());
  assert.equal(r.status, 403);
});

test("a manager WITHOUT a fresh step-up is refused → 403 step_up_required", async () => {
  const r = await bulk({ action: "create_project", names: ["X"] }, adminCookie());
  assert.equal(r.status, 403);
  assert.equal(((await r.json()) as { code?: string }).code, "step_up_required");
});

test("an unknown action → 400", async () => {
  const r = await bulk({ action: "delete_everything", names: ["X"] }, stepUpAdminCookie());
  assert.equal(r.status, 400);
});

test("update_project with no targets → 400", async () => {
  const r = await bulk({ action: "update_project", patch: { status: "Closed" } }, stepUpAdminCookie());
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /targets/);
});

test("update_project with an empty patch → 400 (a no-op write is refused)", async () => {
  const r = await bulk({ action: "update_project", targets: ["p1"], patch: {} }, stepUpAdminCookie());
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /at least one field/);
});

test("create_project over the item cap → 413", async () => {
  const names = Array.from({ length: 501 }, (_, i) => `Bulk ${i}`);
  const r = await bulk({ action: "create_project", names }, stepUpAdminCookie());
  assert.equal(r.status, 413);
  assert.match(((await r.json()) as { error: string }).error, /Too many items/);
});

test("dry-run create_project → 200, projects preview-apply per name, writes nothing", async () => {
  const r = await bulk(
    { action: "create_project", dryRun: true, names: ["Preview A", "Preview B"], template: { status: "Active" } },
    stepUpAdminCookie(),
  );
  assert.equal(r.status, 200);
  const out = (await r.json()) as { total: number; applied: number; results: { status: string }[] };
  assert.equal(out.total, 2);
  assert.equal(out.applied, 2);
  assert.ok(out.results.every((x) => x.status === "preview-apply"));
});

test("real create_project of distinct names → 200, all applied with distinct ids", async () => {
  const r = await bulk(
    { action: "create_project", names: ["Bulk Alpha", "Bulk Beta", "Bulk Gamma"] },
    stepUpAdminCookie(),
  );
  assert.equal(r.status, 200);
  const out = (await r.json()) as { applied: number; total: number; results: { id?: string; status: string }[] };
  assert.equal(out.total, 3);
  assert.equal(out.applied, 3);
  const ids = out.results.map((x) => x.id).filter(Boolean);
  assert.equal(new Set(ids).size, 3); // distinct projects created (no idempotency collapse)
});
