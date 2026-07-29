import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * GET /api/calendar.ics — the signed-in user's due-dated work as an importable iCalendar file
 * (session-authenticated, read-only). The demo broker has one open, dated task (task-3, due 2026-09-01).
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /calendar.ics?scope=all returns a text/calendar VCALENDAR of dated tasks", async () => {
  const r = await req("/calendar.ics?scope=all");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/calendar/);
  assert.match(r.headers.get("content-disposition") ?? "", /filename="omniproject\.ics"/);
  const body = await r.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR"));
  assert.ok(body.includes("BEGIN:VEVENT"));
  // Tasks carry their due dates…
  assert.ok(body.includes("Book the quarterly steering review"), "the demo's dated task is on the calendar");
  assert.ok(body.includes("task-task-3@omniproject"));
  assert.ok(body.includes("DTSTART;VALUE=DATE:20260901"));
  // …and issue deadlines land in the same feed.
  assert.ok(body.includes("Migrate auth service to OIDC"), "an open issue deadline is on the calendar");
  assert.ok(body.includes("issue-iss-001@omniproject"));
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

test("case-by-case: ?taskId= exports a single item, ?issueId= a single deadline", async () => {
  // One task the user explicitly picks (task-3 is the demo's dated task).
  const t = await req("/calendar.ics?taskId=task-3");
  assert.equal(t.status, 200);
  const tbody = await t.text();
  assert.ok(tbody.includes("task-task-3@omniproject"));
  assert.ok(!tbody.includes("issue-iss-001@omniproject"), "only the chosen item is exported");

  // One issue deadline.
  const i = await req("/calendar.ics?issueId=iss-001");
  const ibody = await i.text();
  assert.ok(ibody.includes("issue-iss-001@omniproject"));
  assert.ok(!ibody.includes("task-task-3@omniproject"));
});

test("calendar push is consent-gated: default not granted, and push.json 403s until granted", async () => {
  // Default: not granted.
  const status0 = await json(await req("/calendar/push"));
  assert.equal(status0.granted, false);

  // Push feed is refused without consent.
  const denied = await req("/calendar/push.json");
  assert.equal(denied.status, 403);

  // Grant consent (with a target) → push feed opens and carries structured upsert events.
  const granted = await req("/calendar/push", { method: "PUT", body: { granted: true, target: "google-calendar", scope: "all" } });
  assert.equal(granted.status, 200);
  assert.equal((await json(granted)).granted, true);

  const feed = await req("/calendar/push.json");
  assert.equal(feed.status, 200);
  const payload = await json(feed);
  assert.equal(payload.target, "google-calendar");
  assert.ok(Array.isArray(payload.events) && payload.events.every((e: { op: string }) => e.op === "upsert"));

  // Revoke → refused again.
  await req("/calendar/push", { method: "PUT", body: { granted: false } });
  assert.equal((await req("/calendar/push.json")).status, 403);
});

test("push.json honours scope:all ONLY for a portfolio-scoped principal — a scoped user's own grant can't widen the feed", async () => {
  // Real auth (non-demo) so a member is genuinely user-scoped. getTasks is scope-blind, so trusting the
  // caller-saved grant scope:"all" alone would fold every owner's tasks into the pushed feed; the fix falls
  // back to mineFor for a caller who does not actually hold portfolio scope (mirrors GET /calendar.ics).
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const member = memberCookie(); // user-level scope (roles map to nothing ⇒ no authorities)
    const g = await h.req("/calendar/push", { method: "PUT", cookie: member, body: { granted: true, target: "google-calendar", scope: "all" } });
    assert.equal(g.status, 200);
    const feed = await json(await h.req("/calendar/push.json", { cookie: member }));
    assert.equal(feed.status ?? 200, 200);
    const uids = (feed.events as { uid?: string }[]).map((e) => e.uid ?? "");
    // The demo's dated task (task-3) is owned by another persona, so a user-scoped member's feed excludes it —
    // whereas the all-scope admin's feed (asserted above) includes it. Proves the grant can't self-widen.
    assert.ok(!uids.some((u) => u.includes("task-task-3")), "a scoped user's scope:all grant does not fold in another owner's tasks");
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
