import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { runDefWriteHook } from "./def-write-hooks";

/**
 * The def-importer authoring choke point. Regression for the governance-bypass finding: a `config` def resolves
 * by its LOGICAL id via the scope-layered fold, so the generic importer (`POST`/`PUT /api/defs`) must NOT be a
 * back door into a GOVERNED config — the security-classified posture controls (held for a passkey sign-off by
 * their dedicated writer) or the `def-scope-policy` authoring gate. Those logical ids are refused here; an
 * ordinary config id still writes.
 */

function mockRes(): { res: Response; out: { status?: number; body?: unknown } } {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  } as unknown as Response;
  return { res, out };
}

test("REFUSES a governed config id smuggled through the def importer (403), for every reserved id", async () => {
  for (const id of ["history-retention", "logging-sync", "error-telemetry", "def-scope-policy"]) {
    const { res, out } = mockRes();
    const ok = await runDefWriteHook({} as Request, res, "config", { id, values: {} });
    assert.equal(ok, false, `"${id}" must be refused by the importer choke point`);
    assert.equal(out.status, 403, `"${id}" must yield a 403`);
  }
});

test("ALLOWS an ordinary (non-governed) config id — the importer stays open for normal configs", async () => {
  const { res, out } = mockRes();
  const ok = await runDefWriteHook({} as Request, res, "config", { id: "scheduling", values: { hoursPerDay: 7 } });
  assert.equal(ok, true);
  assert.equal(out.status, undefined, "no error response for a benign config");
});

test("a missing / non-string payload id is treated as non-governed (no crash, allowed)", async () => {
  for (const payload of [{}, { id: 123 }, null, { values: {} }]) {
    const { res } = mockRes();
    assert.equal(await runDefWriteHook({} as Request, res, "config", payload), true);
  }
});
