import { test } from "node:test";
import assert from "node:assert/strict";
import { sendError } from "./http-error";

/** Capture what a route would send: the status code and the JSON body. */
function fakeRes(): { code: number; body: unknown; res: never } {
  const out = { code: 0, body: undefined as unknown, res: undefined as never };
  out.res = { status(c: number) { out.code = c; return { json(b: unknown) { out.body = b; } }; } } as never;
  return out;
}

test("sendError emits { error } with the given status", () => {
  const r = fakeRes();
  sendError(r.res, 404, "Not found");
  assert.equal(r.code, 404);
  assert.deepEqual(r.body, { error: "Not found" });
});

test("sendError merges optional extra fields without switching on shape", () => {
  const r = fakeRes();
  sendError(r.res, 409, "conflict", { code: "STALE", detail: 7 });
  assert.equal(r.code, 409);
  assert.deepEqual(r.body, { error: "conflict", code: "STALE", detail: 7 });
});
