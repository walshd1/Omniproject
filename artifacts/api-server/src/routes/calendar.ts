import { Router } from "express";
import { getTasks } from "../lib/data";
import { allIssues } from "../lib/portfolio-reads";
import { getSession } from "./auth";
import { withBrokerErrors } from "../broker";
import { tasksToIcsEvents, issuesToIcsEvents } from "../lib/calendar-feed";
import { buildIcs } from "../lib/ical";

/**
 * Personal calendar feed — GET /api/calendar.ics renders the signed-in user's OPEN, due-dated work as
 * an iCalendar file to download and import (or host as a subscription) in Google/Outlook/Apple
 * Calendar. Session-authenticated (mounted under requireAuth): the read runs as the caller through the
 * broker seam with their own scope + backend credential, so it can never expose another user's data —
 * which is also why this is a user-action export, not an unauthenticated subscription URL. Read-only;
 * degrades to an empty (valid) calendar when the backend models no tasks.
 *
 * Includes task due dates (with a reminder VALARM when the task carries `reminderAt`) plus
 * issue/milestone deadlines. `?scope=mine` (default) keeps only work assigned to the caller;
 * `?scope=all` includes every dated item in their scope (a PM's portfolio deadlines).
 */
const router = Router();

router.get("/calendar.ics", (req, res) =>
  withBrokerErrors(req, res, "calendar_feed failed", async () => {
    const session = getSession(req);
    const scopeAll = req.query["scope"] === "all";
    const whoami = [session?.email, session?.name, session?.sub].filter((x): x is string => typeof x === "string" && !!x);
    const opts = scopeAll ? {} : { mineFor: whoami };
    const [tasks, issues] = await Promise.all([getTasks(req), allIssues(req)]);
    const events = [...tasksToIcsEvents(tasks, opts), ...issuesToIcsEvents(issues, opts)];
    const ics = buildIcs({ name: scopeAll ? "OmniProject — schedule" : "OmniProject — my work", events });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="omniproject.ics"');
    res.send(ics);
  }),
);

export default router;
