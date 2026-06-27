import { test } from "node:test";
import assert from "node:assert/strict";
import { methodologyCatalogue, getMethodology } from "./methodology-catalogue";
import { reportCatalogue, getReport } from "./report-catalogue";
import { screenCatalogue, getScreen } from "./screen-catalogue";
import { PLANES, planeCatalogue } from "./planes";
import { brokerCatalogue } from "./broker-catalogue";

test("planes meta-registry lists all seven planes with dev docs", () => {
  const ids = PLANES.map((p) => p.id).sort();
  assert.deepEqual(ids, ["backends", "brokers", "methodologies", "notifications", "outputs", "reports", "screens"]);
  for (const p of planeCatalogue()) assert.ok(p.label && p.registry && p.devDocs);
});

test("methodologies: capabilities + tools separate but linked; cross-plane declared", () => {
  const scrum = getMethodology("scrum");
  assert.equal(scrum?.kind, "agile");
  assert.equal(scrum?.capabilities.iterations, true);
  assert.ok(scrum?.tools.ceremonies.includes("retrospective"));
  // Scrum spans planes — it also implies reports + screens.
  assert.ok(scrum?.alsoProvides?.some((x) => x.plane === "reports"));
  // Kanban is flow-based: WIP limits, no iterations.
  const kanban = getMethodology("kanban");
  assert.equal(kanban?.capabilities.wipLimits, true);
  assert.equal(kanban?.capabilities.iterations, false);
});

test("reports link to the BACKEND plane via requiresCapability (no false promises)", () => {
  assert.equal(getReport("evm")?.capabilities.requiresCapability, "financials");
  assert.equal(getReport("burndown")?.capabilities.requiresCapability, "history");
  assert.ok(reportCatalogue().every((r) => r.tools.length > 0));
});

test("screens carry their route, required role + capability, and widgets", () => {
  const gantt = getScreen("gantt");
  assert.equal(gantt?.route, "/projects/:id/gantt");
  assert.equal(gantt?.capabilities.requiresCapability, "scheduling");
  assert.equal(getScreen("settings")?.capabilities.requiresRole, "admin");
  assert.ok(screenCatalogue().every((s) => s.tools.length > 0));
});

test("cross-plane: a broker can offer things on other planes (n8n → notifications)", () => {
  const n8n = brokerCatalogue().find((b) => b.id === "n8n");
  assert.ok(n8n?.alsoProvides.some((x) => x.plane === "notifications"));
});
