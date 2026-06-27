import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { brokerReadiness } from "../broker";

/**
 * Liveness vs readiness — deliberately two different probes (the k8s distinction):
 *
 *  - GET /healthz  (LIVENESS) — "is the process alive?" Dependency-free on
 *    purpose: it must NOT depend on the broker, or a backend blip would make k8s
 *    kill-and-restart every replica (an outage amplifier). Always 200 if we can
 *    answer at all.
 *  - GET /readyz   (READINESS) — "can this replica actually serve, i.e. reach its
 *    backend?" Returns 503 when the broker is unreachable so the load balancer
 *    stops routing traffic here until it recovers — without restarting the pod.
 *
 * Both are public + un-rate-limited (mounted before auth/limiter) so the
 * orchestrator can always probe them.
 */
const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const r = await brokerReadiness();
  res.status(r.ready ? 200 : 503).json(r);
});

export default router;
