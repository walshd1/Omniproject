import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  percentile,
  summarise,
  Recorder,
  verdict,
  runPool,
} from "./load-core";

test("classifyStatus buckets by what an operator triages", () => {
  assert.equal(classifyStatus(200), "ok");
  assert.equal(classifyStatus(204), "ok");
  assert.equal(classifyStatus(302), "ok");
  assert.equal(classifyStatus(404), "client_error");
  assert.equal(classifyStatus(401), "client_error");
  assert.equal(classifyStatus(500), "server_error");
  assert.equal(classifyStatus(502), "server_error");
  assert.equal(classifyStatus(null), "network");
  assert.equal(classifyStatus(undefined), "network");
});

test("percentile uses nearest-rank and clamps", () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 90), 9);
  assert.equal(percentile(s, 99), 10);
  assert.equal(percentile(s, 100), 10);
  assert.equal(percentile([], 50), 0);
});

test("summarise computes count/min/mean/percentiles/max", () => {
  const s = summarise([10, 20, 30, 40]);
  assert.equal(s.count, 4);
  assert.equal(s.min, 10);
  assert.equal(s.max, 40);
  assert.equal(s.mean, 25);
  assert.equal(s.p50, 20);
  assert.equal(summarise([]).count, 0);
});

test("Recorder folds per-op + overall, with error rates", () => {
  const r = new Recorder();
  r.record("read", 10, "ok");
  r.record("read", 20, "ok");
  r.record("write", 100, "ok");
  r.record("write", 100, "server_error");
  const rep = r.report();
  assert.equal(rep.total, 4);
  const read = rep.ops.find((o) => o.op === "read")!;
  assert.equal(read.errorRate, 0);
  assert.equal(read.latency.count, 2);
  const write = rep.ops.find((o) => o.op === "write")!;
  assert.equal(write.errorRate, 0.5); // 1 of 2 failed
  assert.equal(write.categories.server_error, 1);
  assert.equal(rep.overall.errorRate, 0.25); // 1 of 4
});

test("verdict fails on error rate and p99 budget", () => {
  const r = new Recorder();
  for (let i = 0; i < 99; i++) r.record("read", 10, "ok");
  r.record("read", 5000, "server_error");
  const rep = r.report();
  const pass = verdict(rep, { maxErrorRate: 0.05 });
  assert.equal(pass.pass, true); // 1% ≤ 5%
  const failRate = verdict(rep, { maxErrorRate: 0.005 });
  assert.equal(failRate.pass, false);
  assert.match(failRate.reasons[0]!, /error rate/);
  // p99 of this set is 10ms (the lone 5000ms outlier sits at p100), so a 5ms
  // budget catches the bulk latency.
  const failP99 = verdict(rep, { maxErrorRate: 1, maxP99Ms: 5 });
  assert.equal(failP99.pass, false);
  assert.match(failP99.reasons[0]!, /p99/);
});

test("verdict fails when nothing was recorded", () => {
  const v = verdict(new Recorder().report(), { maxErrorRate: 1 });
  assert.equal(v.pass, false);
  assert.match(v.reasons[0]!, /no requests/);
});

test("runPool runs every thunk and never exceeds the concurrency cap", async () => {
  let inflight = 0;
  let peak = 0;
  let done = 0;
  const thunks = Array.from({ length: 50 }, () => async () => {
    inflight++;
    peak = Math.max(peak, inflight);
    await Promise.resolve();
    await Promise.resolve();
    done++;
    inflight--;
  });
  await runPool(thunks, 8);
  assert.equal(done, 50);
  assert.ok(peak <= 8, `peak concurrency ${peak} exceeded cap 8`);
  assert.ok(peak > 1, "should actually run concurrently");
});

test("runPool isolates a throwing thunk", async () => {
  let done = 0;
  const thunks = [
    async () => { throw new Error("boom"); },
    async () => { done++; },
    async () => { done++; },
  ];
  await runPool(thunks, 2);
  assert.equal(done, 2); // the throw didn't kill the pool
});
