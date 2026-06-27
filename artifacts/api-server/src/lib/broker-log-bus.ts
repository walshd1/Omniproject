import crypto from "node:crypto";
import { foldRemoteEntry, registerBrokerLogPublisher, type BrokerLogEntry } from "./broker-log";
import { logger } from "./logger";

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

interface MinimalRedis {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): void;
  duplicate(): MinimalRedis;
  quit(): Promise<unknown>;
}

interface Wire {
  from: string;
  entry: BrokerLogEntry;
}

class BrokerLogBus {
  mode: "in-process" | "redis" = "in-process";
  /** Unique per process — for suppressing our own Pub/Sub echo. */
  readonly instanceId = crypto.randomUUID();
  private pub: MinimalRedis | null = null;
  private ready: Promise<void> | null = null;

  constructor() {
    const url = process.env["REDIS_URL"]?.trim();
    if (url) {
      this.ready = this.initRedis(url).catch((err) => {
        logger.warn({ err }, "broker-log bus: Redis unavailable — falling back to per-replica log");
        this.mode = "in-process";
        this.pub = null;
      });
    }
    // Always register the publisher: in-process mode it is a no-op, in Redis mode
    // it broadcasts. Registering unconditionally keeps wiring simple.
    registerBrokerLogPublisher((entry) => {
      void this.publish(entry);
    });
  }

  private async initRedis(url: string): Promise<void> {
    const moduleName = "ioredis";
    const mod = (await import(moduleName).catch(() => null)) as { default?: new (u: string) => MinimalRedis } | null;
    const Redis = mod?.default;
    if (!Redis) {
      logger.warn("broker-log bus: REDIS_URL set but 'ioredis' is not installed — broker log shows THIS replica only. Run: pnpm --filter @workspace/api-server add ioredis");
      return;
    }
    this.pub = new Redis(url);
    const sub = this.pub.duplicate();
    await sub.subscribe(CHANNEL);
    sub.on("message", (_channel, message) => {
      try {
        const wire = JSON.parse(message) as Wire;
        if (wire.from === this.instanceId) return; // our own echo; already recorded locally
        foldRemoteEntry(wire.entry);
      } catch {
        /* ignore malformed bus message */
      }
    });
    this.mode = "redis";
    logger.info("broker-log bus: Redis Pub/Sub fan-out enabled (fleet-wide live log)");
  }

  /** Broadcast a locally-recorded entry to the other replicas. Fire-and-forget;
   *  in-process mode is a no-op (nothing to fan out). */
  async publish(entry: BrokerLogEntry): Promise<void> {
    if (this.ready) await this.ready;
    if (this.mode === "redis" && this.pub) {
      const wire: Wire = { from: this.instanceId, entry };
      await this.pub.publish(CHANNEL, JSON.stringify(wire));
    }
  }
}

let bus: BrokerLogBus | null = null;

/** Construct (idempotently) and return the broker-log bus. Calling this at boot
 *  is what makes a replica start RECEIVING the fleet's entries — do it early. */
export function initBrokerLogBus(): BrokerLogBus {
  if (!bus) bus = new BrokerLogBus();
  return bus;
}

/** Which fan-out backend the broker-log stream uses: in-process or Redis. */
export function brokerLogBusMode(): "in-process" | "redis" {
  return initBrokerLogBus().mode;
}
