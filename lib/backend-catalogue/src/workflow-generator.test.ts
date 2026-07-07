import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorkflow, titleFor } from "./workflow-generator";
import type { BackendDefinition } from "./backend-catalogue";

/**
 * Pure n8n workflow generator tests. Everything here is deterministic JSON
 * construction, so we assert on concrete node/connection shapes and every
 * transport/credential/write branch rather than round-tripping through n8n.
 */

/** A minimal HTTP backend that carries a per-user auth header and both a read and a write action. */
function httpBackend(overrides: Partial<BackendDefinition> = {}): BackendDefinition {
  return {
    id: "acme",
    label: "Acme Tracker",
    docsUrl: "https://example.test/docs",
    verification: "catalogued",
    via: "HTTP bearer",
    requiredEnv: ["ACME_URL", "ACME_TOKEN"],
    capabilities: { issues: true, projects: true },
    authHeader: "=Bearer {{ $json.body.payload.userContext.token }}",
    actions: {
      list_issues: { method: "GET", url: "https://example.test/issues" },
      create_issue: { method: "POST", url: "https://example.test/issues", body: "={{ $json.body.payload }}" },
    },
    ...overrides,
  } as BackendDefinition;
}

function nodeByName(wf: ReturnType<typeof generateWorkflow>, name: string) {
  return wf.nodes.find((n) => n.name === name);
}

test("generateWorkflow builds the fixed scaffold plus a switch, per-action, and response nodes", () => {
  const wf = generateWorkflow(httpBackend());
  for (const name of ["Webhook", "Verify probe?", "Verify ACK", "Drop loop?", "Drop (loop)", "Route Action", "Normalize → BrokerActionResult", "Unsupported Action", "Respond", "Capabilities"]) {
    assert.ok(nodeByName(wf, name), `expected a "${name}" node`);
  }
  assert.equal(wf.active, false);
  assert.equal(wf.settings.executionOrder, "v1");
  assert.equal(wf.name, "OmniProject — Acme Tracker");
  assert.equal(wf.meta.templateId, "omniproject-acme");
  assert.match(wf.meta.description, /Set env: ACME_URL, ACME_TOKEN\./);
});

test("node ids are unique and UUID-shaped", () => {
  const wf = generateWorkflow(httpBackend());
  const ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  for (const id of ids) {
    assert.match(id, /^aaaaaaaa-0000-4000-8000-[0-9a-f]{12}$/);
  }
});

test("get_capabilities is auto-appended when a backend omits it, and gets a Capabilities code node wired to Respond", () => {
  const wf = generateWorkflow(httpBackend());
  const caps = nodeByName(wf, "Capabilities")!;
  assert.equal(caps.type, "n8n-nodes-base.code");
  // Capabilities routes straight to Respond, not through Normalize.
  assert.deepEqual(wf.connections["Capabilities"], { main: [[{ node: "Respond", type: "main", index: 0 }]] });
});

test("an HTTP action with no credential forwards the per-user Authorization header", () => {
  const wf = generateWorkflow(httpBackend());
  const list = nodeByName(wf, "List Issues")!;
  assert.equal(list.type, "n8n-nodes-base.httpRequest");
  assert.equal(list.parameters["method"], "GET");
  assert.equal(list.parameters["sendHeaders"], true);
  const headers = (list.parameters["headerParameters"] as { parameters: Array<{ name: string }> }).parameters;
  assert.ok(headers.some((h) => h.name === "Authorization"));
  // Read action carries no idempotency key.
  assert.ok(!headers.some((h) => h.name === "X-OmniProject-Idempotency-Key"));
  // No managed credential, so no authentication params.
  assert.equal(list.parameters["authentication"], undefined);
  assert.equal(list.credentials, undefined);
});

test("a write action gets the idempotency header, a JSON body, and routes to Normalize", () => {
  const wf = generateWorkflow(httpBackend());
  const create = nodeByName(wf, "Create Issue")!;
  const headers = (create.parameters["headerParameters"] as { parameters: Array<{ name: string }> }).parameters;
  assert.ok(headers.some((h) => h.name === "X-OmniProject-Idempotency-Key"));
  assert.equal(create.parameters["sendBody"], true);
  assert.equal(create.parameters["specifyBody"], "json");
  assert.equal(create.parameters["jsonBody"], "={{ $json.body.payload }}");
  assert.deepEqual(wf.connections["Create Issue"], { main: [[{ node: "Normalize → BrokerActionResult", type: "main", index: 0 }]] });
});

test("a managed credentialType switches to predefinedCredentialType, drops the Authorization header, and attaches a credential placeholder", () => {
  const wf = generateWorkflow(httpBackend({ credentialType: "acmeOAuth2Api" }));
  const list = nodeByName(wf, "List Issues")!;
  assert.equal(list.parameters["authentication"], "predefinedCredentialType");
  assert.equal(list.parameters["nodeCredentialType"], "acmeOAuth2Api");
  const headers = (list.parameters["headerParameters"] as { parameters: Array<{ name: string }> }).parameters;
  assert.ok(!headers.some((h) => h.name === "Authorization"), "managed cred takes over auth");
  assert.equal(list.parameters["sendHeaders"], false, "no headers left to send for a pure read under managed auth");
  assert.deepEqual(list.credentials, { acmeOAuth2Api: { id: "", name: "Acme Tracker account" } });
});

