import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPlaneEntry } from "./plane-verifier";
import { BACKENDS } from "./backend-catalogue";
import { BROKERS } from "./broker-catalogue";
import { OUTPUTS } from "./output-catalogue";
import { NOTIFICATIONS } from "./notification-catalogue";
import { METHODOLOGIES } from "./methodology-catalogue";
import { REPORTS } from "./report-catalogue";
import { SCREENS } from "./screen-catalogue";

test("every SHIPPED entry passes its own plane verifier (verifier ↔ registries can't drift)", () => {
  const planes: [string, unknown[]][] = [
    ["backends", BACKENDS], ["brokers", BROKERS], ["outputs", OUTPUTS], ["notifications", NOTIFICATIONS],
    ["methodologies", METHODOLOGIES], ["reports", REPORTS], ["screens", SCREENS],
  ];
  for (const [plane, entries] of planes) {
    for (const e of entries) {
      const r = verifyPlaneEntry(plane, e);
      assert.ok(r.ok, `${plane}/${(e as { id: string }).id} failed: ${r.errors.join("; ")}`);
    }
  }
});

test("a well-formed new entry passes; missing fields are reported", () => {
  const good = { id: "acme", label: "Acme", route: "/api/acme", kind: "read-api", capabilities: { readOnly: true, streaming: false, auth: "api-token" }, tools: ["x"] };
  assert.equal(verifyPlaneEntry("outputs", good).ok, true);

  const bad = verifyPlaneEntry("outputs", { id: "acme" }); // missing label/route/kind/caps/tools
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("label")) && bad.errors.some((e) => e.includes("route")));
});

test("plane-specific invariants are enforced (broker.synchronous, report.requiresCapability, screen.requiresRole)", () => {
  assert.ok(verifyPlaneEntry("brokers", { id: "b", label: "B", kind: "low-code", capabilities: {}, transports: [], build: "x" }).errors.some((e) => e.includes("synchronous")));
  assert.ok(verifyPlaneEntry("reports", { id: "r", label: "R", kind: "progress", capabilities: {}, tools: [] }).errors.some((e) => e.includes("requiresCapability")));
  assert.ok(verifyPlaneEntry("screens", { id: "s", label: "S", route: "/x", kind: "detail", capabilities: { requiresRole: "wizard" }, tools: [] }).errors.some((e) => e.includes("requiresRole")));
});

test("backends.verification is required and must be one of verified|catalogued|experimental", () => {
  const base = { id: "acme", label: "Acme", primaryRecord: "issue", via: "HTTP", requiredEnv: [], capabilities: {}, authHeader: "x", actions: { list_projects: {}, list_issues: {} } };
  assert.ok(verifyPlaneEntry("backends", base).errors.some((e) => e.includes("verification")), "missing verification must error");
  assert.ok(verifyPlaneEntry("backends", { ...base, verification: "bogus" }).errors.some((e) => e.includes("verification")), "an unrecognised value must error");
  assert.equal(verifyPlaneEntry("backends", { ...base, verification: "catalogued" }).ok, true);
});

test("unknown plane + cross-plane reference checks", () => {
  assert.equal(verifyPlaneEntry("nope", {}).ok, false);
  const r = verifyPlaneEntry("brokers", { id: "b", label: "B", kind: "low-code", capabilities: { synchronous: true }, transports: ["http"], build: "x", alsoProvides: [{ plane: "made-up" }] });
  assert.ok(r.ok); // alsoProvides typo is a warning, not an error
  assert.ok(r.warnings.some((w) => w.includes("made-up")));
});

test("base: both id and label are reported when an entry supplies neither", () => {
  const r = verifyPlaneEntry("outputs", {});
  assert.ok(r.errors.some((e) => e.startsWith("id:")), "missing id must error");
  assert.ok(r.errors.some((e) => e.startsWith("label:")), "missing label must error");
});

test("a non-object entry is rejected outright (before any plane check runs)", () => {
  for (const bad of ["nope", 42, null, [], undefined]) {
    const r = verifyPlaneEntry("outputs", bad);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, ["entry must be an object"], `${JSON.stringify(bad)} is not an object`);
  }
});

test("alsoProvides, when present, must be an array (a non-array is an error, not a warning)", () => {
  const r = verifyPlaneEntry("brokers", { id: "b", label: "B", kind: "low-code", capabilities: { synchronous: true }, transports: ["http"], build: "x", alsoProvides: "reports" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("alsoProvides: must be an array")));
});

