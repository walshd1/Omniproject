import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/defs.ts over the REAL app (roadmap X.3) — THE definition importer, behind the default-off
 * `defImporter` module. Any user-defined JSON def is validated by kind and sealed into the scope the author
 * chose (user/project/org). We cover: validate dry-run, a user-scope round-trip (sealed at rest), the org
 * target requiring manager+, a bad payload → 400, and RBAC.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "defImporter";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "defs-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"], amr: ["hwk"] });
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? CONTRIBUTOR, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

const PRIMITIVE = {
  id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
  description: "compare series", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "rows" }],
};

test("validate dry-run reports errors without writing", async () => {
  const ok = await req("/defs/validate", { method: "POST", body: { kind: "primitive", payload: PRIMITIVE } });
  assert.deepEqual(await ok.json(), { valid: true, errors: [] });
  const bad = await req("/defs/validate", { method: "POST", body: { kind: "primitive", payload: { id: "Bad Id", params: [] } } });
  const body = (await bad.json()) as { valid: boolean; errors: string[] };
  assert.equal(body.valid, false);
  assert.ok(body.errors.length >= 2);
});

test("user-scope import round-trips and is sealed at rest", async () => {
  const created = await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "My chart", payload: PRIMITIVE } });
  assert.equal(created.status, 201);
  const def = (await created.json()) as { id: string; createdBy: string };
  assert.match(def.id, /^user~/);
  assert.equal(def.createdBy, "cee@x.io");

  // sealed: the payload id must not appear in plaintext on disk.
  const file = path.join(CONFIG_DIR, "artifacts", "def", "user-c.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("grouped-column"), "payload must not be plaintext at rest");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");

  // list omits payload; get returns it.
  const metas = (await req("/defs?kind=primitive").then((x) => x.json())) as Array<{ id: string; payload?: unknown }>;
  const meta = metas.find((m) => m.id === def.id)!;
  assert.equal((meta as { payload?: unknown }).payload, undefined);
  const full = (await req(`/defs/${encodeURIComponent(def.id)}`).then((x) => x.json())) as { payload: { id: string } };
  assert.equal(full.payload.id, "grouped-column");

  // delete.
  assert.equal((await req(`/defs/${encodeURIComponent(def.id)}`, { method: "DELETE" })).status, 204);
});

test("resolve surfaces the SYSTEM defaults (read-only system~ ids) beneath the caller's own defs", async () => {
  const { seedSystemDef } = await import("../lib/def-import");
  // The product's own seeder installs a shipped default into the read-only system store (not the user importer).
  seedSystemDef("dashboard", "Default Exec", { id: "default-exec", name: "Default Exec", widgets: [{ id: "w1", type: "portfolioHealth" }] }, "2026-01-01T00:00:00Z");
  const resolved = (await req("/defs/resolved/dashboard").then((x) => x.json())) as Array<{ id: string; kind: string; createdBy: string | null; payload: { id: string } }>;
  const sys = resolved.find((r) => r.id === "system~default-exec")!;
  assert.ok(sys, "the system default is surfaced through resolve");
  assert.equal(sys.kind, "dashboard");
  assert.equal(sys.createdBy, "system");
  assert.equal(sys.payload.id, "default-exec");
  // The importer can never WRITE the system scope — a shipped default stays read-only (customising it forks).
  assert.equal((await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "system", name: "x", payload: { id: "x", name: "x", widgets: [] } } })).status, 400);
});

test("resolve-by-kind returns full payloads for renderers (X.10 seam), filtered by kind", async () => {
  // Seed a couple of dashboard defs in the caller's own scope.
  const a = await (await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "user", name: "Exec", payload: { id: "exec", name: "Exec", widgets: [{ id: "w1", type: "portfolioHealth" }] } } })).json() as { id: string };
  await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "Other", payload: PRIMITIVE } });

  const resolved = (await req("/defs/resolved/dashboard").then((x) => x.json())) as Array<{ id: string; kind: string; payload: { id: string; widgets: unknown[] } }>;
  const row = resolved.find((r) => r.id === a.id)!;
  assert.equal(row.kind, "dashboard");
  assert.equal(row.payload.id, "exec");                         // full payload, unlike the metadata list
  assert.ok(Array.isArray(row.payload.widgets));
  assert.ok(resolved.every((r) => r.kind === "dashboard"));     // the primitive def is not included

  // A viewer can read the seam; an unknown kind is 400.
  assert.equal((await req("/defs/resolved/dashboard", { cookie: VIEWER })).status, 200);
  assert.equal((await req("/defs/resolved/nope")).status, 400);

  await req(`/defs/${encodeURIComponent(a.id)}`, { method: "DELETE" });
});

