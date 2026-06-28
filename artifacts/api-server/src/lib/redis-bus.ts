import { logger } from "./logger";

/**
 * Shared Redis Pub/Sub fan-out base. The notification bus and the broker-log bus both need the
 * SAME bootstrap — optional `REDIS_URL`, a runtime-dynamic `ioredis` import (so it's never a
 * committed dependency), a duplicated subscriber, a `mode` flag and graceful in-process
 * fallback. That bootstrap lived twice; this owns it once. Subclasses supply only the channel,
 * the log lines, how to HANDLE an inbound message, and their own publish semantics on top of
 * {@link RedisBus.broadcast}.
 */

export interface MinimalRedis {
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): void;
  duplicate(): MinimalRedis;
  quit(): Promise<unknown>;
}

export type BusMode = "in-process" | "redis";

/** Log lines for the three lifecycle moments, so each bus keeps its own wording. */
export interface RedisBusNotes {
  /** REDIS_URL set but ioredis not installed — stay in-process. */
  missingDep: string;
  /** Redis connect/init failed — fall back to in-process. */
  fallback: string;
  /** Redis fan-out is live. */
  enabled: string;
}

export abstract class RedisBus {
  mode: BusMode = "in-process";
  protected pub: MinimalRedis | null = null;
  protected ready: Promise<void> | null = null;

  constructor(protected readonly channel: string, private readonly notes: RedisBusNotes) {
    const url = process.env["REDIS_URL"]?.trim();
    if (url) {
      this.ready = this.initRedis(url).catch((err) => {
        logger.warn({ err }, this.notes.fallback);
        this.mode = "in-process";
        this.pub = null;
      });
    }
  }

  /** Handle a message delivered from another replica over the channel. */
  protected abstract handleMessage(message: string): void;

  private async initRedis(url: string): Promise<void> {
    // Avoid static module resolution so ioredis isn't a required dependency.
    const moduleName = "ioredis";
    const mod = (await import(moduleName).catch(() => null)) as { default?: new (u: string) => MinimalRedis } | null;
    const Redis = mod?.default;
    if (!Redis) {
      logger.warn(this.notes.missingDep);
      return;
    }
    this.pub = new Redis(url);
    const sub = this.pub.duplicate();
    await sub.subscribe(this.channel);
    sub.on("message", (_channel, message) => this.handleMessage(message));
    this.mode = "redis";
    logger.info(this.notes.enabled);
  }

  /** Publish a raw message to the channel. Returns true if it went to Redis, false in
   *  in-process mode (so the caller can deliver locally instead). Awaits readiness first. */
  protected async broadcast(message: string): Promise<boolean> {
    if (this.ready) await this.ready;
    if (this.mode === "redis" && this.pub) {
      await this.pub.publish(this.channel, message);
      return true;
    }
    return false;
  }
}
