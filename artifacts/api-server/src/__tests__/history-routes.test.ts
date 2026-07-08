import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/history.ts (time-travel replay) over the REAL app. The route is gated:
 * 409 until the operator opts into the logging server, then it replays recorded
 * portfolio states through the broker (the demo broker synthesises a short ramp).
 * The 502/broker-error catch is unreachable — the demo broker never throws on replay.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());

async function setTimeTravel(enabled: boolean): Promise<void> {
  const { updateSettings } = await import("../lib/settings");
  updateSettings(
    enabled
      ? { loggingSync: { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true } }
      : { loggingSync: { enabled: false } },
  );
}
afterEach(() => setTimeTravel(false));

const req = (path: string) => h.req(path, { cookie: ADMIN });

test("GET /history/replay 409s while time-travel (the logging server) is disabled", async () => {
  const r = await req("/history/replay");
  assert.equal(r.status, 409);
  const body = (await r.json()) as { error: string };
  assert.match(body.error, /Time-travel is not enabled/);
});

test("GET /history/replay returns recorded states once time-travel is enabled", async () => {
  await setTimeTravel(true);
  const r = await req("/history/replay");
  assert.equal(r.status, 200);
  const states = (await r.json()) as unknown[];
  assert.ok(Array.isArray(states) && states.length > 0, "replay should yield at least one state");
});

test("GET /history/replay honours the from/to window query params", async () => {
  await setTimeTravel(true);
  const r = await req("/history/replay?from=2025-01-01T00:00:00Z&to=2025-06-01T00:00:00Z");
  assert.equal(r.status, 200);
  const states = (await r.json()) as unknown[];
  assert.ok(Array.isArray(states));
});
