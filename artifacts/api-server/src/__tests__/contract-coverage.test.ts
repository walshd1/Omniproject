import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Contract-coverage guard — every path in the OpenAPI spec must be deliberately
 * accounted for by a test. When someone adds a new path to openapi.yaml, this
 * fails until they register it here (and, ideally, write the test referenced).
 * This is the institutional guard that prevents the "new endpoint shipped
 * untested" gap from recurring.
 */

// artifacts/api-server/src/__tests__ → repo root
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

/** Minimal extractor for the top-level `paths:` keys (no YAML dep). */
function openapiPaths(): string[] {
  const lines = fs.readFileSync(path.join(ROOT, "lib/api-spec/openapi.yaml"), "utf8").split("\n");
  const out: string[] = [];
  let inPaths = false;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^[A-Za-z]/.test(line)) break; // next top-level section
    const m = inPaths ? line.match(/^ {2}(\/[^\s:]*):/) : null;
    if (m) out.push(m[1]!);
  }
  return out;
}

// Where each path is exercised. Keep this honest — add the path AND a real test.
const COVERED: Record<string, string> = {
  "/healthz": "security.test.ts, e2e-smoke",
  "/broker/command": "verify-n8n",
  "/projects": "security.test.ts, e2e-smoke, broker-conformance (createProject)",
  "/projects/{projectId}": "broker-conformance (updateProject / programme grouping)",
  "/programmes": "verify-n8n",
  "/programmes/{programmeId}": "verify-n8n",
  "/projects/{projectId}/issues": "security.test.ts, e2e-smoke, broker-conformance",
  "/projects/{projectId}/issues/{issueId}": "verify-n8n (concurrency), broker-conformance",
  "/projects/{projectId}/issues/{issueId}/items": "broker-conformance (task children: issue + note)",
  "/projects/{projectId}/members": "broker-conformance (projectMembers + access level)",
  "/resources": "resource-pool.test.ts (aggregation) + broker-conformance (members)",
  "/projects/{projectId}/summary": "e2e-smoke, broker-conformance",
  "/projects/{projectId}/capacity": "broker-conformance (resourceCapacity)",
  "/projects/{projectId}/financials": "broker-conformance (projectFinancials)",
  "/projects/{projectId}/history": "verify-n8n, broker-conformance",
  "/projects/{projectId}/baseline": "verify-n8n, broker-conformance",
  "/projects/{projectId}/raid": "verify-n8n, broker-conformance",
  "/notifications": "e2e-smoke, broker-conformance",
  "/portfolio/health": "e2e-smoke, broker-conformance",
  "/activity": "verify-n8n, broker-conformance",
  "/capabilities": "e2e-smoke, broker-conformance",
  "/fields/manifest": "capabilities.test.ts (resolveFieldManifest + custom-field surfacing), security.test.ts (manager gate)",
  "/admin/broker-log": "broker-log.test.ts (ring projection) + security.test.ts (admin gate)",
  "/settings": "security.test.ts, verify-n8n",
  "/fx-rates": "security.test.ts (HTTP), broker-conformance (fxRates)",
  "/history/replay": "security.test.ts (time-travel gate), broker-conformance (replay)",
};

test("every OpenAPI path is registered as covered by a test", () => {
  const paths = openapiPaths();
  assert.ok(paths.length >= 15, `sanity: expected to parse the spec's paths, got ${paths.length}`);
  const uncovered = paths.filter((p) => !(p in COVERED));
  assert.deepEqual(
    uncovered,
    [],
    `New OpenAPI path(s) with no registered test coverage: ${uncovered.join(", ")}. ` +
      `Add a test, then register the path in contract-coverage.test.ts COVERED.`,
  );
});

test("the coverage registry has no stale entries", () => {
  const paths = new Set(openapiPaths());
  const stale = Object.keys(COVERED).filter((p) => !paths.has(p));
  assert.deepEqual(stale, [], `COVERED lists paths no longer in the spec: ${stale.join(", ")}`);
});
