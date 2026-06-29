import { closeAllClients } from "./notify-hub";
import { closeAllPresence } from "./presence-hub";
import { wipeInMemoryState } from "./wipe";

/**
 * Graceful shutdown — on SIGTERM/SIGINT (e.g. `docker stop`, a rolling deploy),
 * stop accepting new connections, drain the live SSE streams, let in-flight
 * requests finish, then exit. Without this, a container stop kills in-flight
 * work abruptly and leaves event streams dangling. A hard timeout guarantees the
 * process always exits even if a connection won't close.
 */

export interface ClosableServer {
  close(cb?: (err?: Error) => void): void;
}
export interface ShutdownLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface ShutdownOpts {
  server: ClosableServer;
  signal: string;
  logger: ShutdownLogger;
  exit: (code: number) => void;
  /** Drain side-resources (SSE streams) so the server can finish closing. */
  drain?: () => number;
  timeoutMs?: number;
}

/** Run one graceful shutdown. Idempotent per invocation; safe to unit-test with
 *  fakes for server/exit/logger. */
export function gracefulShutdown(opts: ShutdownOpts): void {
  const { server, signal, logger, exit, drain = closeAllClients, timeoutMs = 10_000 } = opts;
  let finished = false;
  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    exit(code);
  };

  logger.info({ signal }, "graceful shutdown: draining and closing");

  // Hard backstop: always exit, even if a socket refuses to close.
  const timer = setTimeout(() => {
    logger.warn({ signal, timeoutMs }, "graceful shutdown: forced exit after timeout");
    finish(1);
  }, timeoutMs);
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

  const drained = drain();
  if (drained > 0) logger.info({ streams: drained }, "graceful shutdown: closed live SSE streams");

  server.close((err) => {
    clearTimeout(timer);
    if (err) logger.error({ err }, "graceful shutdown: server close error");
    finish(err ? 1 : 0);
  });
}

/** Install SIGTERM/SIGINT handlers that run a single graceful shutdown. Draining
 *  closes live SSE streams AND wipes the bounded in-memory working sets. */
export function installShutdownHandlers(server: ClosableServer, logger: ShutdownLogger): void {
  const drain = (): number => {
    const streams = closeAllClients() + closeAllPresence();
    wipeInMemoryState();
    return streams;
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => gracefulShutdown({ server, signal, logger, exit: (code) => process.exit(code), drain }));
  }
}
