import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * HTTP-level coverage for the integration / export / setup / odata / ai /
 * notifications routes. These drive the REAL Express app over a loopback port
 * (no broker configured, so the data layer serves the in-memory demo dataset),
 * exercising the route handlers plus the pure serializers they call
 * (lib/csv, lib/xlsx, lib/pdf, lib/md, lib/odata, lib/metrics).
 *
 * Env is set BEFORE importing the app so module-load-time config is picked up.
 * Demo mode (no OIDC_ISSUER_URL) makes every session an admin, so the
 * admin-gated setup endpoints are reachable. The session cookie is minted the
 * same way security.test.ts does (cookie-parser's signed-cookie format).
 */
const SECRET = "test-session-secret-integration-routes";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "test";
process.env["RATE_LIMIT_DISABLED"] = "true";
delete process.env["OIDC_ISSUER_URL"]; // demo mode → sessions are admin

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}

const SESSION = signedSessionCookie({ sub: "user-1", email: "u@test", roles: [] });

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

const get = (path: string, init?: RequestInit) =>
  fetch(`${base}${path}`, { ...init, headers: { cookie: SESSION, ...(init?.headers ?? {}) } });

// Test-local JSON reader: the endpoints under test return loosely-typed config
// payloads, so we read them as `any` to keep the assertions terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = async (res: Response): Promise<any> => res.json();

// ── Exports (lib/csv, lib/xlsx, lib/pdf, lib/md) ──────────────────────────────

test("GET /api/export.csv returns CSV with a BOM and CRLF rows", async () => {
  const res = await get("/api/export.csv?dataset=projects");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename=".*\.csv"/);
  // Read raw bytes (Response.text() would strip the leading BOM).
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf[0], 0xef); // UTF-8 BOM: EF BB BF
  assert.equal(buf[1], 0xbb);
  assert.equal(buf[2], 0xbf);
  const body = buf.toString("utf8");
  assert.ok(body.includes("\r\n"));
  assert.ok(body.includes("id"));
});

test("GET /api/export.csv rejects an unknown dataset with 400", async () => {
  const res = await get("/api/export.csv?dataset=nope");
  assert.equal(res.status, 400);
  const json = await readJson(res);
  assert.match(json.error, /projects, issues, or activity/);
});

test("GET /api/export.csv for issues honours projectId", async () => {
  const res = await get("/api/export.csv?dataset=issues&projectId=proj-1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /proj-1/);
});

test("GET /api/export.csv for activity", async () => {
  const res = await get("/api/export.csv?dataset=activity");
  assert.equal(res.status, 200);
});

test("GET /api/export.xlsx returns a ZIP (PK) workbook", async () => {
  const res = await get("/api/export.xlsx");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /spreadsheetml\.sheet/);
  const buf = Buffer.from(await res.arrayBuffer());
  // A ZIP container always starts with the local-file-header signature "PK\x03\x04".
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
  assert.ok(buf.length > 100);
});

test("GET /api/export.json returns the raw records", async () => {
  const res = await get("/api/export.json?dataset=projects");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const json = await readJson(res);
  assert.ok(Array.isArray(json));
});

test("GET /api/export.md returns a Markdown table", async () => {
  const res = await get("/api/export.md?dataset=projects");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  const body = await res.text();
  assert.ok(body.includes("|"));
});

