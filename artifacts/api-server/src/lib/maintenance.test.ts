import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  engageMaintenance, releaseMaintenance, maintenanceEngaged, maintenanceReason, maintenanceGuard,
  isMaintenanceExempt, publishMaintenanceToShared, refreshMaintenanceFromShared, __resetMaintenance,
} from "./maintenance";
import { __setRedisKvForTest, __resetSharedStateForTest } from "./shared-state";
import { FakeRedis } from "../__tests__/fake-redis";
import type { Request, Response } from "express";

afterEach(() => { __resetMaintenance(); __resetSharedStateForTest(); });

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

// ── Fleet convergence (the P0 fix: a freeze must propagate beyond the handling replica) ──────────

test("in-process mode: refresh is a no-op so the durable local file is never clobbered", async () => {
  // No REDIS_URL / shared state stays in-process. A locally-restored freeze must survive a converge
  // tick reading an empty shared store — otherwise a single-replica restart would silently un-freeze.
  engageMaintenance("local freeze");
  await refreshMaintenanceFromShared();
  assert.equal(maintenanceEngaged(), true);
  assert.equal(maintenanceReason(), "local freeze");
});

test("Redis mode: an interactive freeze on one replica converges to another via shared state", async () => {
  __setRedisKvForTest(new FakeRedis()); // shared state is now Redis-backed (fleet mode)

  // Replica A engages + publishes.
  engageMaintenance("incident-42");
  await publishMaintenanceToShared();

  // Replica B starts clean, then runs the fleet-sync converge tick → adopts the freeze.
  __resetMaintenance();
  assert.equal(maintenanceEngaged(), false); // B hasn't converged yet
  await refreshMaintenanceFromShared();
  assert.equal(maintenanceEngaged(), true, "B adopts the fleet freeze");
  assert.equal(maintenanceReason(), "incident-42");
});

test("Redis mode: a release on one replica converges the fleet back to writable", async () => {
  __setRedisKvForTest(new FakeRedis());

  engageMaintenance("freeze");
  await publishMaintenanceToShared();

  // A releases + publishes; B (currently frozen) converges to released.
  releaseMaintenance();
  await publishMaintenanceToShared();
  engageMaintenance("stale local freeze on B"); // simulate B still locally frozen
  await refreshMaintenanceFromShared();
  assert.equal(maintenanceEngaged(), false, "shared release wins fleet-wide");
});
