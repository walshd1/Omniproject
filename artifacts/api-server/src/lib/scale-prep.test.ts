import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithTiming, addUpstreamMs, getUpstreamMs } from "./request-timing";
import { ReadCache } from "./read-cache";

test("request-timing: accumulates upstream ms within a context", () => {
  runWithTiming(() => {
    assert.equal(getUpstreamMs(), 0);
    addUpstreamMs(40);
    addUpstreamMs(60);
    assert.equal(getUpstreamMs(), 100);
  });
});

test("request-timing: contexts are isolated and ignore bad values", () => {
  runWithTiming(() => {
    addUpstreamMs(10);
    addUpstreamMs(-5); // ignored
    addUpstreamMs(NaN); // ignored
    assert.equal(getUpstreamMs(), 10);
  });
  // A second context starts fresh.
  runWithTiming(() => assert.equal(getUpstreamMs(), 0));
});

test("request-timing: adding outside a context is a harmless no-op", () => {
  addUpstreamMs(99); // no context → no throw
  assert.equal(getUpstreamMs(), 0);
});

test("read-cache: disabled (ttl 0) is a transparent pass-through", async () => {
  const c = new ReadCache(0);
  assert.equal(c.enabled(), false);
  let calls = 0;
  const r1 = await c.wrap("k", async () => { calls++; return calls; });
  const r2 = await c.wrap("k", async () => { calls++; return calls; });
  assert.equal(r1, 1);
  assert.equal(r2, 2); // not cached — fn ran again
  assert.equal(c.get("k"), undefined);
});

test("read-cache: enabled caches within the TTL and expires after", async () => {
  const c = new ReadCache(1000);
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  assert.equal(await c.wrap("k", fn), 1);
  assert.equal(await c.wrap("k", fn), 1); // cached — fn did NOT run again
  assert.equal(calls, 1);
  // Expiry honoured via injectable now().
  c.set("t", "v", 0);
  assert.equal(c.get("t", 500), "v"); // within ttl
  assert.equal(c.get("t", 1500), undefined); // expired
});
