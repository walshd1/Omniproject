import { sharedStateMode, type SharedStateMode } from "./shared-state";
import { rateLimitMode } from "./rate-limit";

/**
 * Fleet-safety readiness (fail-closed at scale).
 *
 * Several security controls — the rate-limit ceilings, magic-link single-use, credential/session
 * revocation propagation, the AI kill-switch, SCIM deprovisioning — are only fleet-wide when the
 * shared-state seam (lib/shared-state) and the rate limiter are backed by Redis. Without it they
 * silently degrade to PER-REPLICA, which at N>1 replicas means N× brute-force attempts, replayable
 * single-use links, and revocations that don't propagate. The failure was silent: `REDIS_URL` set
 * but the runtime-optional client (`ioredis` / `rate-limit-redis`) missing, or Redis unreachable,
 * logged one line at boot and carried on serving a degraded replica.
 *
 * This makes that failure LOUD without a risky boot-crash: when the operator has DECLARED shared
 * state by setting `REDIS_URL`, a replica that has not actually ACHIEVED Redis-backed shared state
 * AND rate limiting reports NOT ready, so the load balancer stops routing to it (fail-closed) rather
 * than silently serving degraded security. It is a no-op (always ready) when `REDIS_URL` is unset —
 * a single-replica deployment is per-process by design and fully supported.
 *
 * The gate is deliberately on `/readyz` (not a boot refusal): Redis init is asynchronous and may lag
 * a few ms behind boot, and Redis can be transiently unreachable at startup — a readiness probe
 * absorbs both (it flips to ready the moment shared state comes up) where a hard boot-crash would
 * turn a transient blip into a crash-loop.
 */

export interface FleetReadiness {
  ready: boolean;
  /** Whether the operator declared shared state (REDIS_URL set). */
  redisConfigured: boolean;
  sharedState: SharedStateMode;
  rateLimit: "in-process" | "redis";
  /** Human-readable reason when not ready (for the probe body + operator triage). */
  detail?: string;
}

/** Pure verdict from already-resolved inputs — unit-testable without live Redis/modules. */
export function evaluateFleetReadiness(input: {
  redisConfigured: boolean;
  sharedState: SharedStateMode;
  rateLimit: "in-process" | "redis";
}): FleetReadiness {
  const { redisConfigured, sharedState, rateLimit } = input;
  // No shared state declared ⇒ single-replica posture is fine and fully ready.
  if (!redisConfigured) return { ready: true, redisConfigured, sharedState, rateLimit };
  const degraded: string[] = [];
  if (sharedState !== "redis") degraded.push("shared-state");
  if (rateLimit !== "redis") degraded.push("rate-limit");
  if (degraded.length === 0) return { ready: true, redisConfigured, sharedState, rateLimit };
  return {
    ready: false,
    redisConfigured,
    sharedState,
    rateLimit,
    detail:
      `REDIS_URL is set but ${degraded.join(" + ")} ${degraded.length > 1 ? "are" : "is"} still per-replica ` +
      "(the Redis client 'ioredis'/'rate-limit-redis' is not installed, or Redis is unreachable). Refusing " +
      "traffic to this replica until shared state is Redis-backed, so per-replica security controls can't " +
      "silently serve a fleet. Build the image with --build-arg WITH_REDIS=1 and check REDIS_URL connectivity.",
  };
}

/** Live verdict for THIS replica, reading the current shared-state + rate-limit backends. */
export function fleetReadiness(env: Record<string, string | undefined> = process.env): FleetReadiness {
  return evaluateFleetReadiness({
    redisConfigured: !!env["REDIS_URL"]?.trim(),
    sharedState: sharedStateMode(),
    rateLimit: rateLimitMode(),
  });
}
