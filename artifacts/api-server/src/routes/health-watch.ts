import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getBroker } from "../broker";
import { deliverLocal } from "../lib/notify-hub";
import { runHealthWatch, recentFindings, type HealthFinding } from "../lib/health-watch";
import { runExecDigest } from "../lib/exec-digest";

/**
 * Health / anomaly watch + executive digest — the scheduled, read-only autonomous jobs. An admin
 * can trigger either; a manager+ can read recent health findings. Each runs as a keyed,
 * short-lived autonomous actor and dispatches over the notification seam (never writes here).
 */
const router = Router();

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

router.post("/health-watch/run", requireRole("admin"), async (_req, res) => {
  try {
    const findings = await runHealthWatch({ now: Date.now(), broker: getBroker(), notify });
    res.json({ findings, count: findings.length });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "health-watch run failed" });
  }
});

router.get("/health-watch", requireRole("manager"), (_req, res) => {
  res.json({ findings: recentFindings() });
});

// Trigger the executive digest now (admin). An external scheduler / the broker cron calls this
// so the digest fires once for the fleet; the optional in-process timer is for single instances.
router.post("/admin/digest/run", requireRole("admin"), async (_req, res) => {
  try {
    const digest = await runExecDigest({ now: Date.now(), broker: getBroker() });
    res.json({ digest });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "digest run failed" });
  }
});

export default router;
