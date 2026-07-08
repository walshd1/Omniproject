import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fsProbes, idsFromAssets } from "./coverage";

/** Exercises the fs-backed helpers in coverage.ts (fsProbes / idsFromAssets),
 *  which the pure checkCoverage tests in coverage.test.ts don't touch. */

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("fsProbes wires component existence, page wiring, and test presence to the real tree", () => {
  const dir = tmp("cov-dir-");
  const pageFile = path.join(tmp("cov-page-"), "Page.tsx");
  try {
    fs.writeFileSync(path.join(dir, "WidgetA.tsx"), "export const WidgetA = () => null;");
    fs.writeFileSync(path.join(dir, "WidgetA.test.tsx"), "import { WidgetA } from './WidgetA';");
    fs.writeFileSync(pageFile, "import { WidgetA } from './WidgetA';\n<WidgetA />");

    const probes = fsProbes(dir, pageFile);
    assert.equal(probes.componentExists("WidgetA"), true);
    assert.equal(probes.componentExists("Missing"), false);
    assert.equal(probes.wiredInPage("WidgetA"), true);
    assert.equal(probes.wiredInPage("Nope"), false);
    assert.equal(probes.hasTest("WidgetA"), true);
    assert.equal(probes.hasTest("Untested"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(pageFile), { recursive: true, force: true });
  }
});

test("fsProbes degrades gracefully when the dir and page file don't exist", () => {
  const probes = fsProbes(path.join(os.tmpdir(), "no-such-dir-abc"), path.join(os.tmpdir(), "no-such-page.tsx"));
  assert.equal(probes.componentExists("Anything"), false);
  assert.equal(probes.wiredInPage("Anything"), false);
  assert.equal(probes.hasTest("Anything"), false);
});

test("idsFromAssets lists sorted json basenames and ignores non-json", () => {
  const dir = tmp("cov-assets-");
  try {
    fs.writeFileSync(path.join(dir, "beta.json"), "{}");
    fs.writeFileSync(path.join(dir, "alpha.json"), "{}");
    fs.writeFileSync(path.join(dir, "README.md"), "");
    assert.deepEqual(idsFromAssets(dir), ["alpha", "beta"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("idsFromAssets returns [] for a missing dir", () => {
  assert.deepEqual(idsFromAssets(path.join(os.tmpdir(), "no-assets-here-xyz")), []);
});
