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
    // A real test: imports AND renders the component inside a render/expect call.
    fs.writeFileSync(path.join(dir, "WidgetA.test.tsx"), "import { WidgetA } from './WidgetA';\nrender(<WidgetA />);\nexpect(screen.getByTestId('a')).toBeTruthy();");
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

test("fsProbes does NOT count a name that only appears in an import or a comment", () => {
  const dir = tmp("cov-imp-");
  const pageFile = path.join(tmp("cov-imp-page-"), "Page.tsx");
  try {
    fs.writeFileSync(path.join(dir, "Ghost.tsx"), "export const Ghost = () => null;");
    // Imported and mentioned in a comment, but never rendered/registered → not wired.
    fs.writeFileSync(pageFile, "import { Ghost } from './Ghost';\n// TODO: wire up Ghost here\nexport const Page = () => null;");
    // A test that imports the component but never renders/asserts on it → not a real test.
    fs.writeFileSync(path.join(dir, "Ghost.test.tsx"), "import { Ghost } from './Ghost';\n// Ghost is a placeholder\nit('todo', () => {});");

    const probes = fsProbes(dir, pageFile);
    assert.equal(probes.wiredInPage("Ghost"), false);
    assert.equal(probes.hasTest("Ghost"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(pageFile), { recursive: true, force: true });
  }
});

test("fsProbes counts a component wired via an object-shorthand REGISTRY across MULTIPLE sources", () => {
  const dir = tmp("cov-reg-");
  const pageDir = tmp("cov-reg-page-");
  const pageFile = path.join(pageDir, "Page.tsx");
  const registryFile = path.join(dir, "renderers.ts");
  try {
    for (const c of ["Alpha", "Beta", "Gamma"]) {
      fs.writeFileSync(path.join(dir, `${c}.tsx`), `export const ${c} = () => null;`);
    }
    // The page renders NONE of them directly (post-"remove hardcoded JSX" refactor)…
    fs.writeFileSync(pageFile, "export const Page = () => null;");
    // …they're wired via a Record<string, Component> registry using object SHORTHAND (bare `Comp,`).
    fs.writeFileSync(
      registryFile,
      "import { Alpha } from './Alpha';\nimport { Beta } from './Beta';\nimport { Gamma } from './Gamma';\n" +
        "export const RENDERERS = {\n  Alpha,\n  Beta,\n  Gamma,\n};",
    );

    // Probe BOTH the page and the registry: shorthand registration counts as wired.
    const probes = fsProbes(dir, [pageFile, registryFile]);
    assert.equal(probes.wiredInPage("Alpha"), true);
    assert.equal(probes.wiredInPage("Beta"), true);
    assert.equal(probes.wiredInPage("Gamma"), true);
    // A component that exists but is NOT registered anywhere is still (correctly) not wired.
    fs.writeFileSync(path.join(dir, "Orphan.tsx"), "export const Orphan = () => null;");
    assert.equal(probes.wiredInPage("Orphan"), false);
    // A bare mention that ISN'T an object entry (only imported) still doesn't count (imports stripped).
    assert.equal(probes.wiredInPage("Nope"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(pageDir, { recursive: true, force: true });
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
