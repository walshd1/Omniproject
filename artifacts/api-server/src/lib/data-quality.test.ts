import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { dataQualityMiddleware, DATA_QUALITY_HEADER } from "./data-quality";
import { sanitizePortfolioRow } from "../broker/sanitizer";

function fakeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    headersSent: false,
    setHeader(k: string, v: string) { headers[k] = v; return res; },
    json(body: unknown) { return body; },
    _headers: headers,
  };
  return res as unknown as Response & { _headers: Record<string, string> };
}

test("dataQualityMiddleware emits the repair-count header when the sanitizer repaired data", () => {
  const res = fakeRes();
  dataQualityMiddleware({} as Request, res, () => {
    // Simulate route handling that drives a sanitizer repair within the request scope (1 junk field).
    sanitizePortfolioRow({ projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: "junk", budgetVariancePercentage: 1, activeBlockersCount: 2 });
    res.json({ ok: true });
  });
  assert.equal(res._headers[DATA_QUALITY_HEADER], "1");
});

test("dataQualityMiddleware emits NO header when nothing was repaired", () => {
  const res = fakeRes();
  dataQualityMiddleware({} as Request, res, () => {
    sanitizePortfolioRow({ projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: 0, budgetVariancePercentage: 1, activeBlockersCount: 2 }); // all valid
    res.json({ ok: true });
  });
  assert.equal(res._headers[DATA_QUALITY_HEADER], undefined);
});

test("dataQualityMiddleware isolates the tally per request (no leak across scopes)", () => {
  const res1 = fakeRes();
  dataQualityMiddleware({} as Request, res1, () => {
    sanitizePortfolioRow({ projectId: "p", projectName: "P", ragStatus: "RED", scheduleVarianceDays: "x", budgetVariancePercentage: "y", activeBlockersCount: 2 }); // 2 repairs
    res1.json({ ok: true });
  });
  const res2 = fakeRes();
  dataQualityMiddleware({} as Request, res2, () => { res2.json({ ok: true }); }); // no repairs
  assert.equal(res1._headers[DATA_QUALITY_HEADER], "2");
  assert.equal(res2._headers[DATA_QUALITY_HEADER], undefined);
});
