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
  // A forkable recipe (jsonDef) — primitives are vendor-controlled and can't be authored at a customer scope.
  const created = await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "My def", payload: { id: "grouped-column", label: "Grouped" } } });
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
  const metas = (await req("/defs?kind=jsonDef").then((x) => x.json())) as Array<{ id: string; payload?: unknown }>;
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
  await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Other", payload: { id: "other-def" } } });

  const resolved = (await req("/defs/resolved/dashboard").then((x) => x.json())) as Array<{ id: string; kind: string; payload: { id: string; widgets: unknown[] } }>;
  const row = resolved.find((r) => r.id === a.id)!;
  assert.equal(row.kind, "dashboard");
  assert.equal(row.payload.id, "exec");                         // full payload, unlike the metadata list
  assert.ok(Array.isArray(row.payload.widgets));
  assert.ok(resolved.every((r) => r.kind === "dashboard"));     // the jsonDef is not included

  // A viewer can read the seam; an unknown kind is 400.
  assert.equal((await req("/defs/resolved/dashboard", { cookie: VIEWER })).status, 200);
  assert.equal((await req("/defs/resolved/nope")).status, 400);

  await req(`/defs/${encodeURIComponent(a.id)}`, { method: "DELETE" });
});

test("edit in place: PUT re-validates, bumps rowVersion, and keeps the kind", async () => {
  const DASH = { id: "editable-dash", name: "Editable", widgets: [{ id: "w1", type: "portfolioHealth" }] };
  const created = await (await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "user", name: "Editable", payload: DASH } })).json() as { id: string; rowVersion: number };
  const gid = encodeURIComponent(created.id);
  // A valid edit (rename + new name) succeeds and bumps the version.
  const edited = await req(`/defs/${gid}`, { method: "PUT", body: { name: "Renamed", payload: { ...DASH, name: "Renamed dash" } } });
  assert.equal(edited.status, 200);
  const row = (await edited.json()) as { name: string; rowVersion: number; kind: string; payload: { name: string } };
  assert.equal(row.name, "Renamed");
  assert.equal(row.kind, "dashboard");
  assert.equal(row.rowVersion, created.rowVersion + 1);
  assert.equal(row.payload.name, "Renamed dash");
  // An invalid edit is 400 (re-validated by the real schema — a dashboard needs id + name + widgets[]).
  assert.equal((await req(`/defs/${gid}`, { method: "PUT", body: { payload: { id: "x" } } })).status, 400);
  // Editing a missing def is 404.
  assert.equal((await req(`/defs/${encodeURIComponent("user~does-not-exist")}`, { method: "PUT", body: { payload: DASH } })).status, 404);
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
    const DASH = { id: "org-dash", name: "Org dash", widgets: [{ id: "w1", type: "portfolioHealth" }] };
    // A contributor is blocked at the org target (manager+).
    assert.equal((await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "org", name: "Org dash", payload: DASH }, cookie: CONTRIBUTOR })).status, 403);
    // A viewer can't author at all.
    assert.equal((await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "user", name: "x", payload: DASH }, cookie: VIEWER })).status, 403);
    // An admin (manager+) can write the org target.
    assert.equal((await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "org", name: "Org dash", payload: DASH }, cookie: ADMIN })).status, 201);
  } finally {
    for (const [k, val] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.c], ["OIDC_VIEWER_ROLES", prev.v]] as const) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
});

test("importer REJECTS a def whose extends ancestor is missing (broken ancestor) and ACCEPTS a valid one", async () => {
  // A base def then a thin child extending it — the ancestor resolves, so the child is accepted.
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Base", payload: { id: "anc-base", value: 1 } } })).status, 201);
  const okChild = { id: "anc-child", extends: "anc-base" };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Child", payload: okChild } })).status, 201);
  // Extending a parent that exists in NO scope is rejected 400 (fail-closed).
  const orphan = { id: "orphan-def", extends: "ghost-parent" };
  const bad = await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Orphan", payload: orphan } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /does not exist/);
});

test("importer REJECTS an edit that would CYCLE the extends chain", async () => {
  const root = { id: "cyc-a", value: 1 };
  const a = (await (await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "A", payload: root } })).json()) as { id: string };
  const child = { id: "cyc-b", extends: "cyc-a" };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "B", payload: child } })).status, 201);
  // Edit A to extend B → A→B→A cycle → 400.
  const put = await req(`/defs/${encodeURIComponent(a.id)}`, { method: "PUT", body: { name: "A", payload: { ...root, extends: "cyc-b" } } });
  assert.equal(put.status, 400);
  assert.match(((await put.json()) as { error: string }).error, /cycle/);
});

