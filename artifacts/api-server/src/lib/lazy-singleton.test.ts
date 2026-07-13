import { test } from "node:test";
import assert from "node:assert/strict";
import { lazySingleton } from "./lazy-singleton";

test("builds at most once and memoizes", () => {
  let calls = 0;
  const s = lazySingleton(() => ({ n: ++calls }));
  assert.equal(s.get().n, 1);
  assert.equal(s.get().n, 1, "second get returns the same instance");
  assert.equal(calls, 1, "factory ran exactly once");
});

test("peek does not build", () => {
  let calls = 0;
  const s = lazySingleton(() => ++calls);
  assert.equal(s.peek(), null, "null before first get");
  assert.equal(calls, 0, "peek did not run the factory");
  s.get();
  assert.equal(s.peek(), 1);
});

test("reset() drops the instance so the next get rebuilds", () => {
  let calls = 0;
  const s = lazySingleton(() => ++calls);
  assert.equal(s.get(), 1);
  s.reset();
  assert.equal(s.peek(), null);
  assert.equal(s.get(), 2, "rebuilt after reset");
});

test("reset(value) injects a specific instance (test seam)", () => {
  const s = lazySingleton(() => "real");
  s.reset("injected");
  assert.equal(s.peek(), "injected");
  assert.equal(s.get(), "injected", "get returns the injection, factory not called");
});

test("a falsy-but-valid value (0) is still memoized, not rebuilt", () => {
  let calls = 0;
  const s = lazySingleton(() => { calls++; return 0; });
  assert.equal(s.get(), 0);
  assert.equal(s.get(), 0);
  // `??=` treats 0 as present (unlike the old `if (!x)` idiom, which would rebuild on 0).
  assert.equal(calls, 1, "0 is a real memoized value");
});
