import { test } from "node:test";
import assert from "node:assert/strict";
import { WIDGETS, widgetDef, widgetCatalogue, availableWidgets } from "./widget-catalogue";

test("the widget catalogue is populated and ordered", () => {
  assert.ok(WIDGETS.length >= 6);
  const orders = WIDGETS.map((w) => w.order ?? 0);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test("widgetDef looks a widget up by type", () => {
  assert.equal(widgetDef("portfolioHealth")?.label, "Portfolio health");
  assert.equal(widgetDef("nope"), undefined);
});

test("availableWidgets drops entity-gated widgets the backend can't surface", () => {
  const all = availableWidgets(() => true).map((w) => w.type);
  assert.ok(all.includes("programmeCount"));
  const noProgramme = availableWidgets((e) => e !== "programme").map((w) => w.type);
  assert.ok(!noProgramme.includes("programmeCount"));
  // ungated widgets are always offered
  assert.ok(noProgramme.includes("portfolioHealth"));
});

test("widgetCatalogue returns a defensive copy", () => {
  const a = widgetCatalogue();
  a[0]!.label = "mutated";
  assert.notEqual(widgetDef(a[0]!.type)?.label, "mutated");
});
