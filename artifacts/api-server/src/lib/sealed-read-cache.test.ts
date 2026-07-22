import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { cachedDecryptedRead, sealedReadCacheEnabled, _resetSealedReadCache } = await import("./sealed-read-cache");

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sealed-read-cache-"));
const file = path.join(DIR, "collection.sealed");

beforeEach(() => { _resetSealedReadCache(); delete process.env["SEALED_READ_CACHE"]; });
afterEach(() => { _resetSealedReadCache(); delete process.env["SEALED_READ_CACHE"]; });

/** Write `content` and stamp a distinct mtime so tests don't depend on wall-clock resolution. */
function writeFile(content: string, mtimeEpochS: number): void {
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtimeEpochS, mtimeEpochS);
}

test("disabled by default: always calls through, never caches", () => {
  writeFile("v1", 1_000);
  let calls = 0;
  const read = () => { calls++; return "decrypted-v1"; };
  assert.equal(sealedReadCacheEnabled(), false);
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");
  assert.equal(calls, 2, "every call is a live read when the cache is off");
});

test("enabled: a hot read is served from cache (one decrypt), unchanged file", () => {
  process.env["SEALED_READ_CACHE"] = "true";
  writeFile("ciphertext-v1", 1_000);
  let calls = 0;
  const read = () => { calls++; return "decrypted-v1"; };
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");
  assert.equal(calls, 1, "the sealed read/decrypt ran exactly once");
});

test("self-invalidates on write: a new mtime is a miss (never serves stale)", () => {
  process.env["SEALED_READ_CACHE"] = "true";
  writeFile("ciphertext-v1", 1_000);
  let version = "decrypted-v1";
  const read = () => version;
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v1");

  // Simulate a write: new contents + new mtime (mirrors the atomic temp→rename bumping mtime).
  version = "decrypted-v2";
  writeFile("ciphertext-v2-longer", 2_000);
  assert.equal(cachedDecryptedRead(file, read), "decrypted-v2", "the changed file is re-read, not served stale");
});

test("same mtime but different size is a miss (size is part of the key)", () => {
  process.env["SEALED_READ_CACHE"] = "true";
  writeFile("aaaa", 1_000);
  let version = "decrypted-A";
  const read = () => version;
  assert.equal(cachedDecryptedRead(file, read), "decrypted-A");
  version = "decrypted-B";
  writeFile("aaaaaaaa", 1_000); // same mtime, larger size
  assert.equal(cachedDecryptedRead(file, read), "decrypted-B");
});

test("absent/unreadable file: falls through to the live read and is not cached", () => {
  process.env["SEALED_READ_CACHE"] = "true";
  const missing = path.join(DIR, "does-not-exist.sealed");
  let calls = 0;
  const read = () => { calls++; return null; };
  assert.equal(cachedDecryptedRead(missing, read), null);
  assert.equal(cachedDecryptedRead(missing, read), null);
  assert.equal(calls, 2, "a stat failure always does a live (uncached) read");
});

test("on a miss, a null decrypt (undecryptable) is passed through and never cached", () => {
  process.env["SEALED_READ_CACHE"] = "true";
  writeFile("ciphertext-v1", 1_000);
  assert.equal(cachedDecryptedRead(file, () => "decrypted-v1"), "decrypted-v1"); // seed the cache

  // A write changes the file (new mtime + size) → a miss; the fresh read now returns null (e.g. the file was
  // replaced by ciphertext the current key can't open). It must pass through and drop the stale entry, so a
  // repeat read stays a live read rather than resurrecting the old plaintext.
  writeFile("ciphertext-v2-unopenable", 2_000);
  let calls = 0;
  const read = () => { calls++; return null; };
  assert.equal(cachedDecryptedRead(file, read), null);
  assert.equal(cachedDecryptedRead(file, read), null);
  assert.equal(calls, 2, "an undecryptable read is never cached (no stale plaintext resurrected)");
});

test("an unchanged file is served from cache even mid-rotation (process-local, opt-in staleness)", () => {
  // Documents the deliberate bound: the key is the file's stat, so if the ON-DISK bytes don't change the
  // cached plaintext is served for this process's lifetime. Key rotation without a file rewrite is a
  // restart-level event; the cache is process-local and opt-in, so this staleness window is acceptable.
  process.env["SEALED_READ_CACHE"] = "true";
  writeFile("ciphertext-v1", 1_000);
  let calls = 0;
  assert.equal(cachedDecryptedRead(file, () => { calls++; return "decrypted-v1"; }), "decrypted-v1");
  assert.equal(cachedDecryptedRead(file, () => { calls++; return null; }), "decrypted-v1", "unchanged stat → cache hit, read fn not consulted");
  assert.equal(calls, 1);
});
