/**
 * verify-n8n-bidirectional.ts
 *
 * Tests the bidirectional n8n data contract:
 *   Outbound: Next.js/Express proxy → n8n webhook (mocked)
 *   Inbound:  n8n normalized state payload → parsed by proxy
 *
 * Run: pnpm --filter @workspace/scripts run verify-n8n
 */

import http from "http";
import { URL } from "url";

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ── Test state ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ${green("✓")} ${label}`);
    passed++;
  } else {
    console.log(`  ${red("✗")} ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Mock n8n server ───────────────────────────────────────────────────────────
interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

const capturedRequests: MockRequest[] = [];

const MOCK_N8N_PORT = 19_678;

const N8N_INBOUND_RESPONSE = {
  success: true,
  data: {
    normalized: true,
    source: "plane",
    projects: [
      { id: "p1", name: "Alpha", status: "active", issueCount: 5 },
      { id: "p2", name: "Beta", status: "active", issueCount: 12 },
    ],
    timestamp: new Date().toISOString(),
  },
  message: "State synced from Plane",
};

// Action-aware responses: the gateway now brokers every data action through
// n8n, so the mock returns normalized payloads per action (mirroring what a
// real n8n workflow over Plane/OpenProject would return).
function mockResponseFor(action: string): Record<string, unknown> {
  switch (action) {
    case "list_projects":
      return {
        success: true,
        data: [
          { id: "p1", name: "Alpha", identifier: "ALP", source: "plane", issueCount: 5, completedCount: 2, memberCount: 3, updatedAt: new Date().toISOString() },
          { id: "p2", name: "Beta", identifier: "BET", source: "openproject", issueCount: 12, completedCount: 6, memberCount: 4, updatedAt: new Date().toISOString() },
        ],
      };
    case "list_issues":
      return {
        success: true,
        data: [
          { id: "i1", projectId: "p1", title: "Issue One", status: "todo", priority: "high", labels: ["x"], source: "plane", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
      };
    case "list_activity":
      return { success: true, data: [{ id: "a1", action: "issue_created", actor: "alice", projectId: "p1", timestamp: new Date().toISOString() }] };
    case "project_summary":
      return { success: true, data: { projectId: "p1", total: 5, byStatus: { todo: 3, done: 2 }, byPriority: { high: 2 }, completionRate: 40, overdue: 1 } };
    case "create_issue":
      return { success: true, data: { id: "i-new", projectId: "p1", title: "Created", status: "backlog", priority: "none", labels: [], source: "plane", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    case "update_issue":
      return { success: true, data: { id: "i1", projectId: "p1", title: "Updated", status: "done", priority: "high", labels: [], source: "plane", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    case "delete_issue":
      return { success: true, data: {} };
    case "get_capabilities":
      return { success: true, data: { issues: true, scheduling: true, resources: true, financials: true, portfolio: true, baseline: true, blockers: true, history: true, raid: true } };
    case "get_project_history":
      return { success: true, data: [{ date: "2026-06-01", completionRate: 20, totalIssues: 5, completedIssues: 1, openBlockers: 1 }, { date: "2026-06-15", completionRate: 60, totalIssues: 5, completedIssues: 3, openBlockers: 0 }] };
    case "get_baseline":
      return { success: true, data: { projectId: "p1", name: "Q2 Baseline", capturedAt: new Date().toISOString(), items: [{ issueId: "i1", title: "Issue One", plannedStart: "2026-06-01", plannedFinish: "2026-06-20" }] } };
    case "get_raid":
      return { success: true, data: [{ id: "r1", projectId: "p1", type: "risk", title: "Backend risk", severity: "high", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] };
    case "create_raid_entry":
      return { success: true, data: { id: "r-new", projectId: "p1", type: "risk", title: "Created", severity: "low", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    case "get_notifications":
      return { success: true, data: [{ id: "n1", kind: "assignment", title: "Assigned to you", read: false, timestamp: new Date().toISOString() }] };
    default:
      // sync_state / create_ticket and anything else → the normalized payload.
      return N8N_INBOUND_RESPONSE;
  }
}

function startMockN8n(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }

        capturedRequests.push({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: parsed,
        });

        // Respond per the action the gateway forwarded.
        const action =
          parsed && typeof parsed === "object" ? String((parsed as { action?: unknown }).action ?? "") : "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockResponseFor(action)));
      });
    });

    server.listen(MOCK_N8N_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

// ── Session (auth) ────────────────────────────────────────────────────────────
// Protected routes require a session cookie. In the absence of a configured
// OIDC provider the server runs in demo mode, so GET /api/auth/login issues a
// local session cookie we can reuse for the rest of the run.
let sessionCookie = "";

function login(apiBase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${apiBase}/api/auth/login`);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "GET",
      },
      (res) => {
        const setCookie = res.headers["set-cookie"];
        if (setCookie && setCookie.length > 0) {
          sessionCookie = setCookie.map((c) => c.split(";")[0]).join("; ");
        }
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.setTimeout(8_000, () => {
      req.destroy();
      reject(new Error("Login request timeout"));
    });
    req.end();
  });
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(8_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(payload);
    req.end();
  });
}

function patch(url: string, body: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(8_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.write(payload);
    req.end();
  });
}

function get(url: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "GET",
        headers: sessionCookie ? { Cookie: sessionCookie } : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(8_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

// ── Test suites ───────────────────────────────────────────────────────────────
async function testOutbound(apiBase: string) {
  console.log(bold("\n[1] Outbound: UI → n8n (via /api/n8n-proxy)"));

  const payload = {
    action: "create_ticket",
    payload: {
      projectId: "proj-001",
      title: "Test Issue from OmniProject",
      priority: "high",
      status: "backlog",
    },
    source: "plane",
  };

  let result: { status: number; data: unknown };

  try {
    result = await post(`${apiBase}/api/n8n-proxy`, payload, {
      Authorization: "Bearer mock-oidc-token-abc123",
    });
  } catch (err) {
    assert("Proxy request reachable", false, String(err));
    return;
  }

  assert("Proxy returns HTTP 200", result.status === 200, `got ${result.status}`);

  const data = result.data as Record<string, unknown>;
  assert("Response has success=true", data?.success === true, JSON.stringify(data));
  assert("Response has data payload", typeof data?.data === "object");

  const captured = capturedRequests.at(-1);
  assert("n8n received the request", !!captured);

  if (captured) {
    assert(
      "n8n received Authorization header",
      captured.headers["authorization"] === "Bearer mock-oidc-token-abc123",
      String(captured.headers["authorization"]),
    );
    assert(
      "n8n received X-OmniProject-Action header",
      captured.headers["x-omniproject-action"] === "create_ticket",
    );
    assert(
      "n8n received X-OmniProject-Source header",
      captured.headers["x-omniproject-source"] === "plane",
    );

    const idemKey = captured.headers["x-omniproject-idempotency-key"];
    assert(
      "n8n received X-OmniProject-Idempotency-Key (sha256)",
      typeof idemKey === "string" && /^[0-9a-f]{64}$/.test(idemKey),
      String(idemKey),
    );
    assert(
      "n8n received X-OmniProject-Origin header",
      captured.headers["x-omniproject-origin"] === "omniproject",
    );

    const capturedBody = captured.body as Record<string, unknown>;
    assert("n8n received action field", capturedBody?.action === "create_ticket");
    assert("n8n received payload.title", (capturedBody?.payload as Record<string, unknown>)?.title === "Test Issue from OmniProject");
    assert("n8n received body.origin = omniproject", capturedBody?.origin === "omniproject");
    assert("n8n received body.idempotencyKey", typeof capturedBody?.idempotencyKey === "string");

    const userContext = (capturedBody?.payload as Record<string, unknown>)?.userContext as
      | Record<string, unknown>
      | undefined;
    assert("n8n received payload.userContext (impersonation)", !!userContext && typeof userContext.email === "string");
  }
}

async function testInbound(apiBase: string) {
  console.log(bold("\n[2] Inbound: n8n response → parsed by proxy"));

  const payload = {
    action: "sync_state",
    payload: { source: "plane", projectId: "proj-001" },
    source: "plane",
  };

  let result: { status: number; data: unknown };
  try {
    result = await post(`${apiBase}/api/n8n-proxy`, payload);
  } catch (err) {
    assert("Inbound proxy request reachable", false, String(err));
    return;
  }

  const data = result.data as Record<string, unknown>;
  assert("Response parses successfully", typeof data === "object");
  assert("success field present", "success" in data);

  const inner = data?.data as Record<string, unknown> | undefined;
  assert("Normalized data field present", typeof inner === "object", JSON.stringify(inner));

  if (inner) {
    assert("normalized=true in payload", inner.normalized === true);
    assert("projects array in payload", Array.isArray(inner.projects));
    if (Array.isArray(inner.projects)) {
      assert("projects has items", inner.projects.length > 0);
      assert(
        "project item has id+name",
        typeof (inner.projects[0] as Record<string, unknown>)?.id === "string" &&
          typeof (inner.projects[0] as Record<string, unknown>)?.name === "string",
      );
    }
  }
}

async function testValidation(apiBase: string) {
  console.log(bold("\n[3] Validation: bad payloads rejected"));

  let res: { status: number; data: unknown };

  // Missing required `action` field
  try {
    res = await post(`${apiBase}/api/n8n-proxy`, { payload: { foo: "bar" } });
    assert("Missing action returns 400", res.status === 400, `got ${res.status}`);
  } catch {
    assert("Missing action reachable", false, "request failed");
  }

  // Missing required `payload` field
  try {
    res = await post(`${apiBase}/api/n8n-proxy`, { action: "create_ticket" });
    assert("Missing payload returns 400", res.status === 400, `got ${res.status}`);
  } catch {
    assert("Missing payload reachable", false, "request failed");
  }

  // Empty body
  try {
    res = await post(`${apiBase}/api/n8n-proxy`, {});
    assert("Empty body returns 400", res.status === 400, `got ${res.status}`);
  } catch {
    assert("Empty body reachable", false, "request failed");
  }
}

async function testApiRoutes(apiBase: string) {
  console.log(bold("\n[4] API routes: projects + activity + settings"));

  // Projects
  try {
    const r = await get(`${apiBase}/api/projects`);
    assert("GET /api/projects returns 200", r.status === 200);
    assert("Returns array", Array.isArray(r.data));
    if (Array.isArray(r.data)) {
      assert("Has at least one project", r.data.length > 0);
      const p = r.data[0] as Record<string, unknown>;
      assert("Project has required fields", !!(p.id && p.name && p.source));
    }
  } catch {
    assert("GET /api/projects reachable", false);
  }

  // Activity
  try {
    const r = await get(`${apiBase}/api/activity`);
    assert("GET /api/activity returns 200", r.status === 200);
    assert("Returns array", Array.isArray(r.data));
  } catch {
    assert("GET /api/activity reachable", false);
  }

  // Settings
  try {
    const r = await get(`${apiBase}/api/settings`);
    assert("GET /api/settings returns 200", r.status === 200);
    const s = r.data as Record<string, unknown>;
    assert("Settings has aiProvider", "aiProvider" in s);
    assert("Settings has backendSource", "backendSource" in s);
  } catch {
    assert("GET /api/settings reachable", false);
  }

  // Health check
  try {
    const r = await get(`${apiBase}/api/healthz`);
    assert("GET /api/healthz returns 200", r.status === 200);
  } catch {
    assert("GET /api/healthz reachable", false);
  }

  // Capabilities
  try {
    const r = await get(`${apiBase}/api/capabilities`);
    assert("GET /api/capabilities returns 200", r.status === 200);
    const c = r.data as Record<string, unknown>;
    assert("Capabilities has mode", typeof c.mode === "string");
    assert("Capabilities has boolean domains", typeof c.issues === "boolean" && typeof c.resources === "boolean");
    assert("Capabilities exposes history + raid domains", typeof c.history === "boolean" && typeof c.raid === "boolean");
  } catch {
    assert("GET /api/capabilities reachable", false);
  }

  // AI status
  try {
    const r = await get(`${apiBase}/api/ai/status`);
    assert("GET /api/ai/status returns 200", r.status === 200);
    const s = r.data as Record<string, unknown>;
    assert("AI status has provider", "provider" in s);
    assert("AI status has configured flag", typeof s.configured === "boolean");
  } catch {
    assert("GET /api/ai/status reachable", false);
  }
}

async function testAuth(apiBase: string) {
  console.log(bold("\n[0] Auth: session gate + login flow"));

  // Protected route must reject unauthenticated requests.
  try {
    const r = await get(`${apiBase}/api/projects`);
    assert("Unauthenticated /api/projects returns 401", r.status === 401, `got ${r.status}`);
  } catch {
    assert("Unauthenticated request reachable", false);
  }

  // /api/auth/me reports unauthenticated before login.
  try {
    const r = await get(`${apiBase}/api/auth/me`);
    assert("GET /api/auth/me returns 200", r.status === 200);
    assert("Reports unauthenticated initially", (r.data as Record<string, unknown>)?.authenticated === false);
  } catch {
    assert("GET /api/auth/me reachable", false);
  }
}

async function testExports(apiBase: string) {
  console.log(bold("\n[5] Exports: CSV + XLSX"));

  try {
    const r = await get(`${apiBase}/api/export.csv?dataset=projects`);
    assert("GET /api/export.csv returns 200", r.status === 200, `got ${r.status}`);
    assert("CSV has a header row", typeof r.data === "string" && r.data.includes("identifier"));
  } catch {
    assert("export.csv reachable", false);
  }

  try {
    const r = await get(`${apiBase}/api/export.xlsx`);
    assert("GET /api/export.xlsx returns 200", r.status === 200, `got ${r.status}`);
    assert("XLSX is a zip (PK magic)", typeof r.data === "string" && r.data.startsWith("PK"));
  } catch {
    assert("export.xlsx reachable", false);
  }

  try {
    const r = await get(`${apiBase}/api/export.json?dataset=issues`);
    assert("GET /api/export.json returns 200", r.status === 200, `got ${r.status}`);
    assert("JSON export parses to an array", Array.isArray(r.data));
  } catch {
    assert("export.json reachable", false);
  }

  try {
    const r = await get(`${apiBase}/api/export.md?dataset=projects`);
    assert("GET /api/export.md returns 200", r.status === 200, `got ${r.status}`);
    assert("Markdown export has a table header", typeof r.data === "string" && r.data.includes("| --- |"));
  } catch {
    assert("export.md reachable", false);
  }

  try {
    const r = await get(`${apiBase}/api/export.pdf?dataset=issues`);
    assert("GET /api/export.pdf returns 200", r.status === 200, `got ${r.status}`);
    assert("PDF export starts with the %PDF magic", typeof r.data === "string" && r.data.startsWith("%PDF-"));
  } catch {
    assert("export.pdf reachable", false);
  }
}

async function testGovernance(apiBase: string) {
  console.log(bold("\n[6] Governance: history, baseline, RAID, notifications, RBAC, concurrency"));

  // Role surfaced on the session (demo session ⇒ admin).
  try {
    const r = await get(`${apiBase}/api/auth/me`);
    assert("auth/me returns a role after login", typeof (r.data as Record<string, unknown>)?.role === "string");
    assert("Demo session role is admin", (r.data as Record<string, unknown>)?.role === "admin");
  } catch {
    assert("auth/me role reachable", false);
  }

  // History (backend-sourced trend; demo derives it).
  try {
    const r = await get(`${apiBase}/api/projects/proj-001/history`);
    assert("GET /history returns 200", r.status === 200, `got ${r.status}`);
    assert("History is an array", Array.isArray(r.data));
    if (Array.isArray(r.data) && r.data.length > 0) {
      const p = r.data[0] as Record<string, unknown>;
      assert("History point has completionRate + provenance", typeof p.completionRate === "number" && typeof p.provenance === "string");
    }
  } catch {
    assert("GET /history reachable", false);
  }

  // Baseline (object or null).
  try {
    const r = await get(`${apiBase}/api/projects/proj-001/baseline`);
    assert("GET /baseline returns 200", r.status === 200, `got ${r.status}`);
    assert("Baseline is an object or null", r.data === null || typeof r.data === "object");
  } catch {
    assert("GET /baseline reachable", false);
  }

  // RAID log read + write.
  try {
    const r = await get(`${apiBase}/api/projects/proj-001/raid`);
    assert("GET /raid returns 200", r.status === 200, `got ${r.status}`);
    assert("RAID is an array", Array.isArray(r.data));
  } catch {
    assert("GET /raid reachable", false);
  }
  try {
    const r = await post(`${apiBase}/api/projects/proj-001/raid`, { type: "risk", title: "Verify risk", severity: "medium" });
    assert("POST /raid returns 201", r.status === 201, `got ${r.status}`);
    assert("Created RAID entry has an id", typeof (r.data as Record<string, unknown>)?.id === "string");
  } catch {
    assert("POST /raid reachable", false);
  }

  // Notifications.
  try {
    const r = await get(`${apiBase}/api/notifications`);
    assert("GET /notifications returns 200", r.status === 200, `got ${r.status}`);
    assert("Notifications is an array", Array.isArray(r.data));
  } catch {
    assert("GET /notifications reachable", false);
  }

  // Multi-currency FX rates.
  try {
    const r = await get(`${apiBase}/api/fx-rates`);
    assert("GET /fx-rates returns 200", r.status === 200, `got ${r.status}`);
    const fx = r.data as { base?: string; rates?: Record<string, number> };
    assert("FX rates has base + rate table", typeof fx.base === "string" && !!fx.rates && typeof fx.rates === "object");
    assert("FX rates covers multiple currencies", !!fx.rates && Object.keys(fx.rates).length >= 3);
  } catch {
    assert("GET /fx-rates reachable", false);
  }

  // Optimistic concurrency (demo mode enforces the version check).
  try {
    const list = await get(`${apiBase}/api/projects/proj-001/issues`);
    const issues = Array.isArray(list.data) ? (list.data as Array<Record<string, unknown>>) : [];
    const target = issues.find((i) => typeof i.version === "number");
    if (target) {
      const stale = await patch(`${apiBase}/api/projects/proj-001/issues/${target.id}`, { status: "in_progress", expectedVersion: 999 });
      assert("Stale expectedVersion is rejected with 409", stale.status === 409, `got ${stale.status}`);
      assert("409 returns the current server state", !!(stale.data as Record<string, unknown>)?.current);

      const fresh = await patch(`${apiBase}/api/projects/proj-001/issues/${target.id}`, { status: "in_progress", expectedVersion: target.version });
      assert("Correct expectedVersion succeeds (200)", fresh.status === 200, `got ${fresh.status}`);
      assert("Version is bumped after a successful update", (fresh.data as Record<string, unknown>)?.version === (target.version as number) + 1);
    } else {
      assert("Issue carries a version token", false, "no versioned issue found");
    }
  } catch (err) {
    assert("Concurrency check reachable", false, String(err));
  }
}

async function testSetup(apiBase: string) {
  console.log(bold("\n[7] Setup / Connection Center"));
  const mockUrl = `http://127.0.0.1:${MOCK_N8N_PORT}/webhook/omniproject`;

  // Status overview.
  try {
    const r = await get(`${apiBase}/api/setup/status`);
    assert("GET /setup/status returns 200", r.status === 200, `got ${r.status}`);
    const s = r.data as Record<string, unknown>;
    assert("Status has role + auth + capabilities", typeof s.role === "string" && !!s.auth && "capabilities" in s);
  } catch {
    assert("GET /setup/status reachable", false);
  }

  // Non-destructive n8n probe against the mock webhook.
  try {
    const r = await post(`${apiBase}/api/setup/test-n8n`, { webhookUrl: mockUrl });
    assert("POST /setup/test-n8n returns 200", r.status === 200, `got ${r.status}`);
    const d = r.data as Record<string, unknown>;
    assert("Probe reports the mock is reachable", d.reachable === true);
    assert("Probe detects get_capabilities support", d.implementsCapabilities === true);
  } catch {
    assert("POST /setup/test-n8n reachable", false);
  }

  // Bad URL is rejected.
  try {
    const r = await post(`${apiBase}/api/setup/test-n8n`, { webhookUrl: "not-a-url" });
    assert("Invalid webhook URL returns 400", r.status === 400, `got ${r.status}`);
  } catch {
    assert("Invalid URL test reachable", false);
  }

  // Config export.
  try {
    const r = await get(`${apiBase}/api/setup/export?format=env`);
    assert("GET /setup/export returns 200", r.status === 200, `got ${r.status}`);
    assert("Exported .env carries N8N_WEBHOOK_URL", typeof r.data === "string" && r.data.includes("N8N_WEBHOOK_URL"));
  } catch {
    assert("GET /setup/export reachable", false);
  }

  // Backend catalogue.
  try {
    const r = await get(`${apiBase}/api/setup/backends`);
    assert("GET /setup/backends returns 200", r.status === 200, `got ${r.status}`);
    assert("Backends is a non-empty array", Array.isArray(r.data) && r.data.length > 0);
    assert("Catalogue includes openproject", Array.isArray(r.data) && r.data.some((b) => (b as { id: string }).id === "openproject"));
  } catch {
    assert("GET /setup/backends reachable", false);
  }

  // Workflow generation.
  try {
    const r = await post(`${apiBase}/api/setup/generate-workflow`, { backendId: "openproject" });
    assert("POST /setup/generate-workflow returns 200", r.status === 200, `got ${r.status}`);
    const wf = r.data as { name?: string; nodes?: unknown[]; connections?: Record<string, unknown> };
    assert("Generated workflow has nodes + connections", Array.isArray(wf.nodes) && wf.nodes.length > 0 && !!wf.connections);
    assert("Generated workflow includes a Webhook node", Array.isArray(wf.nodes) && wf.nodes.some((n) => (n as { name?: string }).name === "Webhook"));
  } catch {
    assert("POST /setup/generate-workflow reachable", false);
  }

  // Unknown backend rejected.
  try {
    const r = await post(`${apiBase}/api/setup/generate-workflow`, { backendId: "nope" });
    assert("Unknown backend returns 404", r.status === 404, `got ${r.status}`);
  } catch {
    assert("Unknown backend test reachable", false);
  }

  // Config snapshot (backup) + restore.
  try {
    const r = await get(`${apiBase}/api/setup/snapshot`);
    assert("GET /setup/snapshot returns 200", r.status === 200, `got ${r.status}`);
    const snap = r.data as { schema?: string; settings?: unknown };
    assert("Snapshot has the OmniProject schema + settings", snap.schema === "omniproject/config-snapshot" && !!snap.settings);
  } catch {
    assert("GET /setup/snapshot reachable", false);
  }
  try {
    const r = await post(`${apiBase}/api/setup/restore`, { schema: "omniproject/config-snapshot", version: 1, settings: { backendSource: "all" } });
    assert("POST /setup/restore returns 200 for a valid snapshot", r.status === 200, `got ${r.status}`);
    assert("Restore reports restored=true", (r.data as { restored?: boolean })?.restored === true);
  } catch {
    assert("POST /setup/restore reachable", false);
  }
  try {
    const r = await post(`${apiBase}/api/setup/restore`, { schema: "foreign/thing", settings: {} });
    assert("Restore rejects a foreign schema with 400", r.status === 400, `got ${r.status}`);
  } catch {
    assert("Restore validation reachable", false);
  }

  // Config environments & versioned rollback.
  try {
    const r = await get(`${apiBase}/api/setup/environments`);
    assert("GET /setup/environments returns 200", r.status === 200, `got ${r.status}`);
    const sv = r.data as { activeEnv?: string; environments?: string[]; versions?: unknown[]; lastKnownGoodId?: string | null };
    assert("Environments view has active env + history", sv.activeEnv === "production" && Array.isArray(sv.environments) && Array.isArray(sv.versions));
  } catch {
    assert("GET /setup/environments reachable", false);
  }
  try {
    const r = await post(`${apiBase}/api/setup/rollback`, { toKnownGood: true });
    assert("POST /setup/rollback (known-good) returns 200", r.status === 200, `got ${r.status}`);
    assert("Rollback reports the applied version", typeof (r.data as { appliedVersion?: string })?.appliedVersion === "string");
  } catch {
    assert("POST /setup/rollback reachable", false);
  }

  // Workflow verifier (probes the configured mock with verify:true).
  try {
    const r = await post(`${apiBase}/api/setup/verify-workflow`, {});
    assert("POST /setup/verify-workflow returns 200", r.status === 200, `got ${r.status}`);
    const v = r.data as { summary?: { total?: number; passed?: number }; results?: unknown[] };
    assert("Verifier returns per-action results", Array.isArray(v.results) && v.results.length > 0);
    assert("Verifier summary counts the probes", !!v.summary && typeof v.summary.total === "number" && (v.summary.passed ?? -1) >= 1);
  } catch {
    assert("POST /setup/verify-workflow reachable", false);
  }
}

async function testNotify(apiBase: string) {
  console.log(bold("\n[8] Real-time notifications (ingest + SSE)"));
  const secret = process.env["NOTIFY_INGEST_SECRET"];

  // Is realtime enabled on the running server?
  let enabled = false;
  try {
    const r = await get(`${apiBase}/api/setup/status`);
    const rt = (r.data as { realtime?: { enabled?: boolean; bus?: string } })?.realtime;
    enabled = !!rt?.enabled;
    assert("setup/status reports realtime.enabled", typeof rt?.enabled === "boolean");
    assert("setup/status reports the fan-out bus mode", rt?.bus === "in-process" || rt?.bus === "redis");
    const audit = (r.data as { audit?: { level?: string; sink?: boolean } })?.audit;
    assert("setup/status reports audit config", typeof audit?.level === "string" && typeof audit?.sink === "boolean");
  } catch {
    assert("setup/status realtime reachable", false);
  }

  if (enabled && secret) {
    // Wrong secret rejected.
    try {
      const r = await post(`${apiBase}/api/notifications/ingest`, { notification: { title: "x" } }, { Authorization: "Bearer wrong-secret-of-len" });
      assert("Ingest with wrong secret returns 401", r.status === 401, `got ${r.status}`);
    } catch { assert("Ingest wrong-secret reachable", false); }

    // Correct secret + valid notification accepted.
    try {
      const r = await post(`${apiBase}/api/notifications/ingest`, { notification: { title: "Build green", kind: "ci" } }, { Authorization: `Bearer ${secret}` });
      assert("Ingest with correct secret returns 200", r.status === 200, `got ${r.status}`);
      assert("Ingest reports a delivered count", typeof (r.data as { delivered?: number })?.delivered === "number");
      assert("Ingest reports the bus mode", typeof (r.data as { bus?: string })?.bus === "string");
    } catch { assert("Ingest happy-path reachable", false); }

    // Missing title rejected.
    try {
      const r = await post(`${apiBase}/api/notifications/ingest`, { notification: {} }, { Authorization: `Bearer ${secret}` });
      assert("Ingest without title returns 400", r.status === 400, `got ${r.status}`);
    } catch { assert("Ingest validation reachable", false); }
  } else {
    // Disabled (no secret configured) — the route short-circuits with 503.
    try {
      const r = await post(`${apiBase}/api/notifications/ingest`, { notification: { title: "x" } });
      assert("Ingest disabled returns 503", r.status === 503, `got ${r.status}`);
    } catch { assert("Ingest disabled reachable", false); }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold("OmniProject — n8n Bidirectional Verification Script"));
  console.log(dim("═".repeat(55)));

  // Determine API base: use N8N_WEBHOOK_URL env to infer API host, or default
  const apiBase = process.env["OMNI_API_BASE"] ?? "http://localhost:5000";
  const mockN8nUrl = `http://127.0.0.1:${MOCK_N8N_PORT}/webhook/omniproject`;

  console.log(dim(`API base:       ${apiBase}`));
  console.log(dim(`Mock n8n URL:   ${mockN8nUrl}`));

  // Start mock n8n server
  const mockServer = await startMockN8n();
  console.log(dim(`Mock n8n started on port ${MOCK_N8N_PORT}`));

  // Point the API server at our mock n8n for this test run
  // (In production the server reads N8N_WEBHOOK_URL from env)
  process.env["N8N_WEBHOOK_URL"] = mockN8nUrl;

  try {
    await testAuth(apiBase);

    // Establish a demo session for the protected routes.
    await login(apiBase);
    console.log(dim(sessionCookie ? "Authenticated (demo session)" : "No session cookie issued"));

    // Point the gateway's n8n broker at our mock (PATCH /settings; the demo
    // session is admin so the role gate passes). The gateway still runs in demo
    // mode for typed routes, so we exercise both the real sample-data logic and
    // the proxy brokering against the mock.
    await patch(`${apiBase}/api/settings`, {
      n8nWebhookUrl: mockN8nUrl,
    }).catch(() => null);

    await testOutbound(apiBase);
    await testInbound(apiBase);
    await testValidation(apiBase);
    await testApiRoutes(apiBase);
    await testExports(apiBase);
    await testGovernance(apiBase);
    await testSetup(apiBase);
    await testNotify(apiBase);
  } finally {
    mockServer.close();
  }

  console.log(dim("\n" + "═".repeat(55)));
  const total = passed + failed;
  if (failed === 0) {
    console.log(
      bold(green(`\n✓ All ${total} assertions passed. n8n contract verified.\n`)),
    );
    process.exit(0);
  } else {
    console.log(
      bold(red(`\n✗ ${failed}/${total} assertions failed. Fix before deploying.\n`)),
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(red("Fatal error:"), err);
  process.exit(1);
});
