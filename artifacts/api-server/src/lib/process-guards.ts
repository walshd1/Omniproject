/**
 * Process-level crash backstop.
 *
 * The gateway's crash-safety currently rests ENTIRELY on every timer / stream / EventEmitter callback and
 * every floating promise being individually caught — with no net underneath. On Node's defaults, ONE escaped
 * throw or one unhandled rejection terminates the whole process (dropping every in-flight request + SSE
 * stream). For a STATELESS gateway that is the wrong trade: a single missed `.catch` in one code path should
 * degrade to a logged, survived event, not a fleet-wide outage.
 *
 * These handlers are the NET, not a licence to leak — the underlying escaped throw must still be fixed at its
 * source. We deliberately KEEP THE PROCESS ALIVE (log + continue) rather than exit: the gateway holds no
 * corruptible in-memory system-of-record (durable state is atomic sealed-file writes; per-request state dies
 * with the request), so continuing is safe and maximises availability. An orchestrator's own liveness probe
 * still catches a truly wedged process.
 *
 * The handler bodies are exported so the behaviour is unit-testable without emitting on the real process (which
 * would collide with node:test's own uncaughtException handling).
 */

export interface Logger {
  error: (obj: unknown, msg?: string) => void;
}

/** Handler for an unhandled promise rejection: log and keep running. */
export function onUnhandledRejection(logger: Logger): (reason: unknown) => void {
  return (reason: unknown): void => {
    logger.error({ err: reason }, "[process] unhandledRejection — kept alive. A promise rejected with no .catch(); find and fix the floating promise.");
  };
}

/** Handler for an uncaught exception (a throw that escaped Express — a timer/stream/emitter callback): log and keep running. */
export function onUncaughtException(logger: Logger): (err: unknown) => void {
  return (err: unknown): void => {
    logger.error({ err }, "[process] uncaughtException — kept alive. An escaped throw (timer/stream/emitter). State may be locally degraded; fix the source.");
  };
}

let installed: { rej: (r: unknown) => void; exc: (e: unknown, origin?: unknown) => void } | null = null;

/**
 * Install the backstop. Idempotent: a prior install is removed first (so repeated calls / test reloads don't
 * stack listeners). Register this as early as possible in boot so it also covers async boot failures.
 */
export function installProcessGuards(logger: Logger): void {
  if (installed) {
    process.off("unhandledRejection", installed.rej);
    process.off("uncaughtException", installed.exc);
  }
  const rej = onUnhandledRejection(logger);
  const exc = onUncaughtException(logger);
  process.on("unhandledRejection", rej);
  process.on("uncaughtException", exc);
  installed = { rej, exc };
}