test("GET /api/export.pdf returns a PDF", async () => {
  const res = await get("/api/export.pdf?dataset=projects");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/pdf/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("GET /api/export.md rejects an unknown dataset with 400", async () => {
  const res = await get("/api/export.md?dataset=bogus");
  assert.equal(res.status, 400);
});

// ── Integrations: Prometheus metrics + BI feeds (lib/metrics) ─────────────────

test("GET /api/metrics returns Prometheus exposition", async () => {
  const res = await get("/api/metrics");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  const body = await res.text();
  assert.ok(body.includes("# HELP omniproject_projects_total"));
  assert.ok(body.includes("# TYPE omniproject_projects_total gauge"));
  assert.ok(body.includes("omniproject_build_info{app=\"omniproject\"} 1"));
});

test("GET /api/bi/feeds lists JSON/xlsx/odata feeds with absolute URLs", async () => {
  const res = await get("/api/bi/feeds");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok(Array.isArray(json.feeds));
  const names = json.feeds.map((f: { name: string }) => f.name);
  assert.ok(names.includes("projects"));
  assert.ok(names.includes("odata_service"));
  for (const f of json.feeds) assert.match(f.url, /^http:\/\/127\.0\.0\.1:\d+\/api\//);
});

test("GET /api/bi/feeds honours X-Forwarded-* for the origin", async () => {
  const res = await get("/api/bi/feeds", {
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "feeds.example" },
  });
  const json = await readJson(res);
  assert.ok(json.feeds.every((f: { url: string }) => f.url.startsWith("https://feeds.example/")));
});

// ── OData v4 service (lib/odata) ──────────────────────────────────────────────

test("GET /api/odata/ returns the service document", async () => {
  const res = await get("/api/odata/");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.match(json["@odata.context"], /\$metadata$/);
  const sets = json.value.map((v: { name: string }) => v.name);
  assert.deepEqual(sets.sort(), ["Issues", "Programmes", "Projects"]);
});

test("GET /api/odata (no trailing slash) also returns the service document", async () => {
  const res = await get("/api/odata");
  assert.equal(res.status, 200);
});

test("GET /api/odata/$metadata returns EDMX XML", async () => {
  const res = await get("/api/odata/$metadata");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/xml/);
  const body = await res.text();
  assert.ok(body.includes("<edmx:Edmx"));
  assert.ok(body.includes('EntityType Name="Project"'));
});

test("GET /api/odata/Projects returns an entity-set envelope", async () => {
  const res = await get("/api/odata/Projects?$count=true&$top=1");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.match(json["@odata.context"], /#Projects$/);
  assert.equal(typeof json["@odata.count"], "number");
  assert.ok(Array.isArray(json.value));
  assert.ok(json.value.length <= 1);
});

test("GET /api/odata/Issues and /Programmes resolve", async () => {
  for (const set of ["Issues", "Programmes"]) {
    const res = await get(`/api/odata/${set}`);
    assert.equal(res.status, 200, set);
    const json = await readJson(res);
    assert.ok(Array.isArray(json.value), set);
  }
});

// ── AI status route (lib/ai aiStatus) ─────────────────────────────────────────

test("GET /api/ai/status reports the active provider", async () => {
  const res = await get("/api/ai/status");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok("provider" in json);
  assert.ok("configured" in json);
});

test("POST /api/ai/chat rejects a malformed body with 400", async () => {
  const res = await get("/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(res.status, 400);
});

// ── Setup / Connection Center ─────────────────────────────────────────────────

test("GET /api/setup/status reflects the gateway wiring", async () => {
  const res = await get("/api/setup/status");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.equal(json.auth.mode, "demo"); // no OIDC configured
  assert.ok("licensing" in json);
  assert.ok("audit" in json);
  assert.ok("realtime" in json);
  // Multi-replica fan-out modes are surfaced for ops verification.
  assert.ok("scale" in json);
  assert.equal(json.scale.brokerLogBus, "in-process"); // no REDIS_URL in tests
  assert.equal(json.scale.rateLimit, "in-process");
});

// ── Health / readiness / RED metrics (pilot observability) ───────────────────

test("GET /api/healthz is liveness — always ok, no auth, dependency-free", async () => {
  const res = await fetch(`${base}/api/healthz`); // no session cookie
  assert.equal(res.status, 200);
  assert.equal((await readJson(res)).status, "ok");
});

test("GET /api/readyz reports broker reachability (demo → ready)", async () => {
  const res = await fetch(`${base}/api/readyz`);
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.equal(json.ready, true);
  assert.equal(json.kind, "demo");
});

// ── Integration planes: backends / brokers / outputs registries ──────────────

test("GET /api/setup/brokers lists brokers with capabilities + build method", async () => {
  const json = await readJson(await get("/api/setup/brokers"));
  assert.ok(Array.isArray(json) && json.some((b: { id: string }) => b.id === "n8n"));
  const airflow = json.find((b: { id: string }) => b.id === "airflow");
  assert.equal(airflow.dataBroker, false); // async, honestly modelled
});

test("GET /api/setup/outputs lists outward interfaces with capabilities + tools", async () => {
  const json = await readJson(await get("/api/setup/outputs"));
  const mcp = json.find((o: { id: string }) => o.id === "mcp");
  assert.ok(mcp && mcp.tools.includes("omniproject_list_projects"));
});

test("GET /api/setup/notifications lists channels (Slack/Teams/…) with capabilities", async () => {
  const json = await readJson(await get("/api/setup/notifications"));
  const slack = json.find((n: { id: string }) => n.id === "slack");
  assert.ok(slack && slack.capabilities.richFormatting === true);
});

test("GET /api/setup/{methodologies,reports,screens,planes} expose the new planes", async () => {
  const methods = await readJson(await get("/api/setup/methodologies"));
  assert.ok(methods.some((m: { id: string }) => m.id === "scrum"));
  const reports = await readJson(await get("/api/setup/reports"));
  assert.equal(reports.find((r: { id: string }) => r.id === "evm").capabilities.requiresCapability, "financials");
  const screens = await readJson(await get("/api/setup/screens"));
  assert.ok(screens.some((s: { id: string }) => s.id === "gantt"));
  const planes = await readJson(await get("/api/setup/planes"));
  assert.equal(planes.length, 7);
});

test("business ruleset: admin sets a hard rule that then blocks a write (422)", async () => {
  const put = (body: unknown) => get("/api/admin/ruleset", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    // Default: off → a write is allowed by the engine.
    const cat0 = await readJson(await get("/api/admin/ruleset"));
    assert.equal(cat0.find((r: { id: string }) => r.id === "no-deletes").mode, "off");

    // Admin sets no-deletes = hard → a delete is now blocked by the business rule.
    await put({ "no-deletes": "hard" });
    const del = await get("/api/projects/proj-1/issues/iss-001", { method: "DELETE" });
    assert.equal(del.status, 422);
    assert.equal((await readJson(del)).rule, "no-deletes");
  } finally {
    await put({ "no-deletes": "off" }); // reset shared module state
  }
});

// ── MCP server (POST /api/mcp, JSON-RPC) ─────────────────────────────────────

const mcp = (rpc: unknown, init?: RequestInit) =>
  get("/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rpc), ...init });

test("POST /api/mcp requires auth (401 without a session/token)", async () => {
  const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 1, method: "initialize" }) });
  assert.equal(res.status, 401);
});

