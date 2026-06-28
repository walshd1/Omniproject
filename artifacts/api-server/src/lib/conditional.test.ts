import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { hashETag, tokenETag, conditionalJson } from "./conditional";

/**
 * Conditional/delta reads — unchanged ⇒ 304 (no payload), changed ⇒ 200 + body,
 * and a broker change token lets the read be SKIPPED entirely on a match.
 */

function fakeReq(ifNoneMatch?: string): Request {
  return { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} } as unknown as Request;
}
function fakeRes() {
  const headers: Record<string, string> = {};
  const state: { status: number; body: unknown; ended: boolean } = { status: 200, body: undefined, ended: false };
  const res = {
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    status: (s: number) => { state.status = s; return res; },
    json: (b: unknown) => { state.body = b; },
    end: () => { state.ended = true; },
  } as unknown as Response;
  return { res, headers, state };
}

test("hashETag is stable for equal data and differs for changed data", () => {
  assert.equal(hashETag([{ id: "p1" }]), hashETag([{ id: "p1" }]));
  assert.notEqual(hashETag([{ id: "p1" }]), hashETag([{ id: "p2" }]));
});

test("payload-hash path: first read sends 200 + body + ETag", async () => {
  const { res, headers, state } = fakeRes();
  let reads = 0;
  await conditionalJson(fakeReq(), res, { read: async () => { reads++; return [{ id: "p1" }]; } });
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, [{ id: "p1" }]);
  assert.ok(headers["etag"]);
  assert.equal(reads, 1);
});

test("payload-hash path: matching If-None-Match ⇒ 304, no body (but read still ran)", async () => {
  const etag = hashETag([{ id: "p1" }]);
  const { res, state } = fakeRes();
  await conditionalJson(fakeReq(etag), res, { read: async () => [{ id: "p1" }] });
  assert.equal(state.status, 304);
  assert.equal(state.ended, true);
  assert.equal(state.body, undefined);
});

test("token path: matching token ⇒ 304 AND the read is SKIPPED entirely", async () => {
  const etag = tokenETag("v1");
  const { res, state } = fakeRes();
  let reads = 0;
  await conditionalJson(fakeReq(etag), res, { token: "v1", read: async () => { reads++; return [{ id: "p1" }]; } });
  assert.equal(state.status, 304);
  assert.equal(reads, 0, "the heavy read must be skipped on a token match");
});

test("token path: changed token ⇒ 200 + body (read runs, new ETag)", async () => {
  const stale = tokenETag("v1");
  const { res, headers, state } = fakeRes();
  await conditionalJson(fakeReq(stale), res, { token: "v2", read: async () => [{ id: "p1" }] });
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, [{ id: "p1" }]);
  assert.equal(headers["etag"], tokenETag("v2"));
});
