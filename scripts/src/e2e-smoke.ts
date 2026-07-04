/**
 * End-to-end smoke test for the single-container "omni-shell".
 *
 * Run against a gateway started with STATIC_DIR pointing at the built SPA:
 *   STATIC_DIR=artifacts/omniproject/dist/public PORT=5000 node artifacts/api-server/dist/index.mjs &
 *   OMNI_API_BASE=http://localhost:5000 pnpm --filter @workspace/scripts run e2e-smoke
 *
 * It verifies the server serves the SPA shell AND that the critical user journey
 * (login → projects → issues → summary → capabilities → reports data) responds.
 * Not a browser test — a fast HTTP-level smoke that catches a broken container.
 */

import { login } from "./lib/demo-session";
import { createAsserter, green, red, bold } from "./lib/assert";

export {};

const base = process.env["OMNI_API_BASE"] ?? "http://localhost:5000";
const t = createAsserter();
const assert = t.assert;

let cookie = "";
function authed(): RequestInit {
  return { headers: cookie ? { Cookie: cookie } : {} };
}

async function main() {
  console.log(bold(`OmniProject — E2E smoke (${base})`));

  // 1. The SPA shell is served (single-container mode).
  try {
    const r = await fetch(`${base}/`);
    const html = await r.text();
    assert("GET / serves HTML 200", r.status === 200 && html.includes("<html"), `status ${r.status}`);
    assert("HTML loads the SPA bundle", /<script[^>]+src=/.test(html) && html.includes("root"));
  } catch (err) {
    assert("SPA root reachable", false, String(err));
  }

  // 2. Health.
  try {
    const r = await fetch(`${base}/api/healthz`);
    assert("GET /api/healthz → 200", r.status === 200);
  } catch { assert("health reachable", false); }

  // 3. Auth journey.
  cookie = await login(base);
  assert("Demo login issued a session cookie", !!cookie);

  // 4. Critical data journey.
  let projectId = "";
  try {
    const r = await fetch(`${base}/api/projects`, authed());
    const data = (await r.json()) as Array<{ id: string }>;
    assert("GET /api/projects → 200 + array", r.status === 200 && Array.isArray(data) && data.length > 0);
    projectId = data[0]?.id ?? "";
  } catch { assert("projects reachable", false); }

  const journey: Array<[string, string]> = [
    ["issues", `/api/projects/${projectId}/issues`],
    ["summary", `/api/projects/${projectId}/summary`],
    ["capabilities", `/api/capabilities`],
    ["fx-rates", `/api/fx-rates`],
    ["notifications", `/api/notifications`],
    ["portfolio health", `/api/portfolio/health`],
  ];
  for (const [label, path] of journey) {
    try {
      const r = await fetch(`${base}${path}`, authed());
      assert(`GET ${label} → 200`, r.status === 200, `got ${r.status}`);
    } catch { assert(`${label} reachable`, false); }
  }

  const total = t.pass + t.fail;
  console.log(t.fail === 0 ? bold(green(`\n✓ E2E smoke passed (${total} checks).\n`)) : bold(red(`\n✗ ${t.fail}/${total} E2E checks failed.\n`)));
  process.exit(t.fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(red("Fatal:"), err); process.exit(1); });
