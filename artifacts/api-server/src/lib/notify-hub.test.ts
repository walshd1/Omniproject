import { test } from "node:test";
import assert from "node:assert/strict";
import { canAddClient, addClient, deliverLocal, type NotifyClient } from "./notify-hub";
import { sanitizeNotificationPrefs } from "@workspace/backend-catalogue";

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

/** Register a client that records every notification it receives; returns the sink + an unsubscribe. */
function recordingClient(over: Partial<NotifyClient> = {}) {
  const got: unknown[] = [];
  const remove = addClient({
    id: `c-${got.length}`, sub: "user:alice", roles: ["contributor"],
    send: (_event, data) => { got.push(data); },
    ...over,
  });
  return { got, remove };
}

test("deliverLocal honours a client's in-app notification prefs (muted kind is dropped)", () => {
  const c = recordingClient({ notifyPrefs: sanitizeNotificationPrefs({ mutedKinds: ["mention"] }) });
  try {
    assert.equal(deliverLocal({ kind: "mention", title: "x" }), 0);         // muted ⇒ not delivered
    assert.equal(deliverLocal({ kind: "assignment", title: "y" }), 1);      // other kind ⇒ delivered
    assert.deepEqual(c.got, [{ kind: "assignment", title: "y" }]);
  } finally { c.remove(); }
});

test("deliverLocal never suppresses a critical kind even when the in-app channel is off", () => {
  const c = recordingClient({ notifyPrefs: sanitizeNotificationPrefs({ channels: { inApp: false } }) });
  try {
    assert.equal(deliverLocal({ kind: "assignment", title: "muted" }), 0);  // in-app off ⇒ dropped
    assert.equal(deliverLocal({ kind: "incident", title: "page" }), 1);     // critical ⇒ always delivered
    assert.deepEqual(c.got, [{ kind: "incident", title: "page" }]);
  } finally { c.remove(); }
});

test("deliverLocal delivers everything to a client with no prefs snapshot (default-on)", () => {
  const c = recordingClient();
  try {
    assert.equal(deliverLocal({ kind: "mention", title: "z" }), 1);
  } finally { c.remove(); }
});
