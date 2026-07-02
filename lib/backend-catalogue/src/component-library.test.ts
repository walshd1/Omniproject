import { test } from "node:test";
import assert from "node:assert/strict";
import { componentLibrary, componentsFor, getComponent } from "./component-library";
import { reportCatalogue } from "./report-catalogue";
import { widgetCatalogue } from "./widget-catalogue";

test("the library unions the report + widget catalogues", () => {
  const lib = componentLibrary();
  assert.equal(lib.length, reportCatalogue().length + widgetCatalogue().length);
  assert.ok(lib.some((c) => c.source === "report"));
  assert.ok(lib.some((c) => c.source === "widget"));
});

test("ids are namespaced by source so report and widget ids never collide", () => {
  const ids = componentLibrary().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("report:") || id.startsWith("widget:")));
});

test("placeableIn: reports place in report+content+export; widgets in dashboard+content+export", () => {
  const report = componentLibrary().find((c) => c.source === "report")!;
  assert.deepEqual(report.placeableIn, ["report", "content", "export"]);
  const widget = componentLibrary().find((c) => c.source === "widget")!;
  assert.deepEqual(widget.placeableIn, ["dashboard", "content", "export"]);
});

test("componentsFor filters by surface and every source shares the content surface", () => {
  const onReports = componentsFor("report");
  assert.ok(onReports.length > 0);
  assert.ok(onReports.every((c) => c.source === "report"));

  const onDash = componentsFor("dashboard");
  assert.ok(onDash.every((c) => c.source === "widget"));

  // content is the shared surface — both sources appear.
  const onContent = componentsFor("content");
  assert.ok(onContent.some((c) => c.source === "report") && onContent.some((c) => c.source === "widget"));
});

test("componentLibrary() is built once at module load — same reference across calls", () => {
  const lib1 = componentLibrary();
  const lib2 = componentLibrary();
  assert.equal(lib1, lib2, "componentLibrary() should return the same cached array reference every call");
});

test("getComponent is backed by a Map (O(1)) and stays consistent with componentLibrary()", () => {
  for (const c of componentLibrary()) {
    assert.equal(getComponent(c.id), c, `getComponent(${c.id}) should return the same object as in componentLibrary()`);
  }
});

test("getComponent resolves a namespaced id and carries the renderer registry", () => {
  const evm = getComponent("report:evm");
  assert.equal(evm?.renderer.registry, "report");
  const health = getComponent("widget:portfolioHealth");
  assert.equal(health?.renderer.registry, "widget");
  assert.equal(health?.renderer.component, "portfolioHealth");
  assert.equal(getComponent("nope:nope"), undefined);
});
