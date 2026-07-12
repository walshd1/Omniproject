import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * GET /api/calendar.ics — the signed-in user's due-dated work as an importable iCalendar file
 * (session-authenticated, read-only). The demo broker has one open, dated task (task-3, due 2026-09-01).
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
const req = (path: string) => h.req(path, { cookie: ADMIN });

test("GET /calendar.ics?scope=all returns a text/calendar VCALENDAR of dated tasks", async () => {
  const r = await req("/calendar.ics?scope=all");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/calendar/);
  assert.match(r.headers.get("content-disposition") ?? "", /filename="omniproject\.ics"/);
  const body = await r.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR"));
  assert.ok(body.includes("BEGIN:VEVENT"));
  assert.ok(body.includes("Book the quarterly steering review"), "the demo's dated task is on the calendar");
  assert.ok(body.includes("DTSTART;VALUE=DATE:20260901"));
  assert.ok(body.trimEnd().endsWith("END:VCALENDAR"));
});

test("GET /calendar.ics (default scope=mine) is a valid calendar scoped to the caller", async () => {
  const r = await req("/calendar.ics");
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR"));
  assert.ok(body.includes("END:VCALENDAR"));
});

test("GET /calendar.ics requires authentication", async () => {
  const r = await h.req("/calendar.ics"); // no cookie
  assert.equal(r.status, 401);
});
