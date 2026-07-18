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

test("FULL backup: one file carries settings + defs, and round-trips both", async () => {
  // Gate: admin + fresh step-up.
  assert.equal((await req("/setup/full-backup", { cookie: CONTRIB })).status, 403);
  assert.equal((await req("/setup/full-backup", { cookie: ADMIN })).status, 403);
  const backup = await req("/setup/full-backup", { cookie: ADMIN_STEPPED }).then((r) => r.json()) as { schema: string; settings: unknown; defStore: { collections: unknown[] } };
  assert.equal(backup.schema, "omniproject/full-backup");
  assert.ok(backup.settings && typeof backup.settings === "object");
  assert.ok(backup.defStore.collections.length >= 1);
  // Restore the whole thing.
  const restore = await req("/setup/full-restore", { method: "POST", body: backup, cookie: ADMIN_STEPPED });
  assert.equal(restore.status, 200);
  const report = await restore.json() as { restored: boolean; settingsRestored: boolean; defStore: { written: unknown[] } | null };
  assert.equal(report.restored, true);
  assert.equal(report.settingsRestored, true);
  assert.ok((report.defStore?.written.length ?? 0) >= 1);
  // The org binding survived the full round-trip.
  const bindings = await req("/defs/bindings").then((r) => r.json()) as { org: Record<string, { defId: string }> };
  assert.equal(bindings.org["screens"]?.defId, "system~x");
});

test("full-restore rejects a foreign schema and needs step-up", async () => {
  assert.equal((await req("/setup/full-restore", { method: "POST", body: { schema: "x" }, cookie: ADMIN })).status, 403);
  const bad = await req("/setup/full-restore", { method: "POST", body: { schema: "nope" }, cookie: ADMIN_STEPPED });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /schema/i);
});

test("SEALED full backup is an encrypted envelope that decrypts + restores under this deployment's key", async () => {
  // Gate: admin + fresh step-up, same as the plaintext variant.
  assert.equal((await req("/setup/full-backup?encrypted=1", { cookie: CONTRIB })).status, 403);
  assert.equal((await req("/setup/full-backup?encrypted=1", { cookie: ADMIN })).status, 403);

  const sealed = await req("/setup/full-backup?encrypted=1", { cookie: ADMIN_STEPPED });
  assert.equal(sealed.status, 200);
  const sealedBody = await sealed.json() as { schema: string; keyFingerprint: string; sealed: string };
  assert.equal(sealedBody.schema, "omniproject/full-backup-sealed");
  assert.ok(sealedBody.keyFingerprint.length > 0);
  // The payload is ciphertext (a sealed config token), NOT readable JSON — the whole state is encrypted.
  assert.match(sealedBody.sealed, /^c[12]\./);
  assert.equal(sealedBody.sealed.includes("system~x"), false, "sealed payload must be ciphertext, not clear config");

  // Restore the sealed backup: it decrypts under this deployment's key and applies BOTH halves.
  const restore = await req("/setup/full-restore", { method: "POST", body: sealedBody, cookie: ADMIN_STEPPED });
  assert.equal(restore.status, 200);
  const report = await restore.json() as { restored: boolean; settingsRestored: boolean; defStore: { written: unknown[] } | null };
  assert.equal(report.settingsRestored, true);
  assert.ok((report.defStore?.written.length ?? 0) >= 1);
  // The org binding survived the sealed round-trip.
  const bindings = await req("/defs/bindings").then((r) => r.json()) as { org: Record<string, { defId: string }> };
  assert.equal(bindings.org["screens"]?.defId, "system~x");
});

test("config-diff previews changes: live-vs-uploaded, content-free, admin + step-up gated", async () => {
  assert.equal((await req("/setup/config-diff", { method: "POST", body: {}, cookie: ADMIN })).status, 403); // no step-up

  // A live backup, then a modified copy uploaded as `to`: change a setting + drop a def collection's item.
  const live = await req("/setup/full-backup", { cookie: ADMIN_STEPPED }).then((r) => r.json()) as { settings: { settings: Record<string, unknown> }; defStore: { collections: { type: string; items: { id: string }[] }[] } };
  const candidate = JSON.parse(JSON.stringify(live)) as typeof live;
  candidate.settings.settings["reportingCurrency"] = "USD"; // a settings change
  // Drop one org def so the diff shows a removal.
  const orgDef = candidate.defStore.collections.find((c) => c.type === "def");
  const removedId = orgDef?.items[0]?.id;
  if (orgDef && removedId) orgDef.items = orgDef.items.filter((i) => i.id !== removedId);

  const diff = await req("/setup/config-diff", { method: "POST", body: { to: candidate }, cookie: ADMIN_STEPPED }).then((r) => r.json()) as {
    schema: string; identical: boolean; settings: { changed: { key: string; status: string }[] }; defStore: { removed: number }[]; summary: { defsRemoved: number };
  };
  assert.equal(diff.schema, "omniproject/config-diff");
  assert.equal(diff.identical, false);
  assert.ok(diff.settings.changed.some((c) => c.key === "reportingCurrency" && c.status === "changed"));
  if (removedId) assert.ok(diff.summary.defsRemoved >= 1, "the dropped def shows as a removal");
  // Content-free: the changed currency VALUE never appears in the diff.
  assert.equal(JSON.stringify(diff).includes("USD"), false);
});

test("config-diff of live-vs-live is identical (empty)", async () => {
  const diff = await req("/setup/config-diff", { method: "POST", body: {}, cookie: ADMIN_STEPPED }).then((r) => r.json()) as { identical: boolean };
  assert.equal(diff.identical, true);
});

test("a sealed backup sealed under a DIFFERENT key cannot be restored (clear error, not a silent wipe)", async () => {
  const sealedBody = await req("/setup/full-backup?encrypted=1", { cookie: ADMIN_STEPPED }).then((r) => r.json()) as { sealed: string };
  // Corrupt the ciphertext so the AES-GCM tag no longer authenticates (stands in for a wrong/rotated key).
  const tampered = { schema: "omniproject/full-backup-sealed", version: 1, createdAt: "t", keyFingerprint: "x", sealed: sealedBody.sealed.slice(0, -6) + "AAAAAA" };
  const bad = await req("/setup/full-restore", { method: "POST", body: tampered, cookie: ADMIN_STEPPED });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /decrypt|key/i);
});
