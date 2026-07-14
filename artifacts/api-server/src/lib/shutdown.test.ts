import { test } from "node:test";
import assert from "node:assert/strict";
import { gracefulShutdown } from "./shutdown";
import { addClient, closeAllClients, clientCount } from "./notify-hub";

function fakeLogger() {
  const calls: string[] = [];
  const rec = () => (_obj: unknown, msg?: string) => calls.push(String(msg ?? ""));
  return { calls, info: rec(), warn: rec(), error: rec() };
}

test("gracefulShutdown drains, closes the server, and exits 0", () => {
  const log = fakeLogger();
  let closed = false;
  let drained = false;
  let exitCode: number | null = null;
  gracefulShutdown({
    server: { close: (cb) => { closed = true; cb?.(); } },
    signal: "SIGTERM",
    logger: log,
    exit: (c) => { exitCode = c; },
    drain: () => { drained = true; return 0; },
    timeoutMs: 1000,
  });
  assert.equal(drained, true);
  assert.equal(closed, true);
  assert.equal(exitCode, 0);
});

test("gracefulShutdown logs the number of live SSE streams it drained", () => {
  const log = fakeLogger();
  let exitCode: number | null = null;
  gracefulShutdown({
    server: { close: (cb) => cb?.() },
    signal: "SIGTERM",
    logger: log,
    exit: (c) => { exitCode = c; },
    drain: () => 3, // 3 streams drained → the "closed live SSE streams" log fires
    timeoutMs: 1000,
  });
  assert.equal(exitCode, 0);
  assert.ok(log.calls.some((m) => /closed live SSE streams/.test(m)));
});

test("gracefulShutdown exits 1 when the server reports a close error", () => {
  let exitCode: number | null = null;
  gracefulShutdown({
    server: { close: (cb) => cb?.(new Error("boom")) },
    signal: "SIGINT",
    logger: fakeLogger(),
    exit: (c) => { exitCode = c; },
    drain: () => 0,
  });
  assert.equal(exitCode, 1);
});

test("gracefulShutdown force-exits if the server never closes", async () => {
  let exitCode: number | null = null;
  gracefulShutdown({
    server: { close: () => { /* never calls back */ } },
    signal: "SIGTERM",
    logger: fakeLogger(),
    exit: (c) => { exitCode = c; },
    drain: () => 0,
    timeoutMs: 20,
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(exitCode, 1); // the timeout backstop fired
});

test("closeAllClients ends every live SSE stream and forgets them", () => {
  let aClosed = false;
  let bClosed = false;
  addClient({ id: "a", roles: [], send: () => {}, close: () => { aClosed = true; } });
  addClient({ id: "b", roles: [], send: () => {}, close: () => { bClosed = true; } });
  const n = closeAllClients();
  assert.equal(n, 2);
  assert.equal(aClosed, true);
  assert.equal(bClosed, true);
  assert.equal(clientCount(), 0);
});
