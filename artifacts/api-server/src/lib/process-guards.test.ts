import { test } from "node:test";
import assert from "node:assert/strict";
import { onUnhandledRejection, onUncaughtException, installProcessGuards } from "./process-guards";

/**
 * The process crash backstop. We test the handler bodies directly and verify installation registers
 * listeners — we do NOT `process.emit("uncaughtException", …)`, which would collide with node:test's own
 * uncaughtException handling. The point proven: an escaped throw / unhandled rejection is LOGGED and the
 * handler returns normally (process survives) instead of terminating.
 */

function mockLogger() {
  const calls: Array<{ obj: unknown; msg?: string | undefined }> = [];
  return { calls, error: (obj: unknown, msg?: string) => { calls.push({ obj, msg }); } };
}

test("the handlers log and never rethrow (an escaped throw is survived, not fatal)", () => {
  const l = mockLogger();
  assert.doesNotThrow(() => onUncaughtException(l)(new Error("boom")));
  assert.doesNotThrow(() => onUnhandledRejection(l)("rejected with a string"));
  assert.equal(l.calls.length, 2);
});

test("installProcessGuards registers one listener each and is idempotent (re-install replaces, not stacks)", () => {
  const l = mockLogger();
  const excBefore = process.listenerCount("uncaughtException");
  const rejBefore = process.listenerCount("unhandledRejection");
  try {
    installProcessGuards(l);
    assert.equal(process.listenerCount("uncaughtException"), excBefore + 1);
    assert.equal(process.listenerCount("unhandledRejection"), rejBefore + 1);

    // Invoke the registered uncaughtException listener directly: it must log and return (keep alive).
    const exc = process.listeners("uncaughtException").at(-1) as (e: unknown) => void;
    assert.doesNotThrow(() => exc(new Error("x")));
    assert.ok(l.calls.length >= 1);

    installProcessGuards(l); // idempotent
    assert.equal(process.listenerCount("uncaughtException"), excBefore + 1, "re-install must not stack listeners");
    assert.equal(process.listenerCount("unhandledRejection"), rejBefore + 1);
  } finally {
    // Restore the process listener set so we don't swallow a later test file's uncaughtException.
    for (const h of process.listeners("uncaughtException").slice(excBefore)) process.off("uncaughtException", h as never);
    for (const h of process.listeners("unhandledRejection").slice(rejBefore)) process.off("unhandledRejection", h as never);
  }
});
