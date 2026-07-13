import crypto from "node:crypto";
import { foldRemoteEntry, registerBrokerLogPublisher, type BrokerLogEntry } from "./broker-log";
import { RedisBus } from "./redis-bus";
import { safeParseJson } from "./safe-json";
import { lazySingleton } from "./lazy-singleton";

/**
 * Broker-log fan-out bus — makes the admin live broker log **fleet-wide** under
 * horizontal scale. Deliberately mirrors notify-bus.ts (same optional-Redis
 * pattern) rather than sharing a connection, so the two concerns stay independent
 * and the proven notify path is untouched.
 *
 *  - Default: in-process. Single replica; nothing to fan out. Zero deps.
 *  - Scaled: when `REDIS_URL` is set, each locally-recorded entry is published to
 *    a Redis Pub/Sub channel and every OTHER replica folds it into its own ring +
 *    live SSE subscribers, so an admin watching any replica sees the whole fleet.
 *
 * ioredis is a RUNTIME-OPTIONAL dependency (dynamic import): enable HA by setting
 * `REDIS_URL` and installing ioredis. Without it we log once and stay per-replica
 * (the log still works — it just shows this node only).
 *
 * Self-echo: the publishing replica already added the entry locally and tags the
 * message with a per-process `instanceId`; it ignores its own echo so an entry is
 * never double-counted.
 */

const CHANNEL = "omniproject:broker-log";

interface Wire {
  from: string;
  entry: BrokerLogEntry;
}

class BrokerLogBus extends RedisBus {
  /** Unique per process — for suppressing our own Pub/Sub echo. */
  readonly instanceId = crypto.randomUUID();

  constructor() {
    super(CHANNEL, {
      missingDep: "broker-log bus: REDIS_URL set but 'ioredis' is not installed — broker log shows THIS replica only. Run: pnpm --filter @workspace/api-server add ioredis",
      fallback: "broker-log bus: Redis unavailable — falling back to per-replica log",
      enabled: "broker-log bus: Redis Pub/Sub fan-out enabled (fleet-wide live log)",
    });
    // Always register the publisher: in-process mode it is a no-op, in Redis mode
    // it broadcasts. Registering unconditionally keeps wiring simple.
    registerBrokerLogPublisher((entry) => {
      void this.publish(entry);
    });
  }

  protected handleMessage(message: string): void {
    try {
      const wire = safeParseJson<Wire>(message); // cross-replica input — strip dangerous keys before use
      if (wire.from === this.instanceId) return; // our own echo; already recorded locally
      foldRemoteEntry(wire.entry);
    } catch {
      /* ignore malformed bus message */
    }
  }

  /** Broadcast a locally-recorded entry to the other replicas. Fire-and-forget;
   *  in-process mode is a no-op (nothing to fan out). */
  async publish(entry: BrokerLogEntry): Promise<void> {
    const wire: Wire = { from: this.instanceId, entry };
    await this.broadcast(JSON.stringify(wire));
  }
}

const busSingleton = lazySingleton(() => new BrokerLogBus());

/** Construct (idempotently) and return the broker-log bus. Calling this at boot
 *  is what makes a replica start RECEIVING the fleet's entries — do it early. */
export function initBrokerLogBus(): BrokerLogBus {
  return busSingleton.get();
}

/** Which fan-out backend the broker-log stream uses: in-process or Redis. */
export function brokerLogBusMode(): "in-process" | "redis" {
  return initBrokerLogBus().mode;
}
