import { Router } from "express";
import { requireRole, ROLES, type Role } from "../lib/rbac";
import { getBroker } from "../broker";
import { deliverLocal } from "../lib/notify-hub";
import { runHealthWatch, recentFindings, type HealthFinding } from "../lib/health-watch";
import { runExecDigest } from "../lib/exec-digest";
import { runProactiveDigest } from "../lib/proactive-digest";
import { runDriftCanary, recentDriftFindings } from "../lib/drift-canary";

/**
 * Health / anomaly watch + executive & proactive digests + the drift canary — the scheduled,
 * read-only autonomous jobs. An admin can trigger any of them; a manager+ can read recent health
 * findings. Each runs as a keyed, short-lived autonomous actor and dispatches over the
 * notification seam (never writes here).
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
  try {
    const result = await runProactiveDigest({ now: Date.now(), broker: getBroker(), role });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "proactive-digest run failed" });
  }
});

// Trigger the third-party API drift canary now (admin). Like the digests, an external scheduler
// / the broker cron calls this so it fires once for the fleet; the in-process timer is for
// single instances. A quiet run (nothing broke) dispatches no notification.
router.post("/admin/drift-canary/run", requireRole("admin"), async (_req, res) => {
  try {
    const result = await runDriftCanary({ now: Date.now(), broker: getBroker() });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "drift-canary run failed" });
  }
});

router.get("/drift-canary", requireRole("manager"), (_req, res) => {
  res.json({ findings: recentDriftFindings() });
});

export default router;