test("backends: every field-level guard fires for a fully-empty live backend", () => {
  const r = verifyPlaneEntry("backends", {});
  for (const frag of ["primaryRecord:", "verification:", "via:", "requiredEnv:", "capabilities:", "authHeader OR credentialType", "actions:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("backends: an import source still declares its record but skips auth + contract-action requirements", () => {
  // kind:"import" short-circuits after primaryRecord — no authHeader/credentialType, no actions needed.
  const r = verifyPlaneEntry("backends", { id: "x", label: "X", primaryRecord: "issue", kind: "import", verification: "catalogued", via: "excel", requiredEnv: [], capabilities: {} });
  assert.equal(r.ok, true);
  assert.ok(!r.errors.some((e) => e.includes("authHeader")) && !r.errors.some((e) => e.includes("actions")));
});

test("backends: primaryRecord is required and drives which reads are enforced", () => {
  const noRecord = verifyPlaneEntry("backends", { id: "x", label: "X", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: {}, authHeader: "x", actions: {} });
  assert.ok(noRecord.errors.some((e) => e.includes("primaryRecord:")), "missing primaryRecord must error");
  assert.ok(verifyPlaneEntry("backends", { id: "x", label: "X", primaryRecord: "bogus", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: {}, authHeader: "x", actions: {} }).errors.some((e) => e.includes("primaryRecord:")), "unknown primaryRecord must error");
});

test("backends: an ISSUE backend must expose projects + issues; an INVOICE backend must expose its invoice list", () => {
  // issue backend, empty actions → both PM core reads required, invoice read NOT required.
  const issue = verifyPlaneEntry("backends", { id: "x", label: "X", primaryRecord: "issue", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: {}, authHeader: "x", actions: {} });
  assert.equal(issue.ok, false);
  assert.ok(issue.errors.some((e) => e.includes("list_projects")) && issue.errors.some((e) => e.includes("list_issues")));
  assert.ok(!issue.errors.some((e) => e.includes("list_invoices")));

  // invoice backend → list_invoices required, NOT list_projects/list_issues.
  const billMissing = verifyPlaneEntry("backends", { id: "bill", label: "Bill", primaryRecord: "invoice", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: { financials: true }, authHeader: "x", actions: { create_invoice: { method: "POST", url: "x" } } });
  assert.equal(billMissing.ok, false);
  assert.ok(billMissing.errors.some((e) => e.includes("list_invoices")), "invoice read required");
  assert.ok(!billMissing.errors.some((e) => e.includes("list_projects")), "an invoice backend is NOT forced to expose projects");

  const billOk = verifyPlaneEntry("backends", { id: "bill", label: "Bill", primaryRecord: "invoice", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: { financials: true }, authHeader: "x", actions: { list_invoices: { method: "GET", url: "x" } } });
  assert.equal(billOk.ok, true);

  // client (customer-master) backend → list_clients required, NOT list_projects/list_invoices.
  const clientMissing = verifyPlaneEntry("backends", { id: "crm", label: "CRM", primaryRecord: "client", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: {}, authHeader: "x", actions: { create_client: { method: "POST", url: "x" } } });
  assert.equal(clientMissing.ok, false);
  assert.ok(clientMissing.errors.some((e) => e.includes("list_clients")), "client read required");
  assert.ok(!clientMissing.errors.some((e) => e.includes("list_projects")), "a client backend is NOT forced to expose projects");
  const clientOk = verifyPlaneEntry("backends", { id: "crm", label: "CRM", primaryRecord: "client", kind: "live", verification: "catalogued", via: "http", requiredEnv: [], capabilities: {}, authHeader: "x", actions: { list_clients: { method: "GET", url: "x" } } });
  assert.equal(clientOk.ok, true);
});

test("brokers: every field-level guard fires for a fully-empty entry", () => {
  const r = verifyPlaneEntry("brokers", {});
  for (const frag of ["kind:", "capabilities.synchronous", "transports:", "build:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("outputs: the readOnly boolean guard fires (route/kind/tools already covered)", () => {
  const r = verifyPlaneEntry("outputs", {});
  for (const frag of ["route:", "kind:", "capabilities.readOnly", "tools:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("notifications: kind, delivery and tools guards all fire", () => {
  const r = verifyPlaneEntry("notifications", {});
  for (const frag of ["kind:", "capabilities.delivery", "tools:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("methodologies: kind, capabilities and tools.{states,ceremonies} guards all fire", () => {
  const r = verifyPlaneEntry("methodologies", {});
  for (const frag of ["kind:", "capabilities:", "tools.{states,ceremonies}"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("reports: kind and tools guards fire alongside requiresCapability", () => {
  const r = verifyPlaneEntry("reports", {});
  for (const frag of ["kind:", "requiresCapability", "tools:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});

test("screens: route, kind and tools guards fire alongside requiresRole", () => {
  const r = verifyPlaneEntry("screens", {});
  for (const frag of ["route:", "kind:", "requiresRole", "tools:"]) {
    assert.ok(r.errors.some((e) => e.includes(frag)), `expected error containing "${frag}"`);
  }
});
