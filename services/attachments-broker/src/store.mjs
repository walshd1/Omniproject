/**
 * The attachments-broker's blob store. A deliberately tiny filesystem-backed store: bytes live under a
 * single mounted directory (a writable volume), keyed by a flat, path-traversal-safe key. This is the
 * ONE place bytes are held — the gateway stays zero-at-rest and never imports an object-store SDK. A
 * cloud-object-store backend (S3/GCS/Azure) is a later, additive port behind this same interface, exactly
 * as the retention-broker layers its SDK ports; keeping bytes below the seam is the whole point.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";

/** A key is a flat filename token — no separators, no dot-segments — so it can never escape the root. */
const KEY_RE = /^[A-Za-z0-9._-]{1,200}$/;

export class StoreError extends Error {}

/** True when `key` is a safe, flat storage key (no `/`, no `..`, bounded length). */
export function isValidKey(key) {
  return typeof key === "string" && KEY_RE.test(key) && key !== "." && key !== ".." && !key.includes("..");
}

/** Lowercase hex SHA-256 of a buffer — the content fingerprint returned on write. */
export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * A filesystem blob store rooted at `rootDir`. Every method validates the key first, so a caller can
 * never read or write outside the root. Returns `null`/`false` for a missing blob rather than throwing.
 */
export function createFsStore(rootDir) {
  const pathOf = (key) => {
    if (!isValidKey(key)) throw new StoreError("invalid key");
    return join(rootDir, key);
  };
  return {
    /** Write `buf` under `key`; returns `{ key, size, sha256 }`. */
    async put(key, buf) {
      const p = pathOf(key);
      await mkdir(rootDir, { recursive: true });
      await writeFile(p, buf, { flag: "w" });
      return { key, size: buf.length, sha256: sha256Hex(buf) };
    },
    /** Read the blob at `key`, or `null` if it does not exist. */
    async get(key) {
      const p = pathOf(key);
      try {
        return await readFile(p);
      } catch (e) {
        if (e && e.code === "ENOENT") return null;
        throw e;
      }
    },
    /** True iff a blob exists at `key`. */
    async has(key) {
      const p = pathOf(key);
      try {
        const s = await stat(p);
        return s.isFile();
      } catch {
        return false;
      }
    },
    /** Size in bytes of the blob at `key`, or null if it doesn't exist. */
    async size(key) {
      const p = pathOf(key);
      try {
        const s = await stat(p);
        return s.isFile() ? s.size : null;
      } catch {
        return null;
      }
    },
    /** Delete the blob at `key`; returns true iff one was removed. */
    async del(key) {
      const p = pathOf(key);
      try {
        await unlink(p);
        return true;
      } catch (e) {
        if (e && e.code === "ENOENT") return false;
        throw e;
      }
    },
  };
}
