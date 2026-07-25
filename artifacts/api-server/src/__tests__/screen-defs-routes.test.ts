import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The def store must be configured + the importer module on BEFORE the app is imported by the harness.
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "screens-conv-"));
process.env["ENABLED_FEATURES"] = "defImporter";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/screen-defs.ts after the def-store convergence (roadmap X.10 screens). Org screen OVERRIDES are
 * artifacts authored through the importer (`POST /api/defs`, kind `screen`); the SPA merges them over its
 * built-in catalogue. `GET /screen-defs/resolved` serves the effective override set.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(process.env["OMNI_CONFIG_DIR"]!, { recursive: true, force: true }); });
afterEach(async () => {
  const { replaceArtifacts } = await import("../lib/artifact-store");
  const { DEF_ARTIFACT } = await import("../lib/def-import");
  replaceArtifacts(DEF_ARTIFACT, { kind: "org" }, []); // clear org-authored screen defs between tests
});
const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

const SCREEN = { id: "budget-plans", label: "Our Budgets", panels: [{ id: "t", kind: "table", source: { url: "/api/budget-plans/rows" } }] };
const authorScreen = (screen: object, cookie = ADMIN) =>
  req("/defs", { method: "POST", cookie, body: { kind: "screen", storage: "org", name: (screen as { label?: string }).label ?? "Screen", payload: screen } });

test("an override authored via the importer shows up in GET /screen-defs/resolved (overriding a default id)", async () => {
  assert.equal((await authorScreen(SCREEN)).status, 201);
  const resolved = (await req("/screen-defs/resolved").then((x) => x.json())) as { screenDefs: { id: string; label: string }[] };
  const budgets = resolved.screenDefs.find((s) => s.id === "budget-plans");
  assert.ok(budgets, "the override is in the resolved set");
  assert.equal(budgets!.label, "Our Budgets");
});

test("a malformed screen def is rejected at the importer → 400", async () => {
  const r = await authorScreen({ label: "no id", panels: [] });
  assert.equal(r.status, 400);
});

test("GET /screen-defs/resolved reads are open (viewer+) under real RBAC", async () => {
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    assert.equal((await h.req("/screen-defs/resolved", { cookie: memberCookie() })).status, 200);
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
