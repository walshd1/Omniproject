import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveState, loadState, type DemoState } from "./dev-persist";

/** Dev-only stateful persistence — pure save/load helpers over a JSON file. */
const tmpFiles: string[] = [];
function tmp(): string {
  const f = path.join(os.tmpdir(), `omni-dev-persist-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

const state: DemoState = {
  projects: [{ id: "p1" }],
  issues: { p1: [{ id: "i1" }] },
  raid: { p1: [{ id: "r1" }] },
};

test("saveState → loadState round-trips the demo state", () => {
  const f = tmp();
  saveState(f, state);
  assert.deepEqual(loadState(f), state);
});

test("saveState writes atomically (no leftover temp file)", () => {
  const f = tmp();
  saveState(f, state);
  assert.equal(fs.existsSync(`${f}.${process.pid}.tmp`), false);
});

test("loadState returns null when the file does not exist", () => {
  assert.equal(loadState(path.join(os.tmpdir(), "does-not-exist-omni.json")), null);
});

test("loadState returns null on malformed JSON", () => {
  const f = tmp();
  fs.writeFileSync(f, "{ not valid json");
  assert.equal(loadState(f), null);
});

test("loadState returns null when projects isn't an array", () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ projects: "nope" }));
  assert.equal(loadState(f), null);
});

test("loadState defaults issues/raid to empty objects when missing or wrong-typed", () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ projects: [{ id: "p1" }], issues: "bad", raid: 42 }));
  assert.deepEqual(loadState(f), { projects: [{ id: "p1" }], issues: {}, raid: {} });
});

test("loadState keeps well-formed issues/raid maps", () => {
  const f = tmp();
  fs.writeFileSync(f, JSON.stringify({ projects: [], issues: { a: [] }, raid: { b: [] } }));
  assert.deepEqual(loadState(f), { projects: [], issues: { a: [] }, raid: { b: [] } });
});
