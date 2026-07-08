import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkFiles } from "./walk-files";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "walk-files-"));
  fs.mkdirSync(path.join(root, "nested/deep"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.ts"), "");
  fs.writeFileSync(path.join(root, "a.test.ts"), "");
  fs.writeFileSync(path.join(root, "b.js"), "");
  fs.writeFileSync(path.join(root, "nested/c.ts"), "");
  fs.writeFileSync(path.join(root, "nested/deep/d.ts"), "");
  fs.writeFileSync(path.join(root, "nested/deep/e.spec.ts"), "");
  return root;
}

test("walkFiles returns [] for a missing directory", () => {
  assert.deepEqual(walkFiles(path.join(os.tmpdir(), "definitely-not-here-xyz"), { extensions: [".ts"] }), []);
});

test("walkFiles recurses depth-first and filters by extension", () => {
  const root = fixture();
  try {
    const found = walkFiles(root, { extensions: [".ts"] }).map((f) => path.relative(root, f)).sort();
    assert.deepEqual(found, ["a.test.ts", "a.ts", "nested/c.ts", "nested/deep/d.ts", "nested/deep/e.spec.ts"].sort());
    // the .js file is excluded by extension.
    assert.ok(!found.some((f) => f.endsWith(".js")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("walkFiles honours excludeSuffixes", () => {
  const root = fixture();
  try {
    const found = walkFiles(root, { extensions: [".ts"], excludeSuffixes: [".test.ts", ".spec.ts"] })
      .map((f) => path.relative(root, f))
      .sort();
    assert.deepEqual(found, ["a.ts", "nested/c.ts", "nested/deep/d.ts"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("walkFiles supports multiple extensions", () => {
  const root = fixture();
  try {
    const found = walkFiles(root, { extensions: [".ts", ".js"] }).map((f) => path.basename(f));
    assert.ok(found.includes("b.js"));
    assert.ok(found.includes("a.ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
