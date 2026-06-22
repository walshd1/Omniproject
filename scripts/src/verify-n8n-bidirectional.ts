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

        // Simulate n8n returning a normalized state payload
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(N8N_INBOUND_RESPONSE));
      });
    });

    server.listen(MOCK_N8N_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
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

function get(url: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: "GET",
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

    const capturedBody = captured.body as Record<string, unknown>;
    assert("n8n received action field", capturedBody?.action === "create_ticket");
    assert("n8n received payload.title", (capturedBody?.payload as Record<string, unknown>)?.title === "Test Issue from OmniProject");
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
    // Override the API's n8n URL by patching settings
    await post(`${apiBase}/api/settings`, {
      n8nWebhookUrl: mockN8nUrl,
    }).catch(() => null);

    await testOutbound(apiBase);
    await testInbound(apiBase);
    await testValidation(apiBase);
    await testApiRoutes(apiBase);
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