test("CASCADE: RENAMING an ancestor's id, which orphans a def built on it, is rejected", async () => {
  // A root def; a thin child extends it by id and is valid.
  const root = { id: "casc-root", value: 1 };
  const rootRow = (await (await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Root", payload: root } })).json()) as { id: string };
  const child = { id: "casc-child", extends: "casc-root" };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Child", payload: child } })).status, 201);
  // Renaming the root's logical id (valid on its own) would leave the child extending a now-missing parent — a
  // cascade failure down the chain — so the edit is rejected before it can be stored.
  const renamed = { ...root, id: "casc-root-renamed" };
  const put = await req(`/defs/${encodeURIComponent(rootRow.id)}`, { method: "PUT", body: { name: "Root", payload: renamed } });
  assert.equal(put.status, 400);
  assert.match(((await put.json()) as { error: string }).error, /downstream/);
  // A benign edit to the root (change a value, id unchanged) keeps the composed child valid → succeeds.
  const okRoot = { ...root, value: 2 };
  assert.equal((await req(`/defs/${encodeURIComponent(rootRow.id)}`, { method: "PUT", body: { name: "Root", payload: okRoot } })).status, 200);
});

test("Tier 1: a customer can FORK a shipped dashboard/businessRule (extends a system def) and it is ancestry-guarded", async () => {
  const { dashboardDefCatalogue, referenceRulesetCatalogue } = await import("@workspace/backend-catalogue");
  const shippedDash = dashboardDefCatalogue()[0]!;                 // a real shipped dashboard id to fork
  const shippedRule = referenceRulesetCatalogue()[0]!;            // a real shipped businessRule id to fork

  // A dashboard fork that extends a shipped dashboard resolves its ancestor → 201 (composes to a valid whole).
  const dashFork = { id: "my-exec-dash", name: "My exec view", extends: shippedDash.id, widgets: [{ id: "extra", type: "portfolioHealth" }] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "user", name: "Dash fork", payload: dashFork } })).status, 201);

  // A THIN businessRule fork (structural kind) extends a shipped ruleset and inherits the rest → 201.
  const ruleFork = { id: "my-scrum-rules", extends: shippedRule.id };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "businessRule", storage: "user", name: "Rule fork", payload: ruleFork } })).status, 201);

  // Forking a parent that exists in NO scope is rejected 400 (the ancestry guard now covers these kinds too).
  const orphanDash = { id: "orphan-dash", name: "Orphan", extends: "ghost-dashboard", widgets: [] };
  const bad = await req("/defs", { method: "POST", body: { kind: "dashboard", storage: "user", name: "Orphan", payload: orphanDash } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /does not exist/);
});

test("CONSTRAINTS: floors are inherited + tighten-only, policy is relaxable — enforced on the composed whole", async () => {
  // A base def introduces a title-cardinality FLOOR + a value-cap FLOOR + a value-min POLICY. (jsonDef has no
  // bespoke validator, so this exercises the constraint layer in isolation.)
  const base = {
    id: "cn-base", value: 5, tags: [{ id: "t1", role: "title" }],
    constraints: [
      { id: "one-title", kind: "floor", type: "cardinality", path: "tags", where: { field: "role", eq: "title" }, min: 1, max: 1 },
      { id: "val-cap", kind: "floor", type: "bound", path: "value", max: 10 },
      { id: "val-min", kind: "policy", type: "bound", path: "value", min: 3 },
    ],
  };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Base", payload: base } })).status, 201);

  // (a) A thin fork that inherits everything and satisfies the floors → 201.
  const ok = { id: "cn-ok", extends: "cn-base", value: 8 };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "OK", payload: ok } })).status, 201);

  // Inherited POLICY still bites when not relaxed: value 1 < inherited min 3 → 400.
  const tooLow = { id: "cn-low", extends: "cn-base", value: 1 };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Low", payload: tooLow } })).status, 400);

  // (b) A fork may RELAX a policy (child-wins): re-declare val-min ≥ 0, then value 1 is fine → 201.
  const relax = { id: "cn-relax", extends: "cn-base", value: 1, constraints: [{ id: "val-min", kind: "policy", type: "bound", path: "value", min: 0 }] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Relax", payload: relax } })).status, 201);

  // (c) A fork may NOT loosen a FLOOR: re-declaring val-cap at 100 (value itself fine) → 400, "branch above".
  const loosen = { id: "cn-loosen", extends: "cn-base", value: 5, constraints: [{ id: "val-cap", kind: "floor", type: "bound", path: "value", max: 100 }] };
  const bad = await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Loosen", payload: loosen } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /relax floor|branch above/);

  // (d) A fork may TIGHTEN a floor: cap 10 → 5, value 5 satisfies it → 201.
  const tighten = { id: "cn-tighten", extends: "cn-base", value: 5, constraints: [{ id: "val-cap", kind: "floor", type: "bound", path: "value", max: 5 }] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Tighten", payload: tighten } })).status, 201);
});

