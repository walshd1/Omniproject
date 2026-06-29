/**
 * Live OpenProject integration check — "certify" the mapping against a real
 * instance. Env-gated so CI stays green without a backend:
 *
 *   OPENPROJECT_LIVE_URL=https://op.example.com \
 *   OPENPROJECT_TOKEN=<api key or oauth bearer> \
 *   pnpm --filter @workspace/scripts run integration:openproject
 *
 * Without the env it prints SKIPPED and exits 0. With it, it exercises the same
 * v3 endpoints the generated OpenProject workflow uses and asserts the contract.
 */

export {};

const url = process.env["OPENPROJECT_LIVE_URL"]?.replace(/\/+$/, "");
const token = process.env["OPENPROJECT_TOKEN"];

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

let pass = 0;
let fail = 0;
function assert(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ${green("✓")} ${label}`); pass++; }
  else { console.log(`  ${red("✗")} ${label}${detail ? ` — ${detail}` : ""}`); fail++; }
}

async function main() {
  if (!url || !token) {
    console.log("SKIPPED: set OPENPROJECT_LIVE_URL and OPENPROJECT_TOKEN to certify against a live instance.");
    process.exit(0);
  }
  console.log(`OpenProject live certification → ${url}`);
  // OpenProject accepts an API key as Basic apikey:<key>, or an OAuth bearer.
  const auth = token.startsWith("oauth:")
    ? `Bearer ${token.slice(6)}`
    : `Basic ${Buffer.from(`apikey:${token}`).toString("base64")}`;
  const headers = { Authorization: auth, Accept: "application/json" };

  let firstProjectId: string | null = null;
  try {
    const r = await fetch(`${url}/api/v3/projects`, { headers });
    assert("GET /api/v3/projects → 200", r.status === 200, `got ${r.status}`);
    const body = (await r.json()) as { _embedded?: { elements?: Array<{ id: number }> } };
    const elements = body?._embedded?.elements;
    assert("Projects collection is HAL-shaped (_embedded.elements)", Array.isArray(elements));
    if (elements && elements.length) firstProjectId = String(elements[0]!.id); // length checked
  } catch (err) {
    assert("OpenProject reachable", false, String(err));
  }

  if (firstProjectId) {
    try {
      const r = await fetch(`${url}/api/v3/projects/${firstProjectId}/work_packages`, { headers });
      assert("GET /projects/:id/work_packages → 200", r.status === 200, `got ${r.status}`);
      const body = (await r.json()) as { _embedded?: { elements?: Array<{ lockVersion?: number }> } };
      const wps = body?._embedded?.elements;
      assert("Work packages are HAL-shaped", Array.isArray(wps));
      if (wps && wps.length) {
        assert("Work packages expose lockVersion (optimistic concurrency)", typeof wps[0]!.lockVersion === "number"); // length checked
      }
    } catch (err) {
      assert("Work packages reachable", false, String(err));
    }
  }

  console.log(`\n${fail === 0 ? green(`✓ ${pass} checks passed — OpenProject mapping certified.`) : red(`✗ ${fail} failed.`)}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
