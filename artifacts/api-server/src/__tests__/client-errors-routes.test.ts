import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the admin-gated client-error telemetry sink. Auth is required to post; the
 * report is a no-op (`recorded:false`) unless an admin has turned error telemetry on, and a
 * report with no message is a 400. The gate reads the `error-telemetry` config def (Phase C 7b),
 * enforced server-side regardless of what the client believes — so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "client-errors-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

async function setTelemetry(enabled: boolean): Promise<void> {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection("error-telemetry", "Error telemetry", enabled);
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

afterEach(async () => { await setTelemetry(false); });

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
  await setTelemetry(true);
  const r = await h.req("/client-errors", {
    method: "POST",
    cookie: memberCookie(),
    body: { message: "TypeError: x is undefined", componentStack: "at <Foo>", page: "/reports" },
  });
  assert.equal(r.status, 200);
  assert.equal((await json(r)).recorded, true);
});

test("POST /client-errors: a report with no usable message is a 400 (when enabled)", async () => {
  await setTelemetry(true);
  const r = await h.req("/client-errors", { method: "POST", cookie: memberCookie(), body: { message: "   " } });
  assert.equal(r.status, 400);
});
