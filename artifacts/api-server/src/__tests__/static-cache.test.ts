import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Static-asset caching: content-hashed assets are immutable (cache forever); the
 * shell entrypoints (index.html, the service worker) always revalidate so a new
 * deploy is picked up at once. Proven against the real Express app in omni-shell mode.
 */
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;
let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-static-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>OmniProject</title>");
  fs.writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "sw.js"), "/* sw */");
  process.env["STATIC_DIR"] = dir;

  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("hashed assets are cached immutably for a year", async () => {
  const res = await fetch(`${base}/assets/index-abc123.js`);
  assert.equal(res.status, 200);
  const cc = res.headers.get("cache-control") ?? "";
  assert.match(cc, /max-age=31536000/);
  assert.match(cc, /immutable/);
});

test("index.html and the service worker always revalidate", async () => {
  for (const p of ["/index.html", "/sw.js"]) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} → ${res.status}`);
    assert.match(res.headers.get("cache-control") ?? "", /no-cache/, `${p} should be no-cache`);
  }
});

test("the SPA history fallback serves a no-cache index.html", async () => {
  const res = await fetch(`${base}/programmes/some-deep-link`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-cache/);
});
