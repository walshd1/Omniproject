import crypto from "node:crypto";
import { foldRemotePresence, localPresenceForHeartbeat, registerPresencePublisher, type PresenceEvent } from "./presence-hub";
import { RedisBus } from "./redis-bus";
import { safeParseJson } from "./safe-json";
import { lazySingleton } from "./lazy-singleton";

/**
 * Presence fan-out bus — makes live-collaboration presence (rosters + advisory editing indicators)
 * **fleet-wide** under horizontal scale, strictly OPT-IN via `REDIS_URL`.
 *
 * Why its OWN RedisBus subclass on its own channel (like broker-log-bus) rather than reusing the
 * notify bus:
 *   - Different payload + different consumer. Presence events (join/leave/editing/heartbeat) fold
 *     into the presence hub's roster mirror; notifications deliver to notify-hub SSE clients.
 *     Sharing one channel would force every subscriber to deserialise and skip the other's traffic.
 *   - Isolation. Presence is high-frequency, purely ephemeral, and best-effort; keeping it off the
 *     proven notification path means a presence storm can never perturb notification delivery, and
 *     either concern can evolve independently. The tiny cost is a second Redis connection pair.
 *
 *  - Default: in-process. Single replica; publishing fans out to nothing and no remote peers ever
 *    exist. Zero deps, and byte-identical to the original local-only hub.
 *  - Scaled: when `REDIS_URL` is set, each local presence change is published to a Redis Pub/Sub
 *    channel and every OTHER replica folds it into its roster mirror + re-fans to its own sockets.
 *
 * ioredis is a RUNTIME-OPTIONAL dependency (dynamic import): enable HA by setting `REDIS_URL` and
 * installing ioredis. Without it we log once and stay per-replica (presence still works locally).
 *
 * Loop safety: every wire message is tagged with a per-process `instanceId`; a replica ignores its
 * own echo (it already applied the change locally), and folded remote events are NEVER re-published.
 * Ghost safety: while in Redis mode a low-frequency heartbeat re-publishes this node's live peers so
 * other replicas keep them past PEER_TTL_MS; a crashed replica stops heartbeating and its peers reap.
 */

const CHANNEL = "omniproject:presence";

/** How often (ms) a Redis-mode replica re-publishes its live peers to refresh remote lastSeen.
 *  Must be < PEER_TTL_MS (30s) with margin so a live-but-idle peer is never ghosted. */
const HEARTBEAT_MS = 10_000;

interface Wire {
  from: string;
  ev: PresenceEvent;
}

export class PresenceBus extends RedisBus {
  /** Unique per process — for suppressing our own Pub/Sub echo. */
  readonly instanceId = crypto.randomUUID();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super(CHANNEL, {
      missingDep: "presence bus: REDIS_URL set but 'ioredis' is not installed — presence shows THIS replica only. Run: pnpm --filter @workspace/api-server add ioredis",
      fallback: "presence bus: Redis unavailable — falling back to per-replica presence",
      enabled: "presence bus: Redis Pub/Sub fan-out enabled (fleet-wide presence)",
    });
    // Always register the publisher: in-process mode it is a no-op (broadcast returns false), in
    // Redis mode it fans out. Registering unconditionally keeps the hub wiring simple.
    registerPresencePublisher((ev) => {
      void this.publish(ev);
    });
    // Start the fleet heartbeat ONLY once we know we actually connected to Redis, so a single-replica
    // / no-REDIS_URL deployment starts no timers at all and stays byte-identical to today.
    if (this.ready) void this.ready.then(() => this.startHeartbeat());
  }

  private startHeartbeat(): void {
    if (this.mode !== "redis" || this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const ev of localPresenceForHeartbeat()) void this.publish(ev);
    }, HEARTBEAT_MS);
    // Never keep the process alive just for presence heartbeats.
    (this.heartbeat as { unref?: () => void }).unref?.();
  }

  protected handleMessage(message: string): void {
    try {
      const wire = safeParseJson<Wire>(message); // cross-replica input — strip dangerous keys before use
      if (wire.from === this.instanceId) return; // our own echo; already applied locally
      foldRemotePresence(wire.ev, Date.now());
    } catch {
      /* ignore malformed bus message */
    }
  }

  /** Broadcast a local presence change to the other replicas. Fire-and-forget; in-process mode is a
   *  no-op (broadcast returns false — nothing to fan out). */
  async publish(ev: PresenceEvent): Promise<void> {
    const wire: Wire = { from: this.instanceId, ev };
    await this.broadcast(JSON.stringify(wire));
  }
}

const busSingleton = lazySingleton(() => new PresenceBus());

/** Construct (idempotently) and return the presence bus. Calling this at boot is what makes a
 *  replica start RECEIVING the fleet's presence changes — do it early. */
export function initPresenceBus(): PresenceBus {
  return busSingleton.get();
}

/** Which fan-out backend presence uses: in-process or Redis. */
export function presenceBusMode(): "in-process" | "redis" {
  return initPresenceBus().mode;
}
