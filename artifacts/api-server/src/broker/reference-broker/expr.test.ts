import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTemplate, isFullyResolved } from "./expr";

/**
 * The offline expression resolver handles exactly two n8n constructs
 * (`{{ $env.NAME }}` and `{{ $json.body.payload.path }}`), strips the leading `=`,
 * and renders every other `{{…}}` (JS bodies, unknown refs) to "".
 */

test("resolves $env references and strips the leading = expression marker", () => {
  const out = resolveTemplate("={{ $env.HOST }}/v1", { env: { HOST: "https://api.test" } });
  assert.equal(out, "https://api.test/v1");
});

test("resolves a dotted $json.body.payload path", () => {
  const out = resolveTemplate("{{ $json.body.payload.project.id }}", {
    payload: { project: { id: "proj-9" } },
  });
  assert.equal(out, "proj-9");
});

test("a payload path that descends into a non-object resolves to empty", () => {
  // getPath walks project (a string) then tries `.id` on it: acc is not an
  // object, so the reduce returns undefined and the placeholder renders to "".
  const out = resolveTemplate("[{{ $json.body.payload.project.id }}]", {
    payload: { project: "not-an-object" },
  });
  assert.equal(out, "[]");
});

test("a prototype key in a payload path is refused (returns empty, no proto read)", () => {
  const out = resolveTemplate("{{ $json.body.payload.__proto__.polluted }}", {
    payload: { a: 1 },
  });
  assert.equal(out, "");
});

test("an unknown / JS expression construct renders to empty", () => {
  // Neither $env nor $json.body.payload → resolveExpr returns undefined → "".
  assert.equal(resolveTemplate("{{ JSON.stringify($json) }}", {}), "");
  assert.equal(resolveTemplate("prefix-{{ someOtherThing }}-suffix", {}), "prefix--suffix");
});

test("an unset $env var renders to empty (value === undefined branch)", () => {
  assert.equal(resolveTemplate("{{ $env.NOT_SET }}", { env: {} }), "");
  assert.equal(resolveTemplate("{{ $env.NOT_SET }}", {}), "");
});

test("isFullyResolved is true once every placeholder is rendered", () => {
  assert.equal(isFullyResolved("={{ $env.HOST }}/x", { env: { HOST: "h" } }), true);
  // Unknown placeholders are still rendered (to ""), so nothing remains → true.
  assert.equal(isFullyResolved("{{ JSON.stringify(x) }}", {}), true);
});
