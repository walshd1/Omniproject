import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/invoices.ts over the REAL app (roadmap 3.3). An invoice is a first-class financial document — a
 * number + currency + typed line primitives, totals derived server-side — saved to a project/org storage
 * target, AES-256-GCM sealed under OMNI_CONFIG_DIR. RBAC is manager+ throughout.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "invoicing";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "invoice-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });
const CONTRIBUTOR = cookie({ sub: "c", name: "Cee", email: "cee@x.io", roles: ["omni-contributors"] });

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

const DRAFT = {
  number: "INV-2026-001", clientName: "Acme Corp", currency: "USD", storage: "org", taxRatePct: 20,
  lines: [
    { kind: "labour", description: "Delivery", quantity: 40, unitPrice: 120 }, // 4800
    { kind: "expense", description: "Travel", quantity: 1, unitPrice: 300 }, // 300
    { kind: "discount", description: "Intro", quantity: 1, unitPrice: 100 }, // -100
  ],
};

test("create derives amounts + totals, starts a draft, and seals at rest", async () => {
  const r = await req("/invoices", { method: "POST", body: DRAFT });
  assert.equal(r.status, 201);
  const inv = (await r.json()) as { id: string; status: string; subtotal: number; taxAmount: number; total: number; lines: Array<{ amount: number }> };
  assert.match(inv.id, /^org~/);
  assert.equal(inv.status, "draft");
  assert.equal(inv.subtotal, 5000); // 4800 + 300 - 100
  assert.equal(inv.taxAmount, 1000); // 20%
  assert.equal(inv.total, 6000);
  assert.equal(inv.lines[2]!.amount, -100); // discount negative

  const file = path.join(CONFIG_DIR, "artifacts", "invoice", "org.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("Acme Corp"), "the client name must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");
});

test("list returns metadata (no lines); update recomputes totals", async () => {
  const created = await (await req("/invoices", { method: "POST", body: { ...DRAFT, number: "INV-2" } })).json() as { id: string };
  const metas = (await req("/invoices").then((x) => x.json())) as Array<{ id: string; total: number; lineCount: number; lines?: unknown }>;
  const m = metas.find((x) => x.id === created.id)!;
  assert.equal(m.lineCount, 3);
  assert.equal((m as { lines?: unknown }).lines, undefined);

  const put = await req(`/invoices/${encodeURIComponent(created.id)}`, { method: "PUT", body: { ...DRAFT, number: "INV-2", lines: [{ kind: "fixed", description: "Fee", quantity: 1, unitPrice: 1000 }], taxRatePct: 0 } });
  assert.equal(put.status, 200);
  assert.equal(((await put.json()) as { total: number }).total, 1000);
});

test("a bad write is 400; a contributor cannot touch invoices (manager+)", async () => {
  assert.equal((await req("/invoices", { method: "POST", body: { clientName: "x" } })).status, 400);
  // Force real claim→role resolution (else a non-OIDC session is a demo session that holds every grant).
  const prev = { iss: process.env["OIDC_ISSUER_URL"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    assert.equal((await req("/invoices", { method: "POST", body: DRAFT, cookie: CONTRIBUTOR })).status, 403);
    assert.equal((await req("/invoices", { cookie: CONTRIBUTOR })).status, 403);
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_CONTRIBUTOR_ROLES", prev.contrib]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
