import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEF_KINDS, validateDef, sanitizeDef, newStoredDef, storedDefMeta, DefError,
} from "../lib/def-import";
import type { ActorContext } from "../broker/types";

/**
 * The definition importer's pure core (roadmap X.3) — the single choke point that validates any user-defined
 * JSON def by kind (via the real product validators) before it may be sealed into a scoped store.
 */

const CTX: ActorContext = { sub: "u1", email: "cee@x.io" };
const NOW = "2026-07-16T00:00:00.000Z";

const GOOD_PRIMITIVE = {
  id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
  description: "compare series", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "rows" }],
};
const GOOD_SCREEN = { id: "delivery-health", label: "Delivery health", panels: [{ id: "kpis", kind: "metrics" }] };
const GOOD_FORM = {
  id: "change-request", label: "Change request",
  fields: [{ key: "summary", label: "Summary", type: "text", mapTo: "title", required: true }],
  target: { kind: "issue" },
};

test("DEF_KINDS is the expected closed set", () => {
  assert.deepEqual([...DEF_KINDS], ["primitive", "screen", "form", "report", "dashboard", "businessRule", "theme", "font", "jsonDef"]);
});

test("business rules, colour themes and fonts go through the importer too", () => {
  assert.equal(validateDef("businessRule", { id: "no-weekend-work", when: "x", then: "y" }).ok, true);
  assert.equal(validateDef("businessRule", { when: "no id" }).ok, false);
  assert.equal(validateDef("theme", { id: "brand", colors: { primary: "#1d4ed8", bg: "#fff" } }).ok, true);
  assert.equal(validateDef("theme", { id: "brand", colors: { primary: 123 } }).ok, false, "non-string colour rejected");
  assert.equal(validateDef("font", { id: "heading", family: "Inter" }).ok, true);
  assert.equal(validateDef("font", { id: "heading" }).ok, false, "a font needs a family");
});

test("validateDef uses the real per-kind validators", () => {
  assert.equal(validateDef("primitive", GOOD_PRIMITIVE).ok, true);
  assert.equal(validateDef("screen", GOOD_SCREEN).ok, true);
  assert.equal(validateDef("form", GOOD_FORM).ok, true);
  // A bad primitive collects the schema errors.
  const bad = validateDef("primitive", { id: "Bad Id", params: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 2);
  // A screen missing its panels array fails the real screen validator.
  assert.equal(validateDef("screen", { id: "x", label: "X" }).ok, false);
});

test("report/jsonDef get a structural check", () => {
  assert.equal(validateDef("report", { id: "r1" }).ok, true);
  assert.equal(validateDef("report", { label: "no id" }).ok, false);
  assert.equal(validateDef("jsonDef", { anything: true }).ok, true);
  assert.equal(validateDef("jsonDef", "not an object").ok, false);
});

test("dashboard validates against the real Dashboard shape (id + name + widgets[])", () => {
  assert.equal(validateDef("dashboard", { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "portfolioHealth" }] }).ok, true);
  assert.equal(validateDef("dashboard", { id: "d1", name: "Exec", widgets: [] }).ok, true);
  assert.equal(validateDef("dashboard", { id: "d1" }).ok, false);                       // no name / widgets
  assert.equal(validateDef("dashboard", { id: "d1", name: "X", widgets: {} }).ok, false); // widgets not an array
  assert.equal(validateDef("dashboard", { id: "d1", name: "X", widgets: [{ id: "w1" }] }).ok, false); // widget needs a type
});

test("sanitizeDef is the choke point: kind + name + payload + per-kind validity", () => {
  const s = sanitizeDef({ kind: "primitive", name: "  My chart  ", payload: GOOD_PRIMITIVE });
  assert.equal(s.kind, "primitive");
  assert.equal(s.name, "My chart");
  assert.ok(s.value);

  assert.throws(() => sanitizeDef({ kind: "nope", name: "x", payload: {} }), DefError);
  assert.throws(() => sanitizeDef({ kind: "primitive", name: "", payload: GOOD_PRIMITIVE }), DefError);
  assert.throws(() => sanitizeDef({ kind: "primitive", name: "x", payload: "not-json" }), DefError);
  // Invalid payload surfaces the validator errors in the thrown message.
  assert.throws(() => sanitizeDef({ kind: "primitive", name: "x", payload: { id: "Bad Id", params: [] } }), /invalid primitive:/);
});

test("newStoredDef stamps identity; storedDefMeta drops payload + derives storage from the id", () => {
  const input = sanitizeDef({ kind: "screen", name: "Health", payload: GOOD_SCREEN });
  const row = newStoredDef("org~abc123", input, CTX, NOW);
  assert.equal(row.createdBy, "cee@x.io");
  assert.equal(row.rowVersion, 1);
  const meta = storedDefMeta(row);
  assert.equal((meta as { payload?: unknown }).payload, undefined);
  assert.equal(meta.storage, "org");
  assert.equal(meta.kind, "screen");
});
