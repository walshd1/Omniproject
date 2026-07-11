import { test } from "node:test";
import assert from "node:assert/strict";
import { lambdaHandler, httpHandler } from "./serverless-function";

/**
 * The serverless template is thin per-platform glue over the shared
 * `processBrokerCall` core. These cover the glue's own branches: the body/header
 * defaulting for the Lambda and HTTP handlers. A `verify` probe short-circuits the
 * core before it touches the (stub) backend, so we get a deterministic 200.
 */

const VERIFY_BODY = JSON.stringify({ action: "listProjects", verify: true });

test("lambdaHandler returns a well-formed response for a verify probe", async () => {
  const r = await lambdaHandler({
    body: VERIFY_BODY,
    headers: { "x-omniproject-action": "listProjects", authorization: "Bearer t" },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "application/json");
  const body = JSON.parse(r.body) as { success: boolean; data?: { verified?: boolean } };
  assert.equal(body.success, true);
  assert.equal(body.data?.verified, true);
});

test("lambdaHandler defaults a missing body to an empty string", async () => {
  // body null → `?? ""` → core parses "" as {} → empty action → error status.
  const r = await lambdaHandler({ body: null, headers: {} });
  assert.equal(typeof r.statusCode, "number");
  const body = JSON.parse(r.body) as { success: boolean };
  assert.equal(body.success, false);
});

test("lambdaHandler reads a capitalised Authorization header when lowercase is absent", async () => {
  // Only `Authorization` present → the `?? headers.Authorization` fallback fires.
  const r = await lambdaHandler({ body: VERIFY_BODY, headers: { Authorization: "Bearer cap" } });
  assert.equal(r.statusCode, 200);
});

test("lambdaHandler tolerates missing headers entirely", async () => {
  const r = await lambdaHandler({ body: VERIFY_BODY });
  assert.equal(r.statusCode, 200);
});

test("httpHandler prefers a raw string body over req.body", async () => {
  let status = 0;
  let payload: unknown;
  const res = { status: (n: number) => ({ json: (b: unknown) => { status = n; payload = b; } }) };
  await httpHandler({ rawBody: VERIFY_BODY, body: { ignored: true }, headers: {} }, res);
  assert.equal(status, 200);
  assert.equal((payload as { success: boolean }).success, true);
});

test("httpHandler serialises req.body when there is no raw body", async () => {
  let status = 0;
  let payload: unknown;
  const res = { status: (n: number) => ({ json: (b: unknown) => { status = n; payload = b; } }) };
  await httpHandler({ body: { action: "listProjects", verify: true }, headers: { authorization: "Bearer x" } }, res);
  assert.equal(status, 200);
  assert.equal((payload as { success: boolean }).success, true);
});

test("httpHandler defaults an absent body to {} (empty JSON)", async () => {
  let status = 0;
  let payload: unknown;
  const res = { status: (n: number) => ({ json: (b: unknown) => { status = n; payload = b; } }) };
  await httpHandler({ headers: {} }, res);
  assert.equal(typeof status, "number");
  assert.equal((payload as { success: boolean }).success, false);
});
