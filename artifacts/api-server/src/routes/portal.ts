import { Router, type IRouter, type Response } from "express";
import { requireRole, scopeForReq } from "../lib/rbac";
import { guardProjectScope } from "../lib/project-scope";
import { getProjects, getIssues } from "../lib/data";
import { guestPortalEnabled, mintGuestToken, isValidEmail } from "../lib/magic-link";
import { sendEmail } from "../lib/email";
import { isDevMode } from "../lib/dev-mode";
import { isDone } from "../broker/vocabulary";
import { baseUrl } from "./auth";
import type { GuestTier } from "../lib/oidc";

/**
 * Client-facing GUEST PORTAL (roadmap 2.2). Two surfaces:
 *   - POST /api/portal/invites  — a manager+ invites an external client as a guest scoped to ONE project
 *     (magic-link invite; the scope claims ride inside the sealed token). Only for a project the inviter
 *     can themselves see (guardProjectScope).
 *   - GET  /api/portal/status   — the guest's OWN project's curated, read-only status. A guest (role floor,
 *     project scope) can reach nothing else: every other protected route is viewer+ and rejects them.
 *
 * The curated status exposes ONLY client-safe fields (name, progress, health rollup, dated milestones) —
 * never budget/cost/benefit/internal columns. Zero-at-rest: the data comes live from the broker seam.
 */

const router: IRouter = Router();

/** 404 the whole portal when the guest-portal switch is off (independent of SSO — see magic-link). */
function requirePortal(res: Response): boolean {
  if (!guestPortalEnabled()) { res.status(404).json({ error: "the guest portal is not enabled" }); return false; }
  return true;
}

// POST /api/portal/invites — invite an external client as a scoped guest (manager+, project-scoped).
router.post("/portal/invites", requireRole("manager"), async (req, res) => {
  if (!requirePortal(res)) return;
  const body = (req.body ?? {}) as { email?: unknown; projectId?: unknown; tier?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const tier: GuestTier = body.tier === "comment" ? "comment" : "read";
  if (!isValidEmail(email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
  if (!projectId) { res.status(400).json({ error: "A projectId is required." }); return; }
  // The inviter must have scope over the project — you can't hand a guest into a project you can't see.
  if (!(await guardProjectScope(req, res, projectId))) return;

  const token = mintGuestToken(email, { projectId, tier }, Date.now());
  const link = `${baseUrl(req)}/api/auth/magic/verify?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent("/portal")}`;
  try {
    await sendEmail({
      to: email,
      subject: "You've been invited to a project status portal",
      text: `You've been given ${tier} access to a project's status portal.\n\nOpen it (this link expires): ${link}\n\nIf you weren't expecting this, you can ignore this email.`,
    });
  } catch (err) { req.log.warn({ err }, "guest invite send failed"); }
  // Never disclose the token-bearing link in prod responses; in dev, hand it back so it's testable.
  res.status(201).json({ ok: true, ...(isDevMode() ? { link } : {}) });
});

// GET /api/portal/status — the guest's ONE project's curated, read-only status (guest+).
router.get("/portal/status", requireRole("guest"), async (req, res) => {
  if (!requirePortal(res)) return;
  const scope = scopeForReq(req);
  const projectId = scope.level === "project" ? scope.projectId : undefined;
  // Only a guest has a single portal project; staff (viewer+) reaching here have no one project to show.
  if (!projectId) { res.status(400).json({ error: "no portal project in scope" }); return; }
  if (!(await guardProjectScope(req, res, projectId))) return;

  const projects = await getProjects(req, { includeClosed: true });
  const project = projects.find((p) => String(p["id"]) === projectId);
  if (!project) { res.status(404).json({ error: "project not found" }); return; }
  const issues = await getIssues(req, projectId).catch(() => [] as Record<string, unknown>[]);
  res.json(curateStatus(project, issues));
});

/** A finite number from an unknown field, or undefined. */
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the client-safe status payload — an explicit ALLOW-LIST of fields; internal/financial columns
 *  (budget, actualCost, benefit, cost centre, …) are never copied across. */
function curateStatus(project: Record<string, unknown>, issues: readonly Record<string, unknown>[]) {
  const total = num(project["issueCount"]) ?? issues.length;
  // Use the canonical completion test (broker/vocabulary) so a backend whose "done" is spelt closed/completed/
  // resolved is still counted — not just the literal string "done".
  const done = num(project["completedCount"]) ?? issues.filter((i) => isDone(typeof i["status"] === "string" ? i["status"] : null)).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  // Health rollup: count issue RAG statuses (never the internal per-issue detail).
  const health = { red: 0, amber: 0, green: 0 };
  for (const i of issues) {
    const h = String(i["healthStatus"] ?? "");
    if (h === "red") health.red++;
    else if (h === "amber") health.amber++;
    else if (h === "green") health.green++;
  }

  // Milestones: dated work items, title + status + dueDate only — no cost/benefit/assignee fields.
  const milestones = issues
    .filter((i) => typeof i["dueDate"] === "string" && i["dueDate"])
    .slice(0, 20)
    .map((i) => ({ title: String(i["title"] ?? ""), status: String(i["status"] ?? ""), dueDate: String(i["dueDate"]) }));

  return {
    project: {
      id: String(project["id"]),
      name: String(project["name"] ?? ""),
      description: project["description"] ? String(project["description"]) : null,
    },
    progress: { total, done, percent },
    health,
    milestones,
  };
}

export default router;