test("a per-action credentialType overrides the manifest-level one, and a note is carried through", () => {
  const wf = generateWorkflow(httpBackend({
    credentialType: "manifestCred",
    actions: {
      list_issues: { method: "GET", url: "https://example.test/issues", credentialType: "actionCred", note: "reads the backlog" },
    },
  }));
  const list = nodeByName(wf, "List Issues")!;
  assert.equal(list.parameters["nodeCredentialType"], "actionCred");
  assert.deepEqual(list.credentials, { actionCred: { id: "", name: "Acme Tracker account" } });
  assert.equal(list.notes, "reads the backlog");
});

test("an n8nNode action becomes a native node with its parameters, type and typeVersion defaults", () => {
  const wf = generateWorkflow(httpBackend({
    actions: {
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.asana", parameters: { resource: "task", operation: "getAll" } },
    },
  }));
  const list = nodeByName(wf, "List Issues")!;
  assert.equal(list.type, "n8n-nodes-base.asana");
  assert.equal(list.typeVersion, 1, "defaults typeVersion to 1 when unset");
  assert.deepEqual(list.parameters, { resource: "task", operation: "getAll" });
});

test("an n8nNode action honours an explicit typeVersion and defaults parameters to {}", () => {
  const wf = generateWorkflow(httpBackend({
    actions: {
      list_issues: { kind: "n8nNode", node: "n8n-nodes-base.github", typeVersion: 2 },
    },
  }));
  const list = nodeByName(wf, "List Issues")!;
  assert.equal(list.typeVersion, 2);
  assert.deepEqual(list.parameters, {});
});

test("an n8nNode action with no node type throws a descriptive error", () => {
  assert.throws(
    () => generateWorkflow(httpBackend({
      actions: { list_issues: { kind: "n8nNode" } },
    })),
    /backend "acme" action "list_issues" declares kind: "n8nNode" but has no "node" type/,
  );
});

test("readOnly omits every write action outright and annotates the workflow", () => {
  const wf = generateWorkflow(httpBackend({
    actions: {
      list_issues: { method: "GET", url: "https://example.test/issues" },
      create_issue: { method: "POST", url: "https://example.test/issues" },
      update_issue: { method: "PATCH", url: "https://example.test/issues" },
      delete_issue: { method: "DELETE", url: "https://example.test/issues" },
    },
  }), { readOnly: true });
  assert.ok(!nodeByName(wf, "Create Issue"), "no write node should exist");
  assert.ok(!nodeByName(wf, "Update Issue"));
  assert.ok(!nodeByName(wf, "Delete Issue"));
  assert.ok(nodeByName(wf, "List Issues"));
  assert.match(wf.name, /\(read-only\)$/);
  assert.match(wf.meta.description, /Read-only: no write actions are included/);
});

test("webhookPath defaults to 'omniproject' and trims/falls back on blank input", () => {
  const path = (wf: ReturnType<typeof generateWorkflow>) => (nodeByName(wf, "Webhook")!.parameters["path"] as string);
  assert.equal(path(generateWorkflow(httpBackend())), "omniproject");
  assert.equal(path(generateWorkflow(httpBackend(), { webhookPath: "   " })), "omniproject", "blank falls back");
  assert.equal(path(generateWorkflow(httpBackend(), { webhookPath: "  custom-hook  " })), "custom-hook", "trimmed");
});

test("the Route Action switch has one rule per action plus a fallback wired to Unsupported Action", () => {
  const wf = generateWorkflow(httpBackend());
  const route = nodeByName(wf, "Route Action")!;
  const rules = (route.parameters["rules"] as { values: unknown[] }).values;
  // list_issues + create_issue + get_capabilities = 3 rules.
  assert.equal(rules.length, 3);
  // Fallback output index (== number of rule outputs) points at the unsupported handler.
  const fallback = wf.connections["Route Action"]!.main.at(-1)!;
  assert.deepEqual(fallback, [{ node: "Unsupported Action", type: "main", index: 0 }]);
});

test("scaffold wiring: verify short-circuit, loop guard and terminal respond connections", () => {
  const wf = generateWorkflow(httpBackend());
  assert.deepEqual(wf.connections["Webhook"], { main: [[{ node: "Verify probe?", type: "main", index: 0 }]] });
  // Verify probe? true→Verify ACK (out 0), false→Drop loop? (out 1).
  assert.deepEqual(wf.connections["Verify probe?"]!.main[0], [{ node: "Verify ACK", type: "main", index: 0 }]);
  assert.deepEqual(wf.connections["Verify probe?"]!.main[1], [{ node: "Drop loop?", type: "main", index: 0 }]);
  assert.deepEqual(wf.connections["Verify ACK"], { main: [[{ node: "Respond", type: "main", index: 0 }]] });
  assert.deepEqual(wf.connections["Drop (loop)"], { main: [[{ node: "Respond", type: "main", index: 0 }]] });
});

test("titleFor turns a snake_case action into Title Case", () => {
  assert.equal(titleFor("create_issue"), "Create Issue");
  assert.equal(titleFor("get_capabilities"), "Get Capabilities");
  assert.equal(titleFor("list_projects"), "List Projects");
});