test("POST /api/mcp initialize + tools/list speak MCP", async () => {
  const init = await readJson(await mcp({ id: 1, method: "initialize" }));
  assert.equal(init.result.serverInfo.name, "omniproject");
  const list = await readJson(await mcp({ id: 2, method: "tools/list" }));
  assert.ok(list.result.tools.some((t: { name: string }) => t.name === "omniproject_list_projects"));
});

test("POST /api/mcp tools/call reads through the broker (demo projects)", async () => {
  const r = await readJson(await mcp({ id: 3, method: "tools/call", params: { name: "omniproject_list_projects", arguments: {} } }));
  const projects = JSON.parse(r.result.content[0].text);
  assert.ok(Array.isArray(projects) && projects.length > 0, "MCP returned the demo projects");
});

test("POST /api/mcp writes are OFF by default — create_issue refused (here be dragons)", async () => {
  // No MCP_WRITE_ENABLED in this test env → write tools hidden + refused.
  const list = await readJson(await mcp({ id: 4, method: "tools/list" }));
  assert.ok(!list.result.tools.some((t: { name: string }) => t.name === "omniproject_create_issue"));
  const call = await readJson(await mcp({ id: 5, method: "tools/call", params: { name: "omniproject_create_issue", arguments: { projectId: "proj-1", title: "nope" } } }));
  assert.equal(call.error.code, -32004);
  assert.match(call.error.message, /disabled/i);
});

test("GET /api/metrics emits RED metrics (rate, errors, duration histogram)", async () => {
  await get("/api/export.csv?dataset=projects"); // generate at least one request
  const res = await get("/api/metrics");
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /omniproject_http_requests_total\{status="2xx"\}/);
  assert.match(text, /omniproject_http_errors_total/);
  assert.match(text, /# TYPE omniproject_http_request_duration_ms histogram/);
  assert.match(text, /omniproject_http_in_flight/);
});

test("GET /api/setup/backends returns the workflow catalogue", async () => {
  const res = await get("/api/setup/backends");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok(Array.isArray(json));
  assert.ok(json.length > 0);
});

test("setup/backends surfaces the Excel import source (kind=import, no live brokers)", async () => {
  const json = await readJson(await get("/api/setup/backends"));
  const excel = json.find((b: { id: string }) => b.id === "excel");
  assert.ok(excel, "Excel backend present");
  assert.equal(excel.kind, "import");
  assert.deepEqual(excel.brokers, [], "an import source is not brokered live");
  assert.equal(excel.adminOnly, false);
});

// ── Tabular import (column/field mapper over HTTP) ────────────────────────────
const postImport = (path: string, body: unknown) =>
  get(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/import/preview auto-maps columns and previews mapped rows", async () => {
  const res = await postImport("/api/import/preview", {
    rows: [{ Summary: "Build login", Owner: "alice", Points: "5", Mystery: "x" }],
  });
  assert.equal(res.status, 200);
  const json = await readJson(res);
  const title = json.mapping.find((m: { column: string }) => m.column === "Summary");
  assert.equal(title.suggestedField, "title");
  assert.ok(json.unmapped.includes("Mystery"));
  assert.equal(json.preview[0].title, "Build login");
  assert.equal(json.preview[0].storyPoints, 5);
});

test("POST /api/import/preview 400s when given neither headers nor rows", async () => {
  const res = await postImport("/api/import/preview", {});
  assert.equal(res.status, 400);
});

