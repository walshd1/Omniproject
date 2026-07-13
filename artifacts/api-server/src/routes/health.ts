import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { brokerReadiness } from "../broker";
import { fleetReadiness } from "../lib/fleet-readiness";

/**
 * Liveness vs readiness — deliberately two different probes (the k8s distinction):
 *
 *  - GET /healthz  (LIVENESS) — "is the process alive?" Dependency-free on
 *    purpose: it must NOT depend on the broker, or a backend blip would make k8s
 *    kill-and-restart every replica (an outage amplifier). Always 200 if we can
 *    answer at all.
 *  - GET /readyz   (READINESS) — "can this replica actually serve, i.e. reach its
 *    backend AND (when a fleet is declared) actually have Redis-backed shared
 *    state?" Returns 503 when the broker is unreachable OR when REDIS_URL is set
 *    but shared state/rate-limiting silently fell back to per-replica — so the
 *    load balancer stops routing here (fail-closed) rather than serving degraded
 *    security, without restarting the pod. See lib/fleet-readiness.ts.
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
  const broker = await brokerReadiness();
  // Fleet-safety gate: a replica that declared shared state (REDIS_URL) but didn't achieve it must
  // not take traffic — its per-replica security controls would silently serve a fleet. No-op when
  // REDIS_URL is unset (single-replica is per-process by design).
  const fleet = fleetReadiness();
  const ready = broker.ready && fleet.ready;
  res.status(ready ? 200 : 503).json({ ...broker, ready, fleet });
});

export default router;
