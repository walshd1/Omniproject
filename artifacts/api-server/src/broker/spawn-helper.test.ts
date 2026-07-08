import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Test-only helper (not a source module — this is a `*.test.ts` so it is excluded
 * from coverage). Several CLI/entrypoint suites cover their target by spawning it
 * as a subprocess. Under `c8` those grandchildren inherit `NODE_V8_COVERAGE` and
 * write coverage files into c8's shared temp dir; spawning many short-lived ones
 * there risks pid+timestamp filename collisions that clobber a sibling test file's
 * coverage (making coverage flaky/low).
 *
 * `spawnNode` avoids that: it points each child at its OWN coverage dir, then copies
 * the child's coverage files back into c8's dir under a collision-proof unique name.
 * When coverage isn't being collected (plain `pnpm test`), it's a plain spawnSync.
 */
export function spawnNode(args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  const c8Dir = process.env["NODE_V8_COVERAGE"];
  const childDir = c8Dir ? mkdtempSync(join(tmpdir(), "omni-child-cov-")) : undefined;
  const childEnv: Record<string, string> = { ...env };
  if (childDir) childEnv["NODE_V8_COVERAGE"] = childDir;

  const res = spawnSync(process.execPath, args, { encoding: "utf8", env: childEnv });

  if (childDir && c8Dir && existsSync(childDir)) {
    for (const f of readdirSync(childDir)) {
      if (f.endsWith(".json")) copyFileSync(join(childDir, f), join(c8Dir, `child-${randomUUID()}.json`));
    }
  }
  return res;
}

test("spawnNode runs a node child and captures its stdout", () => {
  const r = spawnNode(["-e", "process.stdout.write('hello-child')"], { ...process.env } as Record<string, string>);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "hello-child");
});
