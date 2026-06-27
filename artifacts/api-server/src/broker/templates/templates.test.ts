import { test } from "node:test";
import assert from "node:assert/strict";
import { lambdaHandler, httpHandler } from "./serverless-function";

// These prove the per-broker templates REUSE the shared core (processBrokerCall)
// — same behaviour as the blueprint, with only the platform glue added: verify
// succeeds, a real action is 501 (stub backend), unknown action is 400.

test("serverless lambdaHandler reuses the core: verify → 200, real action → 501", async () => {
  const verify = await lambdaHandler({ body: JSON.stringify({ action: "list_projects", payload: {}, verify: true }) });
  assert.equal(verify.statusCode, 200);
  assert.equal(JSON.parse(verify.body).data.verified, true);

  const real = await lambdaHandler({ body: JSON.stringify({ action: "list_projects", payload: {} }), headers: { authorization: "Bearer t" } });
  assert.equal(real.statusCode, 501); // stub backend → NotImplemented, via the SAME core
});

test("serverless lambdaHandler maps unknown action → 400 (taxonomy from the core)", async () => {
  const r = await lambdaHandler({ body: JSON.stringify({ action: "made_up", payload: {} }) });
  assert.equal(r.statusCode, 400);
});

test("serverless httpHandler (GCF/Azure shape) drives the same core", async () => {
  let status = 0;
  let body: unknown;
  const res = { status: (n: number) => ({ json: (b: unknown) => { status = n; body = b; } }) };
  await httpHandler({ rawBody: JSON.stringify({ action: "create_issue", payload: { projectId: "p1", title: "x" } }), headers: {} }, res);
  assert.equal(status, 501); // stub backend
  assert.equal((body as { success: boolean }).success, false);
});
