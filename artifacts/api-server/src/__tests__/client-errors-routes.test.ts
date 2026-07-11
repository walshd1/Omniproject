import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the admin-gated client-error telemetry sink. Auth is required to post; the
 * report is a no-op (`recorded:false`) unless an admin has turned `errorTelemetry` on, and a
 * report with no message is a 400. The gate is the setting — enforced here server-side regardless
 * of what the client believes.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ errorTelemetry: false });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("POST /client-errors: unauthenticated is rejected", async () => {
  const r = await h.req("/client-errors", { method: "POST", body: { message: "boom" } });
  assert.equal(r.status, 401);
});

test("POST /client-errors: a no-op (recorded:false) while telemetry is OFF (the default)", async () => {
  const r = await h.req("/client-errors", { method: "POST", cookie: memberCookie(), body: { message: "boom" } });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).recorded, false);
});

test("POST /client-errors: records (recorded:true) once an admin enables telemetry", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ errorTelemetry: true });
  const r = await h.req("/client-errors", {
    method: "POST",
    cookie: memberCookie(),
    body: { message: "TypeError: x is undefined", componentStack: "at <Foo>", page: "/reports" },
  });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).recorded, true);
});

test("POST /client-errors: a report with no usable message is a 400 (when enabled)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ errorTelemetry: true });
  const r = await h.req("/client-errors", { method: "POST", cookie: memberCookie(), body: { message: "   " } });
  assert.equal(r.status, 400);
});
