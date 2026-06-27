import { test } from "node:test";
import assert from "node:assert/strict";
import { VIEWS, getView, viewsForMethodology, methodologyTags } from "./view-catalogue";

/**
 * View catalogue tests — the JSON-defined board views, in display order, and the
 * DERIVED methodology grouping (a methodology is the set of views tagged with it).
 */

test("views are present, id-unique and in display order", () => {
  assert.ok(VIEWS.length >= 6);
  const ids = VIEWS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  const orders = VIEWS.map((v) => v.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), "VIEWS must be in display order");
  assert.equal(VIEWS[0].id, "kanban"); // order 1
});

test("getView resolves by id", () => {
  assert.equal(getView("scrum")?.label, "Scrum Sprint");
  assert.equal(getView("nope"), undefined);
});

test("viewsForMethodology returns tagged views + neutral ones", () => {
  const scrum = viewsForMethodology("scrum").map((v) => v.id);
  assert.ok(scrum.includes("scrum"), "scrum view applies to scrum");
  assert.ok(scrum.includes("list"), "the neutral (*) List view applies to every methodology");
  assert.ok(!scrum.includes("prince2"), "a PRINCE2 view does not apply to scrum");
});

test("methodologyTags is the derived, deduped, neutral-free list", () => {
  const tags = methodologyTags();
  assert.ok(tags.includes("kanban") && tags.includes("scrum") && tags.includes("prince2"));
  assert.ok(!tags.includes("*"), "the neutral marker is not a methodology");
  assert.deepEqual(tags, [...tags].sort(), "tags are sorted + deduped");
});
