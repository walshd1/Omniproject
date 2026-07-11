import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOptionalDependency } from "./optional-dependency";

/**
 * Runtime-optional dependency loader: import by variable specifier, extract, and degrade to
 * null (with one warning) on absence or a null/undefined extraction.
 */

test("returns the extracted value when the package loads", async () => {
  const sep = await loadOptionalDependency<string>("node:path", (mod) => (mod as { sep: string }).sep, "missing path");
  assert.equal(sep, "/");
});

test("returns null when the package cannot be imported", async () => {
  const value = await loadOptionalDependency<unknown>(
    "this-package-does-not-exist-omni-xyz",
    (mod) => mod,
    "optional dep absent",
  );
  assert.equal(value, null);
});

test("returns null when the extractor yields null", async () => {
  const value = await loadOptionalDependency<unknown>("node:path", () => null, "extractor null");
  assert.equal(value, null);
});

test("returns null when the extractor yields undefined", async () => {
  const value = await loadOptionalDependency<unknown>("node:path", () => undefined, "extractor undefined");
  assert.equal(value, null);
});
