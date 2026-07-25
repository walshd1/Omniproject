import { Router } from "express";
import { getTasks, getTask } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { getSession } from "./auth";
import { scopeForReq } from "../lib/rbac";
import { assertTaskScope } from "../lib/project-scope";
import { withBrokerErrors } from "../broker";
import { tasksToIcsEvents, issuesToIcsEvents } from "../lib/calendar-feed";
import { buildIcs } from "../lib/ical";
import { getCalendarPush, setCalendarPush } from "../lib/calendar-push";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * Personal calendar feed — GET /api/calendar.ics renders the signed-in user's OPEN, due-dated work as
 * an iCalendar file to download and import (or host as a subscription) in Google/Outlook/Apple
 * Calendar. Session-authenticated (mounted under requireAuth): the read runs as the caller through the
 * broker seam with their own scope + backend credential, so it can never expose another user's data —
 * which is also why this is a user-action export, not an unauthenticated subscription URL. Read-only;
 * degrades to an empty (valid) calendar when the backend models no tasks.
 *
 * Includes task due dates (with a reminder VALARM when the task carries `reminderAt`) plus
 * issue/milestone deadlines. Three grains, all user-initiated (case-by-case) — no standing
 * permission needed, unlike the push feed below:
 *   - `?taskId=` / `?issueId=` — a single item ("add THIS to my calendar").
 *   - `?scope=mine` (default) — everything assigned to the caller.
 *   - `?scope=all` — every dated item in their scope (a PM's portfolio deadlines).
 */
const router = Router();

router.get("/calendar.ics", (req, res) =>
  withBrokerErrors(req, res, "calendar_feed failed", async () => {
    const session = getSession(req);
    const taskId = typeof req.query["taskId"] === "string" ? req.query["taskId"] : undefined;
    const issueId = typeof req.query["issueId"] === "string" ? req.query["issueId"] : undefined;
    const whoami = [session?.email, session?.name, session?.sub].filter((x): x is string => typeof x === "string" && !!x);

    let events;
    let name = "OMNI";
    if (taskId) {
      // Case-by-case: one task the user explicitly chose — but still scope-checked (getTask is
      // scope-blind), so it can't be used to pull an out-of-scope task's schedule. Out of scope ⇒ empty.
      const t = await getTask(req, taskId);
      const visible = !!t && await assertTaskScope(req, t, whoami);
      events = visible ? tasksToIcsEvents([t]) : [];
      name = visible ? `OmniProject — ${t.title}` : "OmniProject";
    } else if (issueId) {
      const one = (await allIssues(req)).find((r) => String(r["id"]) === issueId);
      events = one ? issuesToIcsEvents([one]) : [];
      name = one ? `OmniProject — ${String(one["title"] ?? "item")}` : "OmniProject";
    } else {
      // `scope=all` (the whole schedule) is only honoured for a portfolio-scoped principal; a scoped
      // caller falls back to their own items (mineFor). Otherwise getTasks — which is scope-blind —
      // would fold every tenant's tasks into the feed (the issue half already goes through allIssues,
      // which IS scope-bounded).
      const scopeAll = req.query["scope"] === "all" && scopeForReq(req).level === "all";
      const opts = scopeAll ? {} : { mineFor: whoami };
      const [tasks, issues] = await Promise.all([getTasks(req), allIssues(req)]);
      events = [...tasksToIcsEvents(tasks, opts), ...issuesToIcsEvents(issues, opts)];
      name = scopeAll ? "OmniProject — schedule" : "OmniProject — my work";
    }
    const ics = buildIcs({ name, events });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="omniproject.ics"');
    res.send(ics);
  }),
);

// ── Calendar PUSH (consent-gated) ─────────────────────────────────────────────
// The gateway never holds an OAuth credential. It records the user's EXPLICIT permission to push
// their schedule to a calendar and, only while that permission stands, exposes their events for the
// calendar connection/MCP they authorised to upsert. No grant ⇒ nothing is pushable.

const requireSub = (req: Parameters<typeof getSession>[0]): string | null => getSession(req)?.sub ?? null;

/** GET /api/calendar/push — the caller's current push consent (granted?/target/scope). */
router.get("/calendar/push", (req, res) => {
  const sub = requireSub(req);
  if (!sub) { res.status(401).json({ error: "not authenticated" }); return; }
  res.json(getCalendarPush(sub));
});

/**
 * PUT /api/calendar/push — grant or revoke consent (and pick target/scope). Body: {granted,target,scope}.
 *
 * LANE 2: a per-user consent write (no role floor — the caller's own grant). The session check is the parse
 * gate (401 when unauthenticated); run persists via setCalendarPush and returns the resulting grant. The
 * action base records a success audit (calendar-push.save) the hand-written route lacked — additive, no-op
 * under default config.
 */
export const calendarPushSaveCommand: CommandDescriptor<{ sub: string; body: unknown }> = {
  name: "calendar-push.save",
  method: "put",
  path: "/calendar/push",
  parse: (req, res) => {
    const sub = requireSub(req);
    if (!sub) { res.status(401).json({ error: "not authenticated" }); return null; }
    return { sub, body: req.body };
  },
  run: async (_req, _res, { sub, body }) => setCalendarPush(sub, body, new Date().toISOString()),
  audit: "calendar-push.save",
};
mountCommand(router, calendarPushSaveCommand);

/**
 * GET /api/calendar/push.json — the caller's dated work as structured events for the authorised
 * calendar connection/MCP to upsert. 403 unless the user has granted push — the enforcement point
 * for "nothing is pushed without explicit permission". Scope follows the grant (mine/all).
 */
router.get("/calendar/push.json", (req, res) =>
  withBrokerErrors(req, res, "calendar_push failed", async () => {
    const session = getSession(req);
    const sub = session?.sub;
    if (!sub) { res.status(401).json({ error: "not authenticated" }); return; }
    const grant = getCalendarPush(sub);
    if (!grant.granted) { res.status(403).json({ error: "calendar push not granted", grant }); return; }
    const whoami = [session?.email, session?.name, sub].filter((x): x is string => typeof x === "string" && !!x);
    const opts = grant.scope === "all" ? {} : { mineFor: whoami };
    const [tasks, issues] = await Promise.all([getTasks(req), allIssues(req)]);
    const events = [...tasksToIcsEvents(tasks, opts), ...issuesToIcsEvents(issues, opts)]
      .map((e) => ({ op: "upsert" as const, ...e }));
    res.json({ target: grant.target, scope: grant.scope, count: events.length, events });
  }),
);

export default router;
