import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { methodologyCatalogue, getMethodology, METHODOLOGIES } from "./methodology-catalogue";
import { reportCatalogue, getReport, reportsForMethodology } from "./report-catalogue";
import { screenCatalogue, getScreen, screensForMethodology } from "./screen-catalogue";
import { PLANES, planeCatalogue, getPlane } from "./planes";
import { brokerCatalogue } from "./broker-catalogue";
import { backendCatalogue, isAdminOnlyBackend } from "./backend-catalogue";

test("planes meta-registry lists all seven planes with dev docs", () => {
  const ids = PLANES.map((p) => p.id).sort();
  assert.deepEqual(ids, ["backends", "brokers", "methodologies", "notifications", "outputs", "reports", "screens"]);
  for (const p of planeCatalogue()) assert.ok(p.label && p.registry && p.devDocs);
});

test("getPlane looks a descriptor up by id (and is undefined for a non-plane)", () => {
  const reports = getPlane("reports");
  assert.equal(reports?.id, "reports");
  assert.equal(reports?.registry, "reportCatalogue");
  assert.equal(getPlane("not-a-plane"), undefined);
});

test("methodologyCatalogue returns an independent defensive copy of every methodology", () => {
  const cat = methodologyCatalogue();
  assert.deepEqual(cat.map((m) => m.id).sort(), METHODOLOGIES.map((m) => m.id).sort());
  // Mutating the copy must not corrupt the shared registry.
  cat[0]!.label = "MUTATED";
  assert.notEqual(getMethodology(cat[0]!.id)?.label, "MUTATED");
});

test("reportsForMethodology / screensForMethodology return tagged plus neutral assets, and exclude other-methodology-only ones", () => {
  const scrumReports = reportsForMethodology("scrum");
  // Burndown is scrum-tagged; it must be present.
  assert.ok(scrumReports.some((r) => r.id === "burndown"));
  // Every returned report is neutral (untagged / "*") or explicitly tags scrum.
  for (const r of scrumReports) {
    assert.ok(!r.methodologies || r.methodologies.includes("*") || r.methodologies.includes("scrum"));
  }
  // A report tagged for OTHER methodologies only must be filtered out.
  const otherOnly = reportCatalogue().find((r) => r.methodologies && !r.methodologies.includes("*") && !r.methodologies.includes("scrum"));
  if (otherOnly) assert.ok(!scrumReports.some((r) => r.id === otherOnly.id));

  const scrumScreens = screensForMethodology("scrum");
  for (const s of scrumScreens) {
    assert.ok(!s.methodologies || s.methodologies.includes("*") || s.methodologies.includes("scrum"));
  }
  // A capability-free, methodology-neutral screen (home) always appears.
  assert.ok(scrumScreens.some((s) => s.id === "home"));
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

test("governance screens (stakeholders / risk register / RACI) gate on their capability", () => {
  assert.equal(getScreen("stakeholders")?.capabilities.requiresCapability, "stakeholders");
  // The risk register is built on RAID, so it rides the raid capability — not a duplicate.
  assert.equal(getScreen("risk-register")?.capabilities.requiresCapability, "raid");
  assert.equal(getScreen("raci-matrix")?.capabilities.requiresCapability, "raci");
  for (const id of ["stakeholders", "risk-register", "raci-matrix"]) {
    assert.ok((getScreen(id)?.tools.length ?? 0) > 0, `${id} declares its panels`);
  }
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

test("backendCatalogue() passes through the raw manifest's verification status unchanged", () => {
  const cat = backendCatalogue();
  const jira = cat.find((b) => b.id === "jira");
  assert.equal(jira?.verification, "catalogued");
  // The generic enterprise catch-all is not a real vendor — flagged experimental, not catalogued.
  const enterprise = cat.find((b) => b.id === "enterprise");
  assert.equal(enterprise?.verification, "experimental");
});

test("SAP S/4HANA PS/PPM financials backend is catalogued, read-only and capability-honest", async () => {
  const cat = backendCatalogue();
  const sapFin = cat.find((b) => b.id === "sap-s4hana-financials");
  assert.ok(sapFin, "sap-s4hana-financials must be catalogued");
  assert.equal(sapFin?.kind, "live");
  assert.equal(sapFin?.tier, "enterprise", "an ERP connector is a premium (enterprise-tier) workflow");
  // Read-only: only the two read contract actions are declared — no
  // create/update/delete_issue, since this connector reads SAP financial
  // context, it does not manage SAP projects (see the write-capable 'sap'
  // backend for that).
  assert.deepEqual([...sapFin!.actions].sort(), ["list_issues", "list_projects"]);
  // Capability-honest: only what the real, documented read APIs back.
  assert.equal(sapFin?.capabilities.financials, true);
  assert.equal(sapFin?.capabilities.portfolio, true);
  assert.equal(sapFin?.capabilities.scheduling, false, "no schedule/date fields are read by this connector");
  assert.equal(sapFin?.capabilities.resources, false, "no resource-assignment data is read by this connector");
  assert.equal(sapFin?.capabilities.raid, false);
  assert.equal(sapFin?.capabilities.baseline, false);
  // Distinct from the existing write-capable 'sap' (WBS-element CRUD) backend —
  // this is an additive, narrower connector, not a replacement.
  const sapWrite = cat.find((b) => b.id === "sap");
  assert.ok(sapWrite, "the original write-capable SAP backend is untouched");
  assert.notEqual(sapWrite?.id, sapFin?.id);
});

test("SAP S/4HANA PS/PPM financials backend maps to real, EXISTING canonical financial fields (no duplicate registry entries)", async () => {
  const { fileURLToPath } = await import("node:url");
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(
    fs.readFileSync(path.join(HERE, "../vendors/backends/sap-s4hana-financials.json"), "utf8"),
  ) as { fieldKeys?: string[] };
  const keys = raw.fieldKeys ?? [];
  assert.ok(keys.length > 0, "the connector must declare its canonical field mapping");
  // Every key it claims must already exist in the canonical field registry —
  // reused, not duplicated (guard-superset enforces this globally too).
  const { FIELDS_DATA } = await import("./fields.generated");
  const registryKeys = new Set(FIELDS_DATA.map((f) => f.key));
  for (const k of keys) assert.ok(registryKeys.has(k), `"${k}" must already be a canonical field`);
  // The financial fields the backlog specifically called out are present.
  for (const k of ["budget", "plannedCost", "actualCost", "currency", "costCenter", "parentTask"]) {
    assert.ok(keys.includes(k), `expected "${k}" to be mapped`);
  }
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
