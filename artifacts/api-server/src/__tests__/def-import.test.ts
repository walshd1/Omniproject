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
  assert.deepEqual([...DEF_KINDS], ["primitive", "screen", "form", "report", "dashboard", "jsonDef"]);
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

test("report/dashboard/jsonDef get a structural check", () => {
  assert.equal(validateDef("report", { id: "r1" }).ok, true);
  assert.equal(validateDef("report", { label: "no id" }).ok, false);
  assert.equal(validateDef("dashboard", { id: "d1" }).ok, true);
  assert.equal(validateDef("jsonDef", { anything: true }).ok, true);
  assert.equal(validateDef("jsonDef", "not an object").ok, false);
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
