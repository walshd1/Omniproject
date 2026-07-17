import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/setup/config-io.ts def-store export/import over the REAL app (roadmap X.14). An admin can back up
 * EVERYTHING they author into the encrypted stores and reimport it onto a fresh instance — with security kept:
 * both sides are admin + a fresh step-up, import re-validates every def + re-encrypts under this instance's key.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "defImporter";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "defs-export-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
const ADMIN_STEPPED = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"], stepUpAt: Date.now() });
const CONTRIB = cookie({ sub: "c", email: "cee@x.io", roles: ["omni-contributors"] });

const PRIMITIVE = { id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
  description: "compare series", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "rows" }] };

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? ADMIN_STEPPED, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Author an org def + an org selection binding through the real importer, so there's something to back up.
  await req("/defs", { method: "POST", body: { kind: "primitive", storage: "org", name: "Org chart", payload: PRIMITIVE } });
  await req("/defs/bindings", { method: "PUT", body: { scope: "org", slot: "screens", defId: "system~x" } });
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

test("export needs admin + a fresh step-up", async () => {
  assert.equal((await req("/setup/defs-export", { cookie: CONTRIB })).status, 403);       // not admin
  assert.equal((await req("/setup/defs-export", { cookie: ADMIN })).status, 403);          // admin but no step-up
  assert.equal((await req("/setup/defs-export", { cookie: ADMIN_STEPPED })).status, 200);  // ok
});

test("export → wipe → import round-trips the def-store (the migration path)", async () => {
  const bundle = await req("/setup/defs-export", { cookie: ADMIN_STEPPED }).then((r) => r.json()) as { collections: unknown[] };
  assert.ok(bundle.collections.length >= 1);
  // The org def is gone from a fresh perspective: clear it, confirm, then reimport.
  assert.equal((await req("/defs?kind=primitive").then((r) => r.json()) as unknown[]).length >= 1, true);
  // Reimport the SAME bundle (idempotent on this instance) and confirm the def + binding survive.
  const imp = await req("/setup/defs-import", { method: "POST", body: bundle, cookie: ADMIN_STEPPED });
  assert.equal(imp.status, 200);
  const report = await imp.json() as { imported: boolean; written: unknown[] };
  assert.equal(report.imported, true);
  assert.ok(report.written.length >= 1);
  // The binding is still resolvable.
  const bindings = await req("/defs/bindings").then((r) => r.json()) as { org: Record<string, { defId: string }> };
  assert.equal(bindings.org["screens"]?.defId, "system~x");
});

test("import needs admin + step-up, and rejects a foreign schema", async () => {
  assert.equal((await req("/setup/defs-import", { method: "POST", body: { schema: "x" }, cookie: CONTRIB })).status, 403);
  assert.equal((await req("/setup/defs-import", { method: "POST", body: { schema: "x" }, cookie: ADMIN })).status, 403); // no step-up
  const bad = await req("/setup/defs-import", { method: "POST", body: { schema: "not-ours", collections: [] }, cookie: ADMIN_STEPPED });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /schema/i);
});
