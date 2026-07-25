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

test("the sealed file lands 0600 (not world-readable) — encrypted, but no needless exposure on a shared host", () => {
  const p = tmpPath();
  const sf = new SealedFile(() => p, "test");
  sf.write(JSON.stringify({ secret: "x" }));
  const mode = fs.statSync(p).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
});

test("write is atomic: leaves no temp file behind and the target is the fully-sealed content", () => {
  const p = tmpPath();
  const dir = path.dirname(p);
  const sf = new SealedFile(() => p, "test");
  const before = new Set(fs.readdirSync(dir));
  sf.write(JSON.stringify({ hello: "world" }));
  // No orphaned "<file>.<pid>.<ts>.tmp" sibling remains (the rename consumed it).
  const leaked = fs.readdirSync(dir).filter((n) => !before.has(n) && n !== path.basename(p) && n.startsWith(path.basename(p)));
  assert.deepEqual(leaked, [], `unexpected temp files left behind: ${leaked.join(", ")}`);
  assert.deepEqual(JSON.parse(sf.read()!), { hello: "world" });
  // A second write over an existing file also round-trips (rename-over-existing works).
  sf.write(JSON.stringify({ hello: "again" }));
  assert.deepEqual(JSON.parse(sf.read()!), { hello: "again" });
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

test("write REFUSES to overwrite an existing sealed file that can't be decrypted (no data-loss clobber)", () => {
  const p = tmpPath();
  // Simulate a store sealed under a key we no longer have (wrong/rotated key).
  fs.writeFileSync(p, "c1.1.garbage-that-cannot-decrypt");
  const before = fs.readFileSync(p, "utf8");
  const sf = new SealedFile(() => p, "test");
  // read() surfaces it as null (can't load), but must NOT be treated as empty…
  assert.equal(sf.read(), null);
  // …and a subsequent write must leave the undecryptable ciphertext intact, not seal defaults over it.
  sf.write(JSON.stringify({ n: 1 }));
  assert.equal(fs.readFileSync(p, "utf8"), before);
});
