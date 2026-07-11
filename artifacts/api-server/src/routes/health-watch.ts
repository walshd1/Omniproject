import { Router, type Response } from "express";
import { requireRole, ROLES, type Role } from "../lib/rbac";
import { getBroker } from "../broker";
import { deliverLocal } from "../lib/notify-hub";
import { runHealthWatch, recentFindings, type HealthFinding } from "../lib/health-watch";
import { runExecDigest } from "../lib/exec-digest";
import { runProactiveDigest } from "../lib/proactive-digest";
import { runScheduledExport } from "../lib/scheduled-export";
import { runDriftCanary, recentDriftFindings } from "../lib/drift-canary";

/**
 * Health / anomaly watch + executive & proactive digests + the drift canary — the scheduled,
 * read-only autonomous jobs. An admin can trigger any of them; a manager+ can read recent health
 * findings. Each runs as a keyed, short-lived autonomous actor and dispatches over the
 * notification seam (never writes here).
 */
const router = Router();

/** Run an autonomous job and send its result as JSON; on failure send a 502 with `label` in the
 *  fallback message. Collapses the identical try/catch every job trigger repeated. */
async function runJob(res: Response, label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await fn());
  } catch (err) {
    // These jobs reach the broker/SMTP; a raw error message can carry upstream/infra detail. Log it
    // server-side and return a generic message (matching respondBrokerError's posture).
    (res.req as { log?: { error: (o: unknown, m: string) => void } }).log?.error({ err, label }, `${label} run failed`);
    res.status(502).json({ error: `${label} run failed` });
  }
}

/** Turn a finding into a delivered notification (broadcast to connected clients). */
function notify(f: HealthFinding): void {
  deliverLocal({
    title: `${f.severity === "critical" ? "🔴" : "🟠"} ${f.projectName}: ${f.message}`,
    severity: f.severity,
    source: "health-watch",
    projectId: f.projectId,
    at: f.at,
  });
}

router.post("/health-watch/run", requireRole("admin"), (_req, res) =>
  runJob(res, "health-watch", async () => {
    const findings = await runHealthWatch({ now: Date.now(), broker: getBroker(), notify });
    return { findings, count: findings.length };
  }),
);

router.get("/health-watch", requireRole("manager"), (_req, res) => {
  res.json({ findings: recentFindings() });
});

// Trigger the executive digest now (admin). An external scheduler / the broker cron calls this
// so the digest fires once for the fleet; the optional in-process timer is for single instances.
router.post("/admin/digest/run", requireRole("admin"), (_req, res) =>
  runJob(res, "digest", async () => ({ digest: await runExecDigest({ now: Date.now(), broker: getBroker() }) })),
);

// Trigger the proactive "what needs me" digest now (admin). Like the exec digest, an external
// scheduler / the broker cron calls this so it fires once for the fleet; the in-process timer is
// for single instances. An empty (healthy-portfolio) digest is skipped, not dispatched.
router.post("/admin/proactive-digest/run", requireRole("admin"), async (req, res) => {
  const requested = req.body?.role;
  if (requested !== undefined && !(ROLES as readonly string[]).includes(requested)) {
    res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
    return;
  }
  const role = requested as Role | undefined;
  await runJob(res, "proactive-digest", () => runProactiveDigest({ now: Date.now(), broker: getBroker(), role }));
});

// Trigger a scheduled data export now (admin). Renders the configured dataset/format and emails it as
// an attachment to the digest recipients. Like the digests, an external scheduler calls this so it
// fires once for the fleet. A no-op delivery unless SMTP + recipients are configured.
router.post("/admin/scheduled-export/run", requireRole("admin"), (_req, res) =>
  runJob(res, "scheduled-export", () => runScheduledExport({ now: Date.now(), broker: getBroker() })),
);

// Trigger the third-party API drift canary now (admin). Like the digests, an external scheduler
// / the broker cron calls this so it fires once for the fleet; the in-process timer is for
// single instances. A quiet run (nothing broke) dispatches no notification.
router.post("/admin/drift-canary/run", requireRole("admin"), (_req, res) =>
  runJob(res, "drift-canary", () => runDriftCanary({ now: Date.now(), broker: getBroker() })),
);

router.get("/drift-canary", requireRole("manager"), (_req, res) => {
  res.json({ findings: recentDriftFindings() });
});

export default router;
