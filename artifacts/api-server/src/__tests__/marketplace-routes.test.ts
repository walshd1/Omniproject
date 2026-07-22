import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/marketplace.ts over the REAL app (roadmap 3.4). An installed extension is org-wide config (a
 * manifest of pure-JSON contributions) in the sealed artifact store. Install/enable/remove are admin-gated
 * governance actions; any manager+ may browse.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "marketplace";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });
const MANAGER = cookie({ sub: "m", name: "Mia", email: "mia@x.io", roles: ["omni-managers"] });

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
    headers: { cookie: o.cookie ?? ADMIN, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

const MANIFEST = {
  name: "Acme Reports Pack", publisher: "Acme", version: "2.1.0",
  contributions: [{ kind: "report", name: "Burn rate", def: { id: "burn-rate", engine: "custom" } }],
};

test("install → list → get → disable → uninstall lifecycle", async () => {
  const installed = await req("/extensions", { method: "POST", body: MANIFEST });
  assert.equal(installed.status, 201);
  const ext = (await installed.json()) as { id: string; status: string };
  assert.equal(ext.status, "installed");

  const metas = (await req("/extensions").then((x) => x.json())) as Array<{ id: string; contributionCount: number; contributions?: unknown }>;
  const meta = metas.find((m) => m.id === ext.id)!;
  assert.equal(meta.contributionCount, 1);
  assert.equal((meta as { contributions?: unknown }).contributions, undefined, "list projection omits contribution defs");

  const full = (await req(`/extensions/${ext.id}`).then((x) => x.json())) as { contributions: Array<{ name: string }> };
  assert.equal(full.contributions[0]!.name, "Burn rate");

  const disabled = await req(`/extensions/${ext.id}/status`, { method: "POST", body: { status: "disabled" } });
  assert.equal(((await disabled.json()) as { status: string }).status, "disabled");

  assert.equal((await req(`/extensions/${ext.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/extensions/${ext.id}`)).status, 404);
});

test("a bad manifest is 400", async () => {
  assert.equal((await req("/extensions", { method: "POST", body: { name: "x", publisher: "y", contributions: [] } })).status, 400);
});

test("a manager can browse but not install (admin-gated writes)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], mgr: process.env["OIDC_MANAGER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
  try {
    assert.equal((await req("/extensions", { cookie: MANAGER })).status, 200, "manager can browse");
    assert.equal((await req("/extensions", { method: "POST", body: MANIFEST, cookie: MANAGER })).status, 403, "manager cannot install");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_MANAGER_ROLES", prev.mgr]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
