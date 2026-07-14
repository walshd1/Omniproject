import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Durable security state: a revocation, a grant, a relaxed posture and the kill switch all
 * survive a restart when SECURITY_STATE_FILE is set (sealed at rest).
 */
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omni-sec-")), "security-state.seal");
process.env["SECURITY_STATE_FILE"] = FILE;

// Import AFTER the env is set so the module reads the file path.
const { persistSecurityState, loadSecurityState, collectSecurityState, applySecurityState, publishAiAuthzToShared, refreshAiAuthzFromShared } = await import("./security-state");
const { maintenanceEngaged, releaseMaintenance } = await import("./maintenance");
const { revokeKey, isActive, __resetKeyRegistry } = await import("./key-registry");
const { registerAutonomousGrant, getAutonomousGrant, listAutonomousGrants, __resetAutonomousGrants } = await import("./autonomous-grant");
const { setContainmentRelax, getContainmentRelax, __resetContainmentRelax } = await import("./ai-containment");
const { engageAiKill, releaseAiKill, aiKillEngaged, __resetAiKill } = await import("./ai-kill");
const { isActionApproved, approveAction, __resetApproved } = await import("./approved-actions");
const { __setRedisKvForTest, __resetSharedStateForTest, sharedKv } = await import("./shared-state");
const { FakeRedis } = await import("../__tests__/fake-redis");
const { setRoleMap, getRoleMap, resetRoleMap } = await import("./rbac");

/** The admin override groups for a role (from getRoleMap), or [] — used to assert role-map converge. */
const overrideGroups = (role: string): string[] =>
  getRoleMap().find((m) => m.role === role && m.source === "override")?.claims ?? [];

/** The AI-authz fleet-sync wire key (lib/security-state AI_AUTHZ_KEY) — hardcoded here to plant a
 *  hostile shared blob the converge path must reject. */
const AI_AUTHZ_KEY = "security:fleet:ai-authz";

afterEach(() => {
  __resetKeyRegistry(); __resetAutonomousGrants(); __resetContainmentRelax(); __resetAiKill(); __resetApproved();
  releaseMaintenance(); resetRoleMap();
  __resetSharedStateForTest();
  if (fs.existsSync(FILE)) fs.rmSync(FILE);
});

test("the state file is written sealed (opaque at rest)", () => {
  revokeKey("broker", { by: "admin", reason: "x" });
  persistSecurityState();
  const raw = fs.readFileSync(FILE, "utf8");
  assert.ok(raw.startsWith("c2.")); // sealed, not plaintext JSON (current HKDF format)
  assert.ok(!/broker/.test(raw));
});

test("a revocation + grant + relax + kill survive a restart", () => {
  // Mutate everything, then persist.
  revokeKey("broker", { by: "admin", reason: "rotate" }); // broker v1 revoked, now v2
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["P1"], notAfter: 9e15, maxWrites: 3 });
  setContainmentRelax("local");
  approveAction("update_issue");
  engageAiKill();
  persistSecurityState();

  // Simulate a restart: wipe the in-memory registries, then restore from disk.
  __resetKeyRegistry(); __resetAutonomousGrants(); __resetContainmentRelax(); __resetAiKill(); __resetApproved();
  assert.equal(isActive("broker", 1), true); // back to default (un-revoked) before restore
  loadSecurityState();

  // Everything is back.
  assert.equal(isActive("broker", 1), false); // STILL revoked across the restart
  assert.equal(getAutonomousGrant("health-watch")?.maxWrites, 3);
  assert.equal(getContainmentRelax(), "local");
  assert.equal(isActionApproved("update_issue"), true);
  assert.equal(aiKillEngaged(), true);
});

test("collectSecurityState reflects the live registries", () => {
  releaseAiKill();
  setContainmentRelax("remote");
  const snap = collectSecurityState();
  assert.equal(snap.containment, "remote");
  assert.equal(snap.aiKill, false);
});

test("maintenance mode survives a restart; a released kill switch is restored released", () => {
  const snap = { ...collectSecurityState(), aiKill: false, maintenance: { engaged: true, reason: "upgrade" } };
  applySecurityState(snap);
  assert.equal(maintenanceEngaged(), true);
  assert.equal(aiKillEngaged(), false);

  // Now apply a snapshot with maintenance off + kill on → both flip.
  applySecurityState({ ...snap, maintenance: { engaged: false, reason: "" }, aiKill: true });
  assert.equal(maintenanceEngaged(), false);
  assert.equal(aiKillEngaged(), true);
});

test("applySecurityState tolerates a sparse snapshot (missing sections are skipped)", () => {
  // No keys/grants/containment/approved/maintenance — only the aiKill flag present.
  applySecurityState({ aiKill: false } as never);
  assert.equal(aiKillEngaged(), false);
});

test("loadSecurityState tolerates a corrupt state file (keeps defaults, no throw)", () => {
  fs.writeFileSync(FILE, "this is not sealed json");
  assert.doesNotThrow(() => loadSecurityState());
});

// ── AI-authz fleet-sync (grants / containment / approved converge across replicas) ───────────────

