import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { engageAiKill, releaseAiKill, aiKillEngaged, refreshAiKillFromShared, AI_KILL_KEY, __resetAiKill } from "./ai-kill";
import { sharedKv, __resetSharedStateForTest } from "./shared-state";
import { aiChat, AiError } from "./ai";
import { authorizeAutonomousWrite, registerAutonomousGrant, __resetAutonomousGrants, AutonomousWriteDenied } from "./autonomous-grant";
import { mintAutonomousContext } from "./autonomous";
import { setContainmentRelax, __resetContainmentRelax } from "./ai-containment";

/**
 * The break-glass kill switch hard-stops all AI calls and suspends all autonomous writes,
 * without editing grants (release restores the prior posture).
 */
afterEach(() => { __resetAiKill(); __resetAutonomousGrants(); __resetContainmentRelax(); __resetSharedStateForTest(); });

test("toggles", () => {
  assert.equal(aiKillEngaged(), false);
  engageAiKill();
  assert.equal(aiKillEngaged(), true);
  releaseAiKill();
  assert.equal(aiKillEngaged(), false);
});

test("fleet propagation: engaging writes through to shared state; a sibling converges on refresh", async () => {
  // Replica A engages — the switch is written through to shared state.
  engageAiKill();
  assert.equal(await sharedKv.get(AI_KILL_KEY), "1");

  // Replica B (same shared state, its own local flag still false) converges on the fleet-sync tick.
  __resetAiKill(); // simulate the sibling's untouched local view
  assert.equal(aiKillEngaged(), false);
  await refreshAiKillFromShared();
  assert.equal(aiKillEngaged(), true);

  // Releasing clears shared state; the sibling converges back off.
  releaseAiKill();
  assert.equal(await sharedKv.get(AI_KILL_KEY), null);
  await refreshAiKillFromShared();
  assert.equal(aiKillEngaged(), false);
});

test("engaged ⇒ every model call is refused", async () => {
  engageAiKill();
  await assert.rejects(() => aiChat([{ role: "user", content: "hi" }]), (e) => e instanceof AiError && e.status === 403);
});

test("engaged ⇒ autonomous writes are suspended; release restores the grant", () => {
  setContainmentRelax("off"); // isolate from containment
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" }, 1_700_000_000_000);
  const write = () => authorizeAutonomousWrite(ctx, { action: "update_issue", now: 1_700_000_000_000 });

  assert.doesNotThrow(write); // allowed before
  engageAiKill();
  assert.throws(write, AutonomousWriteDenied); // suspended while engaged
  releaseAiKill();
  assert.doesNotThrow(write); // grant intact ⇒ allowed again
});
