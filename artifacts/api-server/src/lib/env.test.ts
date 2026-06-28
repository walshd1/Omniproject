import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { envFlag } from "./env";

afterEach(() => { delete process.env["X_FLAG"]; });

test("envFlag is true for 1/true/on/yes (case-insensitive), false otherwise", () => {
  for (const v of ["1", "true", "TRUE", "on", "On", "yes", " yes "]) {
    process.env["X_FLAG"] = v;
    assert.equal(envFlag("X_FLAG"), true, v);
  }
  for (const v of ["0", "false", "off", "no", "", "maybe"]) {
    process.env["X_FLAG"] = v;
    assert.equal(envFlag("X_FLAG"), false, v);
  }
});

test("envFlag is false when the var is unset", () => {
  assert.equal(envFlag("X_FLAG"), false);
});