test("POST /api/import/commit writes mapped rows through the broker (demo)", async () => {
  const res = await postImport("/api/import/commit", {
    projectId: "proj-1",
    rows: [
      { Summary: "Imported A", Owner: "alice" },
      { Summary: "Imported B", Owner: "bob" },
    ],
  });
  assert.equal(res.status, 201);
  const json = await readJson(res);
  assert.equal(json.created.length, 2);
  assert.equal(json.skipped.length, 0);
  assert.ok(json.fields.some((f: { field: string }) => f.field === "title"));
});

test("POST /api/import/commit 400s without a title column in the mapping", async () => {
  const res = await postImport("/api/import/commit", {
    projectId: "proj-1",
    rows: [{ Owner: "alice", Points: "3" }],
  });
  assert.equal(res.status, 400);
  assert.match((await readJson(res)).error, /title/);
});

test("import/commit honours the business ruleset per row (a hard rule skips the row)", async () => {
  const put = (body: unknown) => get("/api/admin/ruleset", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    await put({ "require-description": "hard" }); // every created issue must have a description
    const res = await postImport("/api/import/commit", {
      projectId: "proj-1",
      rows: [
        { Summary: "Has desc", Details: "a description", Owner: "alice" },
        { Summary: "No desc", Owner: "bob" },
      ],
    });
    // One row passes, one is skipped by the business rule → 207 multi-status.
    assert.equal(res.status, 207);
    const json = await readJson(res);
    assert.equal(json.created.length, 1);
    assert.equal(json.skipped.length, 1);
    assert.equal(json.skipped[0].rule, "require-description");
  } finally {
    await put({ "require-description": "off" });
  }
});

test("GET /api/setup/export?format=env returns dotenv text", async () => {
  const res = await get("/api/setup/export?format=env");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
});

test("GET /api/setup/export?format=compose and k8s are supported formats", async () => {
  for (const format of ["compose", "k8s"]) {
    const res = await get(`/api/setup/export?format=${format}`);
    assert.equal(res.status, 200, format);
  }
});

test("GET /api/setup/snapshot returns a downloadable JSON snapshot", async () => {
  const res = await get("/api/setup/snapshot");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /snapshot\.json/);
  const json = await readJson(res);
  assert.ok(json && typeof json === "object");
});

test("POST /api/setup/test-n8n rejects a non-http URL with 400", async () => {
  const res = await get("/api/setup/test-n8n", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ webhookUrl: "ftp://nope" }),
  });
  assert.equal(res.status, 400);
  const json = await readJson(res);
  assert.equal(json.reachable, false);
});

test("POST /api/setup/generate-workflow 404s for an unknown backend", async () => {
  const res = await get("/api/setup/generate-workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ backendId: "does-not-exist" }),
  });
  assert.equal(res.status, 404);
});

test("POST /api/setup/verify-workflow rejects when no webhook is configured", async () => {
  const res = await get("/api/setup/verify-workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("GET /api/setup/environments returns the store view", async () => {
  const res = await get("/api/setup/environments");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok(json && typeof json === "object");
});

test("POST /api/setup/restore rejects an invalid snapshot with 400", async () => {
  const res = await get("/api/setup/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ not: "a snapshot" }),
  });
  assert.equal(res.status, 400);
  const json = await readJson(res);
  assert.equal(json.restored, false);
});

// ── Notifications SSE stream (routes/notifications-stream) ─────────────────────

test("GET /api/notifications/stream opens an SSE stream with the right headers", async () => {
  const ac = new AbortController();
  const res = await get("/api/notifications/stream", { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.match(res.headers.get("cache-control") ?? "", /no-cache/);

  // Read the initial "ready" frame, then abort so the server-side close handler
  // runs (clearing the keepalive interval and removing the client).
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const chunk = Buffer.from(value!).toString("utf8");
  assert.match(chunk, /event: ready/);
  assert.match(chunk, /"ok":true/);
  ac.abort();
  await reader.cancel().catch(() => {});
});

// Helper for the public POST routes below (no session cookie needed).
const post = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { method: "POST", ...init });

// ── Notification ingest (routes/notifications-stream) ─────────────────────────
// NOTIFY_INGEST_SECRET is read at module load and is unset in this run, so the
// ingest endpoint is disabled (503) — assert that gate.

test("POST /api/notifications/ingest is 503 when ingest is disabled", async () => {
  const res = await post("/api/notifications/ingest", {
    headers: { "content-type": "application/json", authorization: "Bearer anything" },
    body: JSON.stringify({ notification: { title: "hi" } }),
  });
  assert.equal(res.status, 503);
  const json = await readJson(res);
  assert.match(json.error, /ingest disabled/);
});
