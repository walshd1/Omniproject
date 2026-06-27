import { test } from "node:test";
import assert from "node:assert/strict";
import { structuralConformance, runReadConformance } from "./conformance";
import { updateSettings } from "../lib/settings";
import type { ActorContext } from "./types";

/**
 * REAL-BACKEND SMOKE TEST — opt-in, skipped unless you point it at a live broker.
 *
 * This is the single highest-information pre-pilot check: it proves the seam
 * against a REAL backend (live n8n → Jira/OpenProject/…), not the in-memory
 * reference sidecar. Every failure mode that only shows up against a real API —
 * auth, field shapes, error codes, latency — surfaces here.
 *
 *   SMOKE_BROKER_URL   (required to run)  the live broker webhook URL
 *   SMOKE_AUTH         (optional)         Authorization header value, e.g. "Bearer <token>"
 *   SMOKE_WRITE=1      (optional)         also exercise create→update→delete (MUTATES the backend)
 *
 * Run:  SMOKE_BROKER_URL=https://n8n.internal/webhook/omniproject \
 *       SMOKE_AUTH="Bearer $TOKEN" pnpm --filter @workspace/api-server smoke
 *
 * In CI with no SMOKE_BROKER_URL it is a no-op skip — never flakes the build.
 */

const URL = process.env["SMOKE_BROKER_URL"]?.trim();
const skip = URL ? false : "set SMOKE_BROKER_URL to run the real-backend smoke";

function ctx(): ActorContext {
  const auth = process.env["SMOKE_AUTH"]?.trim();
  return { sub: "smoke", email: "smoke@omniproject.test", role: "admin", ...(auth ? { authHeader: auth, token: auth.replace(/^Bearer\s+/i, "") } : {}) };
}

test("real broker passes structural + read conformance over the wire", { skip }, async () => {
  process.env["BROKER_URL"] = URL;
  updateSettings({ brokerUrl: URL });
  const { N8nBroker } = await import("./n8n");
  const broker = new N8nBroker();

  const structural = structuralConformance(broker);
  assert.ok(structural.ok, `structural failures: ${JSON.stringify(structural.checks.filter((c) => !c.ok))}`);

  const read = await runReadConformance(broker, ctx());
  assert.ok(read.ok, `read failures: ${JSON.stringify(read.checks.filter((c) => !c.ok))}`);
  assert.equal(read.broker, "n8n");
});

test("real broker create → update → delete round-trip", { skip: skip || (process.env["SMOKE_WRITE"] === "1" ? false : "set SMOKE_WRITE=1 to exercise writes (mutates the backend)") }, async () => {
  process.env["BROKER_URL"] = URL;
  updateSettings({ brokerUrl: URL });
  const { N8nBroker } = await import("./n8n");
  const broker = new N8nBroker();
  const c = ctx();

  const projects = await broker.listProjects(c);
  assert.ok(projects.length > 0, "need at least one project to smoke-test writes");
  const pid = projects[0]!.id;

  const created = await broker.writeIssue(c, "create", { projectId: pid, title: `omniproject smoke ${Date.now()}` });
  assert.ok(created && created.id, "create returned an issue");
  const updated = await broker.writeIssue(c, "update", { projectId: pid, issueId: created!.id, status: "in_progress", expectedVersion: created!.version });
  assert.ok(updated, "update returned an issue");
  const deleted = await broker.writeIssue(c, "delete", { projectId: pid, issueId: created!.id });
  assert.equal(deleted, null, "delete resolved");
});
