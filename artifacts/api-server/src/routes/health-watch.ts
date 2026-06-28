import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getBroker } from "../broker";
import { deliverLocal } from "../lib/notify-hub";
import { runHealthWatch, recentFindings, type HealthFinding } from "../lib/health-watch";

/**
 * Health / anomaly watch. An admin can trigger a scan; a manager+ can read recent
 * findings. The scan runs as the keyed `automation:health-watch` actor and raises a
 * notification per finding (read-only — it observes and alerts, it never writes here).
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

export default router;