test("FORM container floors are engine-enforced: a fork may compose but may NOT relax exactly-one-title", async () => {
  const base = {
    id: "bf-req", label: "Base request", target: { kind: "issue" },
    fields: [
      { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
      { key: "details", label: "Details", type: "textarea", mapTo: "description" },
    ],
  };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "form", storage: "user", name: "Base", payload: base } })).status, 201);

  // A complete, valid fork composes fine → 201.
  const okFork = {
    id: "ff-ok", label: "Fork", extends: "bf-req", target: { kind: "issue" },
    fields: [
      { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
      { key: "prio", label: "Priority", type: "select", mapTo: "priority", options: ["low", "high"] },
    ],
  };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "form", storage: "user", name: "OK fork", payload: okFork } })).status, 201);

  // A fork that re-declares the container floor to allow TWO titles is rejected — a floor is tighten-only, you
  // must branch above the form container to escape it. (The fork is itself a valid single-title form, so this
  // isolates the engine floor-protection, not a per-field check.)
  const relaxFork = {
    id: "ff-relax", label: "Relax fork", extends: "bf-req", target: { kind: "issue" },
    fields: [{ key: "summary", label: "Summary", type: "text", mapTo: "title", required: true }],
    constraints: [{ id: "form-one-title", kind: "floor", type: "cardinality", path: "fields", where: { field: "mapTo", eq: "title" }, min: 1, max: 2 }],
  };
  const bad = await req("/defs", { method: "POST", body: { kind: "form", storage: "user", name: "Relax fork", payload: relaxFork } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /relax floor|branch above/);
});

test("FAST PATH: a standalone (rootless, childless) def is still fully validated, not waved through", async () => {
  // Warm the child index by importing a valid def (the first import builds + persists it via the full path).
  assert.equal((await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "Warm", payload: { id: "fp-warm" } } })).status, 201);
  // A standalone form with NO title field passes the fragment shape but must be rejected by the composed-whole
  // container floor — the fast path (rootless + nothing extends it) must NOT skip that validation.
  const noTitle = { id: "fp-form", label: "No title", target: { kind: "issue" }, fields: [{ key: "d", label: "Details", type: "textarea", mapTo: "description" }] };
  const bad = await req("/defs", { method: "POST", body: { kind: "form", storage: "user", name: "No title", payload: noTitle } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /title/);
  // A sound standalone form is accepted.
  const ok = { id: "fp-ok", label: "OK", target: { kind: "issue" }, fields: [{ key: "s", label: "Summary", type: "text", mapTo: "title" }] };
  assert.equal((await req("/defs", { method: "POST", body: { kind: "form", storage: "user", name: "OK", payload: ok } })).status, 201);
});

test("DELETE is BLOCKED (409) when another def is built on the target, then succeeds once the dependant is gone", async () => {
  const root = { id: "del-root", value: 1 };
  const rootRow = (await (await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "DelRoot", payload: root } })).json()) as { id: string };
  const child = { id: "del-child", extends: "del-root" };
  const childRow = (await (await req("/defs", { method: "POST", body: { kind: "jsonDef", storage: "user", name: "DelChild", payload: child } })).json()) as { id: string };
  // Deleting the root while the child still extends it orphans the child → 409.
  const blocked = await req(`/defs/${encodeURIComponent(rootRow.id)}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.match(((await blocked.json()) as { error: string }).error, /built on it/);
  // Remove the dependant first, then the root deletes cleanly.
  assert.equal((await req(`/defs/${encodeURIComponent(childRow.id)}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/defs/${encodeURIComponent(rootRow.id)}`, { method: "DELETE" })).status, 204);
});
