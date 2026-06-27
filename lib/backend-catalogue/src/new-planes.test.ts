import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { methodologyCatalogue, getMethodology } from "./methodology-catalogue";
import { reportCatalogue, getReport } from "./report-catalogue";
import { screenCatalogue, getScreen } from "./screen-catalogue";
import { PLANES, planeCatalogue } from "./planes";
import { brokerCatalogue } from "./broker-catalogue";
import { backendCatalogue, isAdminOnlyBackend } from "./backend-catalogue";

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

test("notifications speak MQTT (IoT pub/sub) and MCP (AI agent, pull-based)", async () => {
  const { notificationCatalogue } = await import("./notification-catalogue");
  const cat = notificationCatalogue();
  const mqtt = cat.find((n) => n.id === "mqtt");
  assert.equal(mqtt?.kind, "iot");
  assert.equal(mqtt?.capabilities.delivery, "mqtt");
  assert.equal(mqtt?.capabilities.inboundReply, true); // two-way pub/sub
  const mcp = cat.find((n) => n.id === "mcp");
  assert.equal(mcp?.kind, "agent");
  assert.equal(mcp?.capabilities.delivery, "mcp");
});

test("Notion is a report destination channel (broker-delivered)", async () => {
  const { getNotificationChannel } = await import("./notification-catalogue");
  const notion = getNotificationChannel("notion");
  assert.ok(notion);
  assert.ok(notion!.tools.includes("report"), "carries report payloads");
  assert.equal(notion!.capabilities.delivery, "api-key");
});

test("Planview (enterprise) + Celoxis + LiquidPlanner backends are catalogued, capability-honest", async () => {
  const cat = backendCatalogue();
  const planview = cat.find((b) => b.id === "planview");
  assert.equal(planview?.kind, "live");
  assert.equal(planview?.tier, "enterprise");
  assert.equal(planview?.capabilities.portfolio, true);
  assert.ok(planview?.actions.includes("list_projects") && planview?.actions.includes("list_issues"));
  const celoxis = cat.find((b) => b.id === "celoxis");
  assert.equal(celoxis?.tier, "standard");
  assert.equal(celoxis?.capabilities.financials, true);
  const lp = cat.find((b) => b.id === "liquidplanner");
  assert.equal(lp?.capabilities.scheduling, true);
  assert.equal(lp?.capabilities.resources, true);
});

test("INVARIANT: a vendor is only ever a backend/broker/notification/output — never its own plane", async () => {
  const { PLANES, VENDOR_PLANES } = await import("./planes");
  // The four vendor planes, and only those.
  assert.deepEqual([...VENDOR_PLANES].sort(), ["backends", "brokers", "notifications", "outputs"]);
  // Methodologies/reports/screens are vendor-NEUTRAL concepts.
  for (const id of ["methodologies", "reports", "screens"]) {
    assert.equal(PLANES.find((p) => p.id === id)?.vendor, false, `${id} must be a neutral plane`);
  }
  // Every plane is classified (no undefined), and vendor ⊕ neutral partitions them.
  for (const p of PLANES) assert.equal(typeof p.vendor, "boolean");
});

test("HARD RULE: availableReports/availableScreens hide what no connected backend supports", async () => {
  const { availableReports } = await import("./report-catalogue");
  const { availableScreens } = await import("./screen-catalogue");
  // A backend with ONLY issues (no scheduling/financials/portfolio/…): EVM (needs
  // financials) and the Gantt (needs scheduling) must NOT appear.
  const issuesOnly = { issues: true };
  const reports = availableReports(issuesOnly);
  assert.equal(reports.some((r) => r.id === "evm"), false, "no financials ⇒ no EVM");
  assert.equal(reports.some((r) => r.id === "gantt"), false, "no scheduling ⇒ no Gantt report");
  const screens = availableScreens(issuesOnly);
  assert.equal(screens.some((s) => s.id === "gantt"), false, "no scheduling ⇒ no Gantt screen");
  assert.ok(screens.some((s) => s.id === "home"), "capability-free screens still show");
  // Union semantics: with scheduling on (one backend supplies it), Gantt returns.
  assert.ok(availableReports({ issues: true, scheduling: true }).some((r) => r.id === "gantt"));
});

test("backend kinds: Excel is an import source; SQL/Mongo are admin-only databases", () => {
  const cat = backendCatalogue();
  const excel = cat.find((b) => b.id === "excel");
  assert.equal(excel?.kind, "import");
  assert.deepEqual(excel?.brokers, []); // import sources aren't brokered live
  assert.equal(excel?.adminOnly, false);

  for (const id of ["sql", "mongodb"]) {
    const db = cat.find((b) => b.id === id);
    assert.equal(db?.kind, "database", `${id} is a database backend`);
    assert.equal(db?.adminOnly, true, `${id} must be admin-only`);
    assert.ok(db?.brokers.length, `${id} is brokered live (via the http sidecar)`);
    assert.ok(isAdminOnlyBackend(id));
  }
  // A normal SaaS backend stays non-admin + live.
  const jiraLike = cat.find((b) => b.kind === "live" && !b.adminOnly);
  assert.ok(jiraLike, "live, non-admin backends still exist");
});

test("every plane ships dev docs (the file the meta-registry points at exists)", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  for (const p of PLANES) {
    assert.ok(fs.existsSync(path.join(root, p.devDocs)), `missing dev docs for ${p.id}: ${p.devDocs}`);
  }
});