test("Redis mode: an AI-authz change on one replica converges to another (revocation propagates)", async () => {
  __setRedisKvForTest(new FakeRedis());

  // Replica A: grant + relax + approve a write action, then publish to the fleet.
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["P1"], notAfter: 9e15, maxWrites: 3 });
  setContainmentRelax("local");
  approveAction("update_issue");
  await publishAiAuthzToShared();

  // Replica B: starts at defaults, converges → adopts the fleet state.
  __resetAutonomousGrants(); __resetContainmentRelax(); __resetApproved();
  assert.equal(getAutonomousGrant("health-watch"), undefined);
  assert.equal(isActionApproved("update_issue"), false);
  await refreshAiAuthzFromShared();
  assert.equal(getAutonomousGrant("health-watch")?.maxWrites, 3, "B adopts the fleet grant");
  assert.equal(getContainmentRelax(), "local");
  assert.equal(isActionApproved("update_issue"), true);

  // Now A REVOKES on the fleet (clear grant, re-tighten, un-approve) and publishes.
  __resetAutonomousGrants(); __resetContainmentRelax(); __resetApproved(); // A back to strict defaults
  await publishAiAuthzToShared();
  // B is still relaxed until it converges…
  await refreshAiAuthzFromShared();
  assert.equal(getAutonomousGrant("health-watch"), undefined, "revoked grant propagates");
  assert.equal(getContainmentRelax(), "public", "re-tightened containment propagates");
  assert.equal(isActionApproved("update_issue"), false, "un-approved action propagates");
});

test("the RBAC role-map override survives a restart (durable, was RAM-only before)", () => {
  setRoleMap({ admin: ["compromised-admins"] });
  persistSecurityState();
  resetRoleMap(); // simulate a restart wiping the RAM override
  assert.deepEqual(overrideGroups("admin"), []);
  loadSecurityState();
  assert.deepEqual(overrideGroups("admin"), ["compromised-admins"], "override is restored across the restart");
});

test("Redis mode: a role-map REVOCATION propagates fleet-wide", async () => {
  __setRedisKvForTest(new FakeRedis());
  // Replica A maps a group to admin, publishes.
  setRoleMap({ admin: ["ops-team"] });
  await publishAiAuthzToShared();
  // Replica B converges → adopts it.
  resetRoleMap();
  await refreshAiAuthzFromShared();
  assert.deepEqual(overrideGroups("admin"), ["ops-team"], "B adopts the mapping");
  // A REVOKES the group's admin authority (clears the override), publishes.
  resetRoleMap();
  await publishAiAuthzToShared();
  await refreshAiAuthzFromShared();
  assert.deepEqual(overrideGroups("admin"), [], "the revocation propagates to B");
});

test("in-process mode: AI-authz converge is a no-op (durable local file stays authoritative)", async () => {
  setContainmentRelax("off"); // most relaxed
  approveAction("update_issue");
  // No REDIS_URL → shared state is in-process; converge must NOT wipe the local posture with empties.
  await refreshAiAuthzFromShared();
  assert.equal(getContainmentRelax(), "off");
  assert.equal(isActionApproved("update_issue"), true);
});

test("a HOSTILE shared AI-authz blob can never widen authorization (validated on converge)", async () => {
  __setRedisKvForTest(new FakeRedis());
  // Plant an attacker-shaped blob directly on the fleet key: an out-of-range containment (would relax
  // the leash if trusted), a malformed grant (no actorId), a non-string approved action + vocab.
  await sharedKv.set(AI_AUTHZ_KEY, JSON.stringify({
    grants: [{ actions: ["update_issue"] }, "not-an-object", { actorId: "", actions: ["x"] }],
    containment: "totally-off",
    approved: { actions: [123, "delete_project"], vocab: [true, "ok"] },
    // A hostile role-map: an INVENTED role (not one of the five) and a non-string group under a real role.
    roleMap: { superadmin: ["attacker"], admin: [42, "ops"], __proto__: ["x"] },
  }));

  await refreshAiAuthzFromShared();

  // Containment fails SAFE to full ("public"), not the bogus value → no silent relaxation.
  assert.equal(getContainmentRelax(), "public");
  // The malformed grants are all dropped (no actorId ⇒ unusable).
  assert.deepEqual(listAutonomousGrants(), []);
  // Only the well-formed string action is approved; the numeric entry is dropped.
  assert.equal(isActionApproved("delete_project"), true);
  assert.equal(isActionApproved("123"), false);
  // Role-map: the invented "superadmin" role can't exist; only the real role's STRING group survives.
  assert.equal(getRoleMap().find((m) => (m.role as string) === "superadmin"), undefined);
  assert.deepEqual(overrideGroups("admin"), ["ops"]); // 42 dropped, "ops" kept (lower-cased)
});

test("fan-out publishes EXACTLY the fleet-synced field set (drift guard for AI_AUTHZ_FIELDS)", async () => {
  // The fanned-out snapshot and the converge path both iterate the AI_AUTHZ_FIELDS registry, so a new
  // elevation control can't reach one path without the other. This pins the published shape: if a field
  // is added to (or dropped from) the registry, this fails until the change is deliberate — the runtime
  // twin of the compile-time `satisfies Record<keyof AiAuthzSnapshot, …>` lock.
  __setRedisKvForTest(new FakeRedis());
  await publishAiAuthzToShared();
  const raw = await sharedKv.get(AI_AUTHZ_KEY);
  assert.ok(raw, "publish must write the fleet key");
  const keys = Object.keys(JSON.parse(raw)).sort();
  assert.deepEqual(keys, ["approved", "containment", "grants", "roleMap"],
    "a new fleet-synced elevation control must be added to AI_AUTHZ_FIELDS (collect + applyFromShared), not just the local persist snapshot");
});
