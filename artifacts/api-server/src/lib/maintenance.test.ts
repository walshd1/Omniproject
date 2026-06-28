import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { engageMaintenance, releaseMaintenance, maintenanceEngaged, maintenanceReason, maintenanceGuard, isMaintenanceExempt, __resetMaintenance } from "./maintenance";
import type { Request, Response } from "express";

afterEach(() => __resetMaintenance());

function run(method: string, path: string): { status: number | null; passed: boolean } {
  let status: number | null = null;
  let passed = false;
  const req = { method, path } as Request;
  const res = { status(c: number) { status = c; return this; }, json() { return this; } } as unknown as Response;
  maintenanceGuard(req, res, () => { passed = true; });
  return { status, passed };
}

test("disengaged: everything passes", () => {
  assert.equal(maintenanceEngaged(), false);
  assert.equal(run("POST", "/api/projects").passed, true);
});

test("engaged: writes are blocked with 503, reads pass", () => {
  engageMaintenance("Scheduled migration");
  assert.equal(maintenanceEngaged(), true);
  assert.equal(maintenanceReason(), "Scheduled migration");
  assert.equal(run("GET", "/api/projects").passed, true); // reads OK
  const w = run("POST", "/api/projects");
  assert.equal(w.passed, false);
  assert.equal(w.status, 503);
});

test("engaged: auth + the toggle + health stay exempt (so you can get back out)", () => {
  engageMaintenance();
  for (const p of ["/api/auth/login", "/api/auth/step-up", "/api/admin/maintenance", "/api/healthz"]) {
    assert.equal(isMaintenanceExempt(p), true, p);
    assert.equal(run("PUT", p).passed, true, p);
  }
});

test("release restores writes", () => {
  engageMaintenance();
  releaseMaintenance();
  assert.equal(run("POST", "/api/projects").passed, true);
});
