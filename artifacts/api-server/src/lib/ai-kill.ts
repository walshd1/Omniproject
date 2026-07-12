import { sharedKv } from "./shared-state";

/**
 * Global AI kill switch.
 *
 * One flag that, when engaged, hard-stops ALL AI at once: every model call is refused
 * (lib/ai.aiChat), and every autonomous write is denied (lib/autonomous-grant) — grants
 * are suspended, not edited, so releasing the switch restores the prior posture exactly.
 * The break-glass control for "something's wrong, stop the AI now". Admin-set.
 *
 * FLEET BEHAVIOUR: engaging/releasing is instant on the handling replica (the local flag is set
 * synchronously) AND written through to shared state. When shared state is Redis-backed, every other
 * replica converges within the fleet-sync interval (`startAiKillFleetSync`), so the switch is fleet-wide,
 * not just per-replica. Without shared state (in-process mode) it is inherently per-replica — the
 * `aiKillEngaged` read stays synchronous either way, so the hot paths pay no I/O.
 */
export const AI_KILL_KEY = "break-glass:ai-kill";

let engaged = false;

/** Engage the kill switch — all AI calls and autonomous writes stop immediately on this replica, and
 *  fleet-wide within the sync interval when shared state is configured. */
export function engageAiKill(): void {
  engaged = true;
  void sharedKv.set(AI_KILL_KEY, "1").catch(() => { /* best-effort fan-out; local flag already set */ });
}
/** Release the kill switch — the prior governance + grant posture resumes. */
export function releaseAiKill(): void {
  engaged = false;
  void sharedKv.del(AI_KILL_KEY).catch(() => { /* best-effort */ });
}
/** Is the AI kill switch currently engaged? (synchronous — the local view, kept converged by the sync.) */
export function aiKillEngaged(): boolean { return engaged; }

/** Converge this replica's flag with the shared value once (the fleet-sync tick, also directly testable). */
export async function refreshAiKillFromShared(): Promise<void> {
  try {
    engaged = (await sharedKv.get(AI_KILL_KEY)) === "1";
  } catch {
    /* keep the last known value on a shared-state blip — fail toward the current posture */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Start periodic fleet convergence so the switch flipped on ANY replica takes effect here. Idempotent;
 *  the interval is unref'd so it never keeps the process alive. Returns a stop handle. */
export function startAiKillFleetSync(intervalMs = 3000): () => void {
  if (!timer) {
    timer = setInterval(() => { void refreshAiKillFromShared(); }, intervalMs);
    timer.unref?.();
  }
  return stopAiKillFleetSync;
}
export function stopAiKillFleetSync(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Test-only: reset to the default (released), local flag only. */
export function __resetAiKill(): void { engaged = false; }
