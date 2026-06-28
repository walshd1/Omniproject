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
const { persistSecurityState, loadSecurityState, collectSecurityState } = await import("./security-state");
const { revokeKey, isActive, __resetKeyRegistry } = await import("./key-registry");
const { registerAutonomousGrant, getAutonomousGrant, __resetAutonomousGrants } = await import("./autonomous-grant");
const { setContainmentRelax, getContainmentRelax, __resetContainmentRelax } = await import("./ai-containment");
const { engageAiKill, releaseAiKill, aiKillEngaged, __resetAiKill } = await import("./ai-kill");
const { isActionApproved, approveAction, __resetApproved } = await import("./approved-actions");

afterEach(() => {
  __resetKeyRegistry(); __resetAutonomousGrants(); __resetContainmentRelax(); __resetAiKill(); __resetApproved();
  if (fs.existsSync(FILE)) fs.rmSync(FILE);
});

test("the state file is written sealed (opaque at rest)", () => {
  revokeKey("broker", { by: "admin", reason: "x" });
  persistSecurityState();
  const raw = fs.readFileSync(FILE, "utf8");
  assert.ok(raw.startsWith("c1.")); // sealed, not plaintext JSON
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
