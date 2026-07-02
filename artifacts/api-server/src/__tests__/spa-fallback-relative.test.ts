import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * SPA history-fallback with a RELATIVE STATIC_DIR — the exact shape playwright.config.ts and the
 * single-container compose use (STATIC_DIR=artifacts/omniproject/dist/public). In Express 5,
 * `res.sendFile(absolutePathResolvedFromARelativeBase)` rejects with a "Not Found" (404) for every
 * client-side deep link (e.g. /login), silently breaking the whole SPA behind a 404. The fallback
 * must use the `{ root }` form so deep links serve the shell. This guards that regression — the
 * pre-existing static-cache test masked it by using an already-absolute temp dir.
 */
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;
let absDir: string;
let originalCwd: string;

before(async () => {
  originalCwd = process.cwd();
  // A real (absolute) directory on disk...
  absDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-spa-rel-"));
  fs.mkdirSync(path.join(absDir, "public"));
  fs.writeFileSync(path.join(absDir, "public", "index.html"), "<!doctype html><title>OmniProject</title><div id=\"root\"></div>");
  // ...reached via a RELATIVE STATIC_DIR, exactly like the e2e/compose config does.
  process.chdir(absDir);
  process.env["STATIC_DIR"] = "public";

  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  process.chdir(originalCwd);
  fs.rmSync(absDir, { recursive: true, force: true });
});

test("serves the SPA shell (200) for a client-side deep link with a relative STATIC_DIR", async () => {
  for (const p of ["/login", "/projects/proj-001", "/programmes/x"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} → ${res.status} (Express 5 sendFile(abs) regression?)`);
    const body = await res.text();
    assert.match(body, /<div id="root">/, `${p} should serve the SPA shell`);
  }
});

test("does not let the SPA fallback hijack /api routes (no HTML shell for /api)", async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  const body = await res.text();
  // The fallback must skip /api (it calls next()), so an unmatched API path never returns the
  // SPA shell — it resolves through the API middleware chain (an auth/404/error JSON), not index.html.
  assert.doesNotMatch(body, /<div id="root">/, "the SPA shell must not be served for /api paths");
});
