import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { evalTemplate, stubContext } from "./lib/n8n-template";
import { runVerification, writeEvidence, flipVerification, extractId, findCollection, type BackendManifest } from "./verify-backend";
import { REPO_ROOT } from "./lib/repo-root";

const BACKENDS_DIR = path.join(REPO_ROOT, "lib/backend-catalogue/vendors/backends");
const load = (id: string): BackendManifest => JSON.parse(fs.readFileSync(path.join(BACKENDS_DIR, `${id}.json`), "utf8")) as BackendManifest;

/**
 * The verify-backend runner certifies a manifest's EXACT templates against a live
 * instance. These tests prove (1) the template evaluator reproduces what n8n would
 * send for the real flagship manifests, (2) the full read+write round trip works
 * over both transports against mock servers, and (3) every http template in the
 * whole catalogue at least evaluates — a compile check for catalogue authors.
 */

test("evaluator: jira templates produce the URLs/bodies n8n would send", () => {
  const jira = load("jira");
  // ZmFrZQ== is base64 "fake" — the repo's known-fake-fixture convention (see .gitleaks.toml).
  const ctx = {
    $env: { JIRA_INSTANCE_URL: "https://acme.atlassian.net", JIRA_BASIC_AUTH: "ZmFrZQ==" },
    $json: { body: { payload: { projectId: "ENG", issueId: "ENG-7", title: "Hello" } } },
  };
  assert.equal(evalTemplate(jira.actions["list_projects"]!.url!, ctx), "https://acme.atlassian.net/rest/api/3/project/search");
  assert.equal(evalTemplate(jira.actions["list_issues"]!.url!, ctx), "https://acme.atlassian.net/rest/api/3/search?jql=project=ENG");
  assert.equal(evalTemplate(jira.actions["delete_issue"]!.url!, ctx), "https://acme.atlassian.net/rest/api/3/issue/ENG-7");
  const body = evalTemplate(jira.actions["create_issue"]!.body!, ctx);
  assert.deepEqual(JSON.parse(String(body)), { fields: { project: { key: "ENG" }, summary: "Hello", issuetype: { name: "Task" } } });
  assert.equal(evalTemplate(jira.authHeader!, ctx), "Basic ZmFrZQ==");
});

test("evaluator: sap OData templates (guid'…' URL interpolation + $format literal)", () => {
  const sap = load("sap");
  const ctx = {
    $env: { SAP_S4_URL: "https://s4.example.com" },
    $json: { body: { payload: { projectId: "guid-p", issueId: "11111111-aaaa-bbbb-cccc-222222222222", title: "T" } } },
  };
  assert.equal(
    evalTemplate(sap.actions["delete_issue"]!.url!, ctx),
    "https://s4.example.com/sap/opu/odata/sap/API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement(guid'11111111-aaaa-bbbb-cccc-222222222222')",
  );
  const listUrl = String(evalTemplate(sap.actions["list_projects"]!.url!, ctx));
  assert.ok(listUrl.endsWith("A_EnterpriseProject?$format=json"), listUrl);
});

test("template-compile sweep: every http template in the catalogue evaluates", () => {
  const ctx = stubContext();
  for (const file of fs.readdirSync(BACKENDS_DIR).filter((f) => f.endsWith(".json"))) {
    const m = JSON.parse(fs.readFileSync(path.join(BACKENDS_DIR, file), "utf8")) as BackendManifest;
    for (const [name, mapping] of Object.entries(m.actions ?? {})) {
      if (!mapping || (mapping.kind ?? "http") !== "http") continue;
      if (mapping.url) {
        const url = evalTemplate(mapping.url, ctx);
        assert.equal(typeof url, "string", `${m.id}.${name}.url should evaluate to a string`);
        assert.doesNotThrow(() => new URL(String(url)), `${m.id}.${name}.url should be a valid URL: ${String(url)}`);
      }
      if (mapping.body) {
        assert.doesNotThrow(() => evalTemplate(mapping.body!, ctx), `${m.id}.${name}.body should evaluate`);
      }
    }
    if (m.authHeader) assert.doesNotThrow(() => evalTemplate(m.authHeader!, ctx), `${m.id}.authHeader should evaluate`);
  }
});

test("id/collection extraction handles the flagship response shapes", () => {
  assert.equal(extractId({ id: "10001", key: "ENG-1" }), "10001");
  assert.equal(extractId({ data: { gid: "120" } }), "120"); // Asana
  assert.equal(extractId({ result: { sys_id: "abc" } }), "abc"); // ServiceNow
  assert.equal(extractId({ d: { ProjectElementUUID: "u-1" } }), "u-1"); // SAP OData v2
  assert.equal(findCollection({ values: [{ id: 1 }] })!.length, 1); // Jira project search
  assert.equal(findCollection({ issues: [] })!.length, 0); // Jira search
  assert.equal(findCollection({ d: { results: [{ a: 1 }, { b: 2 }] } })!.length, 2); // SAP
  assert.equal(findCollection({ nothing: true }), null);
});

/** A minimal Jira-shaped mock: enough surface for the direct-mode round trip. */
type SeenRequest = { method: string; url: string; auth: string | undefined; idem: string | undefined };
function mockJira(): Promise<{ server: http.Server; port: number; requests: SeenRequest[]; deleted: string[] }> {
  const requests: SeenRequest[] = [];
  const deleted: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, idem: req.headers["x-omniproject-idempotency-key"] as string | undefined });
    const send = (code: number, body: unknown): void => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/rest/api/3/project/search") return send(200, { values: [{ id: "10000", key: "ENG" }] });
    if (req.url!.startsWith("/rest/api/3/search")) return send(200, { issues: [] });
    if (req.method === "POST" && req.url === "/rest/api/3/issue") return send(201, { id: "20001", key: "ENG-9" });
    if (req.method === "PUT" && req.url!.startsWith("/rest/api/3/issue/")) return send(204, {});
    if (req.method === "DELETE" && req.url!.startsWith("/rest/api/3/issue/")) {
      deleted.push(req.url!.split("/").pop()!);
      return send(204, {});
    }
    return send(404, { error: "unexpected route" });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, requests, deleted }));
  });
}

