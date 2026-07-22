import { test } from "node:test";
import assert from "node:assert/strict";
import { canAddClient } from "./notify-hub";

/**
 * The per-principal SSE stream cap. Regression for the red-team finding: a subless principal (a read-only
 * API/BI token has no session `sub`) used to be EXEMPTED from the cap (`if (!sub) return true`), so one token
 * could hold unbounded SSE sockets (FD/timer exhaustion). It must be REFUSED instead — the SSE routes also
 * reject subless callers with a 403 up front.
 */

test("canAddClient refuses a subless principal (the cap can't be bypassed via an API token)", () => {
  assert.equal(canAddClient(undefined), false);
  assert.equal(canAddClient(""), false);
});

test("canAddClient admits a real principal while under the per-sub cap", () => {
  assert.equal(canAddClient("user:alice"), true); // no streams held yet ⇒ under the cap
});
