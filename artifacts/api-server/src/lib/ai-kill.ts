/**
 * Global AI kill switch.
 *
 * One flag that, when engaged, hard-stops ALL AI at once: every model call is refused
 * (lib/ai.aiChat), and every autonomous write is denied (lib/autonomous-grant) — grants
 * are suspended, not edited, so releasing the switch restores the prior posture exactly.
 * The break-glass control for "something's wrong, stop the AI now". Admin-set, in-memory
 * (a fresh process boots with AI live but governance still off-by-default).
 */
let engaged = false;

/** Engage the kill switch — all AI calls and autonomous writes stop immediately. */
export function engageAiKill(): void { engaged = true; }
/** Release the kill switch — the prior governance + grant posture resumes. */
export function releaseAiKill(): void { engaged = false; }
/** Is the AI kill switch currently engaged? */
export function aiKillEngaged(): boolean { return engaged; }
/** Test-only: reset to the default (released). */
export function __resetAiKill(): void { engaged = false; }
