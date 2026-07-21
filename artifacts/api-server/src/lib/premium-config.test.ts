import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// branding + labels now live as config defs in the sealed store — enable it on a temp dir before import.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "premium-config-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const { sanitizeLabels, saveLabels, effectiveLabels } = await import("./labels");
const { sanitizeBranding, saveBranding, clearBranding, effectiveBranding, DEFAULT_BRANDING } = await import("./branding");
const { putDef } = await import("./def-import");

afterEach(() => {
  saveLabels({});
  clearBranding();
  delete process.env["PREMIUM_ENFORCEMENT"];
});
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

// ── labels ────────────────────────────────────────────────────────────────────
test("sanitizeLabels keeps catalogue keys, trims, drops unknowns/empties", () => {
  const out = sanitizeLabels({ "nav.projects": "  Engagements  ", "term.issue": "Ticket", "bogus.key": "x", "nav.reports": "" });
  assert.deepEqual(out, { "nav.projects": "Engagements", "term.issue": "Ticket" });
});

test("sanitizeLabels rejects non-objects, non-string values and over-long values", () => {
  assert.throws(() => sanitizeLabels(null), /must be an object/);
  assert.throws(() => sanitizeLabels("x"), /must be an object/);
  assert.throws(() => sanitizeLabels({ "nav.projects": 5 }), /must be a string/);
  assert.throws(() => sanitizeLabels({ "nav.projects": "x".repeat(61) }), /too long/);
});

test("saveLabels persists (as an org config def) and effectiveLabels reflects them", () => {
  saveLabels({ "term.project": "Engagement" });
  const eff = effectiveLabels();
  assert.equal(eff.entitled, true); // nomenclature is always on (no premium gate)
  assert.equal(eff.locked, false);
  assert.equal(eff.overrides["term.project"], "Engagement");
  assert.ok(eff.catalog.length > 0);
});

test("effectiveLabels stays applied even under premium enforcement (labels premium gate is disabled)", () => {
  saveLabels({ "term.project": "Engagement" });
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  const eff = effectiveLabels();
  assert.equal(eff.entitled, true);
  assert.equal(eff.locked, false);
  assert.equal(eff.overrides["term.project"], "Engagement");
});

test("effectiveLabels sanitises a tampered/restored label def on READ (non-catalogue keys dropped)", () => {
  // A backup could carry a config def the generic importer didn't run through the labels validator.
  putDef({ kind: "org" }, { id: "org~config-label-overrides", kind: "config", name: "Label overrides", createdBy: null, createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", rowVersion: 1, payload: { id: "label-overrides", values: { "term.project": "Engagement", "not.a.catalogue.key": "x" } } });
  const eff = effectiveLabels();
  assert.equal(eff.overrides["term.project"], "Engagement");
  assert.equal(Object.prototype.hasOwnProperty.call(eff.overrides, "not.a.catalogue.key"), false);
});

// ── branding ────────────────────────────────────────────────────────────────
test("sanitizeBranding normalises a full valid config", () => {
  const b = sanitizeBranding({
    appName: "Acme PM", shortName: "ACME", logoUrl: "https://acme.test/logo.png",
    primaryColor: "#2563eb", loginHeading: "Welcome", footerText: "© Acme", supportUrl: "https://acme.test/help",
  });
  assert.equal(b.appName, "Acme PM");
  assert.equal(b.logoUrl, "https://acme.test/logo.png");
  assert.equal(b.primaryColor, "#2563eb");
});

test("sanitizeBranding enforces types, length, URL scheme and hex colour", () => {
  assert.throws(() => sanitizeBranding(42), /must be an object/);
  assert.throws(() => sanitizeBranding({ appName: 1 }), /appName must be a string/);
  assert.throws(() => sanitizeBranding({ appName: "x".repeat(61) }), /too long/);
  assert.throws(() => sanitizeBranding({ logoUrl: "ftp://x" }), /absolute http/);
  assert.throws(() => sanitizeBranding({ primaryColor: "blue" }), /hex colour/);
  // empties → null, not an error
  assert.equal(sanitizeBranding({ appName: "" }).appName, null);
});

test("saveBranding/effectiveBranding round-trip (org config def); clearBranding resets to defaults", () => {
  saveBranding({ appName: "Acme PM", shortName: "ACME" });
  const eff = effectiveBranding();
  assert.equal(eff.entitled, true);
  assert.equal(eff.appName, "Acme PM");
  assert.equal(eff.shortName, "ACME");
  // unset fields fall back to the product default
  assert.equal(eff.loginHeading, DEFAULT_BRANDING.loginHeading);

  clearBranding();
  assert.equal(effectiveBranding().appName, DEFAULT_BRANDING.appName);
});

test("effectiveBranding locks to defaults when premium is enforced without a licence", () => {
  saveBranding({ appName: "Acme PM" });
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  const eff = effectiveBranding();
  assert.equal(eff.entitled, false);
  assert.equal(eff.locked, true);
  assert.equal(eff.appName, DEFAULT_BRANDING.appName); // override not applied
});

test("effectiveBranding rejects a tampered/restored branding def on READ (font-stack injection guarded)", () => {
  // A tampered backup could smuggle a malicious fontFamily into the config def, bypassing the generic importer.
  putDef({ kind: "org" }, { id: "org~config-branding", kind: "config", name: "Branding", createdBy: null, createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", rowVersion: 1, payload: { id: "branding", values: { appName: "Acme", fontFamily: "x; } body { background: url(javascript:alert(1)) }" } } });
  const eff = effectiveBranding();
  // The whole override is rejected (sanitizeBranding throws on the bad font) → product defaults, never rendered.
  assert.equal(eff.appName, DEFAULT_BRANDING.appName);
  assert.equal(eff.fontFamily, DEFAULT_BRANDING.fontFamily);
});
