import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Enable the encrypted artifact store on a temp config dir BEFORE importing anything that reads it.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "org-identity-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const { putDef, listDefs } = await import("./def-import");
const {
  ensureOrgIdentity, setOrgName, updateOrgIdentity, readOrgIdentity, resolveOrgIdentity, sanitizeOrgLogo,
  ORG_IDENTITY_DEF_ID, DEFAULT_ORG_NAME,
} = await import("./org-identity");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const CTX = { sub: "u-test", name: "Tester" };
const now = "2026-07-19T00:00:00.000Z";

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

// Seed a couple of ordinary org defs FIRST, so the "org-identity sits at the top" claim is a real assertion
// (identity is written AFTER them, yet must still be row 0).
before(() => {
  putDef({ kind: "org" }, { id: "org~d1", kind: "dashboard", name: "Exec", createdBy: "a", createdAt: now, updatedAt: now, rowVersion: 1, payload: { id: "exec", name: "Exec", widgets: [] } });
  putDef({ kind: "org" }, { id: "org~d2", kind: "theme", name: "Dark", createdBy: "a", createdAt: now, updatedAt: now, rowVersion: 1, payload: { id: "dark", colors: { primary: "#000" } } });
});

test("ensureOrgIdentity mints a stable id once and never rewrites it", () => {
  const first = ensureOrgIdentity(CTX, now);
  assert.match(first.id, /^org_/);
  assert.equal(first.name, DEFAULT_ORG_NAME);
  assert.equal(first.logo, "");
  assert.equal(first.showLogo, false);
  const second = ensureOrgIdentity(CTX, "2027-01-01T00:00:00.000Z");
  assert.equal(second.id, first.id, "the id is minted once, then immutable");
});

test("the org-identity row is the FIRST row of the org-level JSON (id at the top)", () => {
  ensureOrgIdentity(CTX, now);
  const rows = listDefs({ kind: "org" });
  assert.equal(rows[0]?.id, ORG_IDENTITY_DEF_ID, "org identity leads the org store");
  // …and the payload values list `id` FIRST (the "org id at the top" directive).
  const values = (rows[0]?.payload as { values: Record<string, unknown> }).values;
  assert.deepEqual(Object.keys(values), ["id", "name", "logo", "showLogo"]);
  // The other org defs are still present (identity was prepended, not clobbering them).
  assert.ok(rows.some((r) => r.id === "org~d1") && rows.some((r) => r.id === "org~d2"));
});

test("setOrgName sets the ungated name and keeps the id + top position", () => {
  const idBefore = readOrgIdentity().id;
  const named = setOrgName("  Acme Inc.  ", CTX, now);
  assert.equal(named.name, "Acme Inc.", "trimmed");
  assert.equal(named.id, idBefore, "id unchanged by naming");
  assert.equal(listDefs({ kind: "org" })[0]?.id, ORG_IDENTITY_DEF_ID, "still at the top after a rename");
  assert.deepEqual(readOrgIdentity(), { id: idBefore, name: "Acme Inc.", logo: "", showLogo: false });
});

test("sanitizeOrgLogo accepts https + raster data URIs, rejects SVG/other", () => {
  assert.equal(sanitizeOrgLogo(""), "");
  assert.equal(sanitizeOrgLogo(null), "");
  assert.equal(sanitizeOrgLogo("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
  assert.equal(sanitizeOrgLogo(PNG), PNG);
  // Inline SVG (script vector), http (non-TLS), and a non-image data URI are all refused.
  assert.throws(() => sanitizeOrgLogo("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="));
  assert.throws(() => sanitizeOrgLogo("http://example.com/logo.png"));
  assert.throws(() => sanitizeOrgLogo("data:text/html;base64,PGh0bWw+"));
});

test("updateOrgIdentity patches logo + showLogo independently, keeping the id and other fields", () => {
  const before = readOrgIdentity();
  // Set a logo but leave it hidden.
  const withLogo = updateOrgIdentity({ logo: PNG }, CTX, now);
  assert.equal(withLogo.logo, PNG);
  assert.equal(withLogo.showLogo, false, "stored but inert until shown");
  assert.equal(withLogo.name, before.name, "name preserved");
  assert.equal(withLogo.id, before.id, "id immutable");
  // Flip the opt-in without touching the logo.
  const shown = updateOrgIdentity({ showLogo: true }, CTX, now);
  assert.equal(shown.showLogo, true);
  assert.equal(shown.logo, PNG, "logo preserved when only toggling showLogo");
  // Clear the logo.
  assert.equal(updateOrgIdentity({ logo: "" }, CTX, now).logo, "");
  // An invalid logo throws and does not mutate.
  assert.throws(() => updateOrgIdentity({ logo: "data:image/svg+xml;base64,x" }, CTX, now));
  assert.equal(readOrgIdentity().logo, "", "unchanged after a rejected logo");
});

test("an empty/blank name falls back to the default placeholder", () => {
  const id = readOrgIdentity().id;
  assert.equal(setOrgName("   ", CTX, now).name, DEFAULT_ORG_NAME);
  assert.equal(readOrgIdentity().id, id, "still the same org");
});

test("resolveOrgIdentity reflects the stored identity", () => {
  setOrgName("Globex", CTX, now);
  assert.equal(resolveOrgIdentity().name, "Globex");
  assert.match(resolveOrgIdentity().id, /^org_/);
});
