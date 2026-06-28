import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTraceparent, formatTraceparent, currentTraceparent } from "./tracing";

/**
 * W3C trace context parsing/formatting + AsyncLocalStorage propagation.
 */
test("parseTraceparent accepts a valid header and rejects malformed/zero ones", () => {
  const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const parsed = parseTraceparent(tp);
  assert.equal(parsed?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(parsed?.spanId, "00f067aa0ba902b7");
  assert.equal(parsed?.sampled, true);

  assert.equal(parseTraceparent(undefined), null);
  assert.equal(parseTraceparent("garbage"), null);
  // all-zero trace id is invalid per spec
  assert.equal(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), null);
  // not-sampled flag
  assert.equal(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")?.sampled, false);
});

test("formatTraceparent round-trips through parseTraceparent", () => {
  const tp = formatTraceparent("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", true);
  assert.equal(tp, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  const parsed = parseTraceparent(tp);
  assert.equal(parsed?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
});

test("currentTraceparent is null outside a request context", () => {
  assert.equal(currentTraceparent(), null);
});
