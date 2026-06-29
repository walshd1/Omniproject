import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SealedFile, resolveConfigFile } from "./sealed-file";

const tmp: string[] = [];
function tmpPath(): string {
  const p = path.join(os.tmpdir(), `sealed-file-test-${tmp.length}-${process.pid}.json`);
  tmp.push(p);
  return p;
}
afterEach(() => {
  for (const p of tmp.splice(0)) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
  for (const k of ["X_FILE", "OMNI_CONFIG_DIR"]) delete process.env[k];
});

test("resolveConfigFile: explicit env wins, else defaultName under OMNI_CONFIG_DIR, else null", () => {
  assert.equal(resolveConfigFile("X_FILE", "x.json"), null); // neither set
  process.env["OMNI_CONFIG_DIR"] = "/cfg";
  assert.equal(resolveConfigFile("X_FILE", "x.json"), path.join("/cfg", "x.json"));
  assert.equal(resolveConfigFile("X_FILE"), null); // no default → null even with dir
  process.env["X_FILE"] = "/explicit/x.json";
  assert.equal(resolveConfigFile("X_FILE", "x.json"), "/explicit/x.json"); // explicit wins
});

test("write then read round-trips through the seal", () => {
  const p = tmpPath();
  const sf = new SealedFile(() => p, "test");
  assert.equal(sf.enabled, true);
  sf.write(JSON.stringify({ hello: "world" }));
  assert.deepEqual(JSON.parse(sf.read()!), { hello: "world" });
});

test("read returns null when persistence is off or the file is absent", () => {
  assert.equal(new SealedFile(() => null, "off").read(), null);
  assert.equal(new SealedFile(() => tmpPath(), "missing").read(), null); // path resolves but no file yet
  assert.equal(new SealedFile(() => null, "off").enabled, false);
});

test("loadOnce applies once, reset re-arms it", () => {
  const p = tmpPath();
  const sf = new SealedFile(() => p, "test");
  sf.write(JSON.stringify({ n: 1 }));
  let calls = 0;
  const apply = (raw: string) => { calls += 1; assert.equal((JSON.parse(raw) as { n: number }).n, 1); };
  sf.loadOnce(apply);
  sf.loadOnce(apply); // no-op
  assert.equal(calls, 1);
  sf.reset();
  sf.loadOnce(apply);
  assert.equal(calls, 2);
});

test("loadOnce swallows a parse error (keeps defaults)", () => {
  const p = tmpPath();
  fs.writeFileSync(p, "not json at all");
  const sf = new SealedFile(() => p, "test");
  assert.doesNotThrow(() => sf.loadOnce((raw) => { JSON.parse(raw); }));
});

test("write is a no-op when persistence is off", () => {
  assert.doesNotThrow(() => new SealedFile(() => null, "off").write("{}"));
});
