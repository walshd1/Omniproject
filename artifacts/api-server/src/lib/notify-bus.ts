import { deliverLocal, clientCount, type NotifyTarget } from "./notify-hub";
import { RedisBus } from "./redis-bus";

/**
 * Notification bus — decouples "an event arrived" from "fan it out to the SSE
 * clients on every replica".
 *
 *  - Default: in-process. Single replica; publish() delivers locally. Zero deps.
 *  - Scaled: when REDIS_URL is set, publish() goes to a Redis Pub/Sub channel and
 *    every replica's subscriber fans out to its own connected clients. Redis is
 *    the right tool here (ephemeral broadcast, fire-and-forget) — Kafka would be
 *    overkill; if Kafka is your backbone, bridge it into /notifications/ingest
 *    instead, upstream of this bus.
 *
 * The Redis client is loaded via a runtime dynamic import so it is NOT a
 * committed dependency: enable HA by setting REDIS_URL and installing ioredis
 * (`pnpm --filter @workspace/api-server add ioredis`). Without it we log once and
 * stay in-process.
 */

export interface NotifyEnvelope {
  notification: unknown;
  target?: NotifyTarget;
}

const CHANNEL = "omniproject:notifications";

class NotifyBus extends RedisBus {
  constructor() {
    super(CHANNEL, {
      missingDep: "notify bus: REDIS_URL set but 'ioredis' is not installed — staying in-process. Run: pnpm --filter @workspace/api-server add ioredis",
      fallback: "notify bus: Redis unavailable — falling back to in-process fan-out",
      enabled: "notify bus: Redis Pub/Sub fan-out enabled",
    });
  }

  protected handleMessage(message: string): void {
    try {
      const env = JSON.parse(message) as NotifyEnvelope;
      deliverLocal(env.notification, env.target);
    } catch {
      /* ignore malformed bus message */
    }
  }

  /**
   * Publish an event. Returns the count delivered to LOCAL clients (in-process
   * mode), or null when delivery is asynchronous across replicas (Redis mode).
   */
  async publish(env: NotifyEnvelope): Promise<number | null> {
    // In Redis mode every replica (including this one) delivers via its subscription,
    // so we don't also deliver locally — that would double-send.
    if (await this.broadcast(JSON.stringify(env))) return null;
    return deliverLocal(env.notification, env.target);
  }
}

let bus: NotifyBus | null = null;

/** The process-wide notification fan-out bus (lazily created singleton). */
export function getNotifyBus(): NotifyBus {
  if (!bus) bus = new NotifyBus();
  return bus;
}

/** Which fan-out backend the bus uses: in-process or Redis. */
export function busMode(): "in-process" | "redis" {
  return getNotifyBus().mode;
}

export { clientCount };
