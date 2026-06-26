import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLabels, saveLabels, effectiveLabels } from "./labels";
import { sanitizeBranding, saveBranding, clearBranding, effectiveBranding, DEFAULT_BRANDING } from "./branding";
import { updateSettings } from "./settings";

afterEach(() => {
  updateSettings({ labelOverrides: {}, branding: null });
  delete process.env["PREMIUM_ENFORCEMENT"];
});

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

test("saveLabels persists and effectiveLabels reflects them (entitled in pre-community)", () => {
  saveLabels({ "term.project": "Engagement" });
  const eff = effectiveLabels();
  assert.equal(eff.entitled, true); // premium free-to-run while enforcement is off
  assert.equal(eff.locked, false);
  assert.equal(eff.overrides["term.project"], "Engagement");
  assert.ok(eff.catalog.length > 0);
});

test("effectiveLabels locks (hides overrides) when premium is enforced without a licence", () => {
  saveLabels({ "term.project": "Engagement" });
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  const eff = effectiveLabels();
  assert.equal(eff.entitled, false);
  assert.equal(eff.locked, true);
  assert.deepEqual(eff.overrides, {}); // not applied while locked
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

test("saveBranding/effectiveBranding round-trip; clearBranding resets to defaults", () => {
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