test("direct mode: full jira read+write round trip against a mock, auth + idempotency + cleanup", async () => {
  const { server, port, requests, deleted } = await mockJira();
  try {
    const outcome = await runVerification(load("jira"), {
      write: true,
      env: { JIRA_INSTANCE_URL: `http://127.0.0.1:${port}`, JIRA_BASIC_AUTH: "ZmFrZQ==" },
    });
    assert.ok(outcome.passed, JSON.stringify(outcome.checks, null, 2));
    assert.equal(outcome.mode, "direct");
    assert.ok(outcome.checks.some((c) => c.name.startsWith("create_issue")));
    // The exact auth template was applied to every request…
    assert.ok(requests.every((r) => r.auth === "Basic ZmFrZQ=="));
    // …writes carried the idempotency key, reads did not…
    assert.ok(requests.filter((r) => r.method !== "GET").every((r) => !!r.idem));
    assert.ok(requests.filter((r) => r.method === "GET").every((r) => !r.idem));
    // …and the probe was cleaned up (created id 20001; extractId prefers "id").
    assert.deepEqual(deleted, ["20001"]);
  } finally {
    server.close();
  }
});

test("direct mode: missing env fails closed with the exact names", async () => {
  const outcome = await runVerification(load("jira"), { env: {} });
  assert.equal(outcome.passed, false);
  const envCheck = outcome.checks.find((c) => c.name === "required env present")!;
  assert.equal(envCheck.ok, false);
  assert.match(envCheck.detail!, /JIRA_INSTANCE_URL/);
  assert.equal(outcome.checks.length, 1, "nothing network-shaped runs without env");
});

test("direct mode refuses a native-node backend and points at --webhook", async () => {
  const outcome = await runVerification(load("asana"), { env: { ASANA_WORKSPACE_ID: "ws" } });
  assert.equal(outcome.passed, false);
  const c = outcome.checks.find((x) => x.name === "direct mode supported")!;
  assert.equal(c.ok, false);
  assert.match(c.detail!, /--webhook/);
});

/** A mock of the GENERATED workflow's webhook: contract envelope in, { success, data } out. */
function mockWebhook(backendId: string): Promise<{ server: http.Server; port: number; actions: string[] }> {
  const actions: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as { action: string; verify?: boolean; payload: Record<string, unknown> };
      actions.push(body.action);
      const send = (data: unknown): void => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data, message: `${body.action} ok` }));
      };
      if (body.verify) return send({ action: body.action, verified: true, backend: backendId, capabilities: {} });
      if (body.action === "list_projects") return send([{ gid: "120", name: "Roadmap" }]);
      if (body.action === "list_issues") return send([]);
      if (body.action === "create_issue") return send({ data: { gid: "9001" } });
      if (body.action === "update_issue" || body.action === "delete_issue") return send({ ok: true });
      return send({});
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, actions }));
  });
}

test("webhook mode: asana round trip through the contract envelope, handshake first", async () => {
  const { server, port, actions } = await mockWebhook("asana");
  try {
    const outcome = await runVerification(load("asana"), { write: true, webhookUrl: `http://127.0.0.1:${port}/webhook/omni-asana` });
    assert.ok(outcome.passed, JSON.stringify(outcome.checks, null, 2));
    assert.equal(outcome.mode, "webhook");
    assert.equal(actions[0], "get_capabilities", "verify handshake goes first");
    assert.deepEqual(actions.slice(1), ["list_projects", "list_issues", "create_issue", "update_issue", "delete_issue"]);
  } finally {
    server.close();
  }
});

test("webhook mode: a wrong-backend ACK fails the handshake and stops", async () => {
  const { server, port, actions } = await mockWebhook("jira"); // claims jira, we verify asana
  try {
    const outcome = await runVerification(load("asana"), { webhookUrl: `http://127.0.0.1:${port}/x` });
    assert.equal(outcome.passed, false);
    assert.deepEqual(actions, ["get_capabilities"], "no data action runs after a failed handshake");
  } finally {
    server.close();
  }
});

test("evidence file: structured, credential-free, written where the catalogue expects it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-evidence-"));
  try {
    const outcome = await runVerification(load("jira"), { env: {} });
    const file = writeEvidence(outcome, dir);
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(saved["backend"], "jira");
    assert.equal(saved["passed"], false);
    assert.ok(Array.isArray(saved["checks"]));
    assert.ok(!JSON.stringify(saved).includes("JIRA_BASIC_AUTH="), "no env values in evidence");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flipVerification rewrites only the verification field, byte-targeted", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-flip-"));
  const dir = path.join(root, "lib/backend-catalogue/vendors/backends");
  fs.mkdirSync(dir, { recursive: true });
  const original = fs.readFileSync(path.join(BACKENDS_DIR, "jira.json"), "utf8");
  fs.writeFileSync(path.join(dir, "jira.json"), original);
  try {
    const file = flipVerification("jira", root);
    const after = fs.readFileSync(file, "utf8");
    assert.match(after, /"verification": "verified"/);
    // Everything else is byte-identical (no reformat).
    assert.equal(after.replace('"verification": "verified"', '"verification": "catalogued"'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
