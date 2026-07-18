import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/history.ts (time-travel replay) over the REAL app. The route is gated:
 * 409 until the operator opts into the logging server, then it replays recorded
 * portfolio states through the broker (the demo broker synthesises a short ramp).
 * The 502/broker-error catch is unreachable — the demo broker never throws on replay.
 * Time-travel now reads the `logging-sync` config def (Phase C), so enable the sealed store.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "history-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

async function setTimeTravel(enabled: boolean): Promise<void> {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  writeOrgConfigCollection(
    "logging-sync", "Logging sync",
    enabled
      ? { enabled: true, url: "https://logs.example.com", acknowledgedWarranty: true }
      : { enabled: false, url: null, acknowledgedWarranty: false },
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

test("GET /history/replay rejects a non-ISO from/to (400) before hitting the log store", async () => {
  await setTimeTravel(true);
  const bad = await req("/history/replay?from=not-a-date");
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /ISO-8601/);
});

test("GET /history/replay rejects an inverted window (from >= to) → 400", async () => {
  await setTimeTravel(true);
  const r = await req("/history/replay?from=2025-06-01T00:00:00Z&to=2025-01-01T00:00:00Z");
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /before/);
});

// Note: the harness runs in demo mode, where every session holds all RBAC grants, so the
// admin-only / pmo-scope negative paths (403s) can't be exercised here — they're enforced by
// requireAnyRole + the in-handler isAdmin check, covered by rbac's own tests. We exercise the
// positive paths + validation here.

test("GET /history/trends rejects an unknown metric (400)", async () => {
  const r = await h.req("/history/trends/nonsense", { cookie: ADMIN });
  assert.equal(r.status, 400);
});

test("GET /history/trends is honest when the history domain isn't enabled — available:false with a reason", async () => {
  const r = await h.req("/history/trends/completionPct?grain=month", { cookie: ADMIN });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { available: boolean; reason?: string; metric: string; points: unknown[] };
  assert.equal(body.available, false);
  assert.match(body.reason ?? "", /not enabled|no retention source/);
  assert.equal(body.metric, "completionPct");
});

test("GET /history/retention returns the cadence config + resolved cadence + infinite retention", async () => {
  const r = await h.req("/history/retention", { cookie: ADMIN });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { config: { orgDefault: unknown }; resolved: unknown; retention: string };
  assert.ok(body.config.orgDefault);
  assert.equal(body.retention, "infinite");
});

test("PUT /history/retention: sets the org-default cadence and a programme override", async () => {
  const r = await h.req("/history/retention", { method: "PUT", cookie: ADMIN, body: { orgDefault: { kind: "onWrite" }, programme: { P1: { kind: "interval", everyHours: 6 } } } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { config: { orgDefault: { kind: string }; programme: Record<string, { kind: string }> } };
  assert.equal(body.config.orgDefault.kind, "onWrite");
  assert.equal(body.config.programme["P1"]!.kind, "interval");
  // the resolved cadence for that programme reflects the override
  const resolved = await h.req("/history/retention?programmeId=P1", { cookie: ADMIN });
  assert.deepEqual((await resolved.json() as { resolved: unknown }).resolved, { kind: "interval", everyHours: 6 });
  // restore
  await h.req("/history/retention", { method: "PUT", cookie: ADMIN, body: { orgDefault: { kind: "interval", everyHours: 24 }, programme: {} } });
});

test("PUT /history/retention rejects an invalid cadence (400)", async () => {
  const r = await h.req("/history/retention", { method: "PUT", cookie: ADMIN, body: { orgDefault: { kind: "interval", everyHours: -5 } } });
  assert.equal(r.status, 400);
});

test("PUT /history/retention SHORTENING the disposal window is held for a signed sign-off (202); LENGTHENING applies immediately", async () => {
  const { writeOrgConfigCollection } = await import("../lib/scoped-config");
  // Seed a finite window directly (bypass the gate) so a change either way is measurable.
  writeOrgConfigCollection("history-retention", "History retention", { orgDefault: { kind: "manual" }, programme: {}, project: {}, retentionDays: 365, legalHolds: [] });
  try {
    // Shortening 365 → 30 loses audit trail ⇒ held.
    const shorten = await h.req("/history/retention", { method: "PUT", cookie: ADMIN, body: { retentionDays: 30 } });
    assert.equal(shorten.status, 202);
    assert.ok(((await shorten.json()) as { pending?: { proposalId?: string } }).pending?.proposalId);
    // Still 365 — the shortening is pending, not applied.
    assert.equal(((await (await h.req("/history/retention", { cookie: ADMIN })).json()) as { retentionDays: number }).retentionDays, 365);

    // Lengthening 365 → 730 strengthens ⇒ applies immediately.
    const lengthen = await h.req("/history/retention", { method: "PUT", cookie: ADMIN, body: { retentionDays: 730 } });
    assert.equal(lengthen.status, 200);
    assert.equal(((await lengthen.json()) as { config: { retentionDays: number } }).config.retentionDays, 730);
  } finally {
    writeOrgConfigCollection("history-retention", "History retention", { orgDefault: { kind: "interval", everyHours: 24 }, programme: {}, project: {} });
  }
});