test("edit in place: PUT re-validates, bumps rowVersion, and keeps the kind", async () => {
  const created = await (await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "Editable", payload: PRIMITIVE } })).json() as { id: string; rowVersion: number };
  const gid = encodeURIComponent(created.id);
  // A valid edit (rename + new label) succeeds and bumps the version.
  const edited = await req(`/defs/${gid}`, { method: "PUT", body: { name: "Renamed", payload: { ...PRIMITIVE, label: "Renamed columns" } } });
  assert.equal(edited.status, 200);
  const row = (await edited.json()) as { name: string; rowVersion: number; kind: string; payload: { label: string } };
  assert.equal(row.name, "Renamed");
  assert.equal(row.kind, "primitive");
  assert.equal(row.rowVersion, created.rowVersion + 1);
  assert.equal(row.payload.label, "Renamed columns");
  // An invalid edit is 400 (re-validated by the real schema).
  assert.equal((await req(`/defs/${gid}`, { method: "PUT", body: { payload: { id: "Bad Id", params: [] } } })).status, 400);
  // Editing a missing def is 404.
  assert.equal((await req(`/defs/${encodeURIComponent("user~does-not-exist")}`, { method: "PUT", body: { payload: PRIMITIVE } })).status, 404);
});

test("a bad payload is 400; a bad storage target is 400", async () => {
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "x", payload: { id: "Bad Id", params: [] } } })).status, 400);
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "sidecar", name: "x", payload: PRIMITIVE } })).status, 400);
});

test("the importer only writes CUSTOMER scopes — there is no system store to write (shipped defs stay read-only)", async () => {
  // The only valid targets are user/project/org (customer scopes). A "system"/built-in target is rejected, so a
  // shipped/pre-built def can never be overwritten — customising one must be a NEW def in a customer store.
  for (const storage of ["system", "builtin", "shipped", "sidecar"]) {
    assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage, name: "x", payload: PRIMITIVE } })).status, 400);
  }
});

test("org target: a contributor can't write it, a pmo/admin can (default org gate)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], c: process.env["OIDC_CONTRIBUTOR_ROLES"], v: process.env["OIDC_VIEWER_ROLES"], a: process.env["OIDC_ADMIN_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  try {
    // A contributor is blocked at the org target (manager+).
    assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "org", name: "Org chart", payload: PRIMITIVE }, cookie: CONTRIBUTOR })).status, 403);
    // A viewer can't author at all.
    assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "x", payload: PRIMITIVE }, cookie: VIEWER })).status, 403);
    // An admin (manager+) can write the org target.
    assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "org", name: "Org chart", payload: PRIMITIVE }, cookie: ADMIN })).status, 201);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c], ["OIDC_VIEWER_ROLES", prev.v]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});

test("importer REJECTS a def whose extends ancestor is missing (broken ancestor) and ACCEPTS a valid one", async () => {
  // A thin child extending a SHIPPED root ("table" primitive) is accepted — the ancestor resolves.
  const okChild = { id: "my-editable-table", label: "My editable table", category: "table", description: "d", extends: "table", params: [] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "Child", payload: okChild } })).status, 201);
  // Extending a parent that exists in NO scope is rejected 400 (fail-closed).
  const orphan = { id: "orphan-prim", label: "Orphan", category: "table", description: "d", extends: "ghost-parent", params: [] };
  const bad = await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "Orphan", payload: orphan } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /does not exist/);
});

test("importer REJECTS an edit that would CYCLE the extends chain", async () => {
  const root = { id: "cyc-a", label: "A", category: "table", description: "d", params: [{ key: "x", label: "X", type: "string", required: true, description: "d" }] };
  const a = (await (await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "A", payload: root } })).json()) as { id: string };
  const child = { id: "cyc-b", label: "B", category: "table", description: "d", extends: "cyc-a", params: [] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "primitive", storage: "user", name: "B", payload: child } })).status, 201);
  // Edit A to extend B → A→B→A cycle → 400.
  const put = await req(`/defs/${encodeURIComponent(a.id)}`, { method: "PUT", body: { name: "A", payload: { ...root, extends: "cyc-b" } } });
  assert.equal(put.status, 400);
  assert.match(((await put.json()) as { error: string }).error, /cycle/);
});
