import { test } from "node:test";
import assert from "node:assert/strict";
import { validateScreenDefs, ScreenDefError } from "./screen-def";

/**
 * The org screen-def validator pins the structural essentials and PRESERVES everything else, so a bundle
 * authored against a newer builder (new panel kinds/fields) is stored rather than rejected.
 */

test("accepts a well-formed screen def and preserves extra fields verbatim", () => {
  const out = validateScreenDefs([
    {
      id: "kanban", label: "Kanban", methodologies: ["kanban"], route: "/kanban", bare: true,
      nav: { label: "Kanban" }, methodologyLayouts: { kanban: { order: ["b"] } },
      panels: [{ id: "b", kind: "view", config: { view: "kanban" }, source: { url: "/x" } }],
    },
  ]);
  assert.equal(out.length, 1);
  const s = out[0]!;
  assert.equal(s.id, "kanban");
  assert.deepEqual(s.methodologies, ["kanban"]); // extra field kept
  assert.equal(s.route, "/kanban");
  assert.deepEqual(s.panels[0]!.config, { view: "kanban" }); // panel extras kept
  assert.deepEqual((s.panels[0] as { source?: unknown }).source, { url: "/x" });
});

test("trims and requires id + label", () => {
  assert.throws(() => validateScreenDefs([{ label: "x", panels: [] }]), ScreenDefError);
  assert.throws(() => validateScreenDefs([{ id: "a", panels: [] }]), ScreenDefError);
});

test("requires panels to be an array with id + kind on each", () => {
  assert.throws(() => validateScreenDefs([{ id: "a", label: "A", panels: {} }]), ScreenDefError);
  assert.throws(() => validateScreenDefs([{ id: "a", label: "A", panels: [{ kind: "table" }] }]), ScreenDefError);
  assert.throws(() => validateScreenDefs([{ id: "a", label: "A", panels: [{ id: "p" }] }]), ScreenDefError);
});

test("rejects duplicate screen ids and duplicate panel ids within a screen", () => {
  assert.throws(() => validateScreenDefs([
    { id: "a", label: "A", panels: [] }, { id: "a", label: "A2", panels: [] },
  ]), ScreenDefError);
  assert.throws(() => validateScreenDefs([
    { id: "a", label: "A", panels: [{ id: "p", kind: "table" }, { id: "p", kind: "chart" }] },
  ]), ScreenDefError);
});

test("rejects a non-array top level", () => {
  assert.throws(() => validateScreenDefs({}), ScreenDefError);
});
