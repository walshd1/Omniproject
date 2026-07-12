import { Router } from "express";
import { getTasks } from "../lib/data";
import { getSession } from "./auth";
import { withBrokerErrors } from "../broker";
import { tasksToIcsEvents } from "../lib/calendar-feed";
import { buildIcs } from "../lib/ical";

/**
 * Personal calendar feed — GET /api/calendar.ics renders the signed-in user's OPEN, due-dated work as
 * an iCalendar file to download and import (or host as a subscription) in Google/Outlook/Apple
 * Calendar. Session-authenticated (mounted under requireAuth): the read runs as the caller through the
 * broker seam with their own scope + backend credential, so it can never expose another user's data —
 * which is also why this is a user-action export, not an unauthenticated subscription URL. Read-only;
 * degrades to an empty (valid) calendar when the backend models no tasks.
 *
 * `?scope=mine` (default) keeps only tasks assigned to the caller; `?scope=all` includes every dated
 * task in their scope (a PM's portfolio deadlines).
 */
const router = Router();

router.get("/calendar.ics", (req, res) =>
  withBrokerErrors(req, res, "calendar_feed failed", async () => {
    const session = getSession(req);
    const scopeAll = req.query["scope"] === "all";
    const whoami = [session?.email, session?.name, session?.sub].filter((x): x is string => typeof x === "string" && !!x);
    const tasks = await getTasks(req);
    const events = tasksToIcsEvents(tasks, scopeAll ? {} : { mineFor: whoami });
    const ics = buildIcs({ name: scopeAll ? "OmniProject — schedule" : "OmniProject — my tasks", events });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="omniproject.ics"');
    res.send(ics);
  }),
);

export default router;
