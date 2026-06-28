import { firstDifference } from "./trace";
import { type Exchange } from "./capture";
import type { ActorContext, Broker } from "./types";

/**
 * Replay engine — play a capture tape (capture.ts) two ways:
 *
 *  - SERVE mode (`buildReplayBroker`): a Broker that returns the RECORDED responses
 *    for matching calls. A deterministic offline cassette — reproduce a bug, or run
 *    instance B with no backend at all (also sidesteps an egress block). No
 *    mutations: it only ever hands back what was recorded.
 *
 *  - RE-DRIVE mode (`redrive`): re-issue the recorded instructions against a LIVE
 *    target broker (instance B) in recorded order, and diff each live result
 *    against the recording to surface where B diverges from A. Powerful but real:
 *    writes mutate the target, so it is READ-ONLY by default — write methods are
 *    skipped unless `allowWrites`, and `dryRun` performs no calls at all.
 *
 * Both are dev-only by construction: a tape only exists when capture was armed,
 * which is itself hard-gated to non-production.
 */

/** Broker methods that mutate the backend — skipped by re-drive unless allowed. */
export function isWriteMethod(method: string): boolean {
  return /^(create|update|delete|write|add|set|put|post|remove)/i.test(method);
}

/** A stable key for matching a recorded call: method + args AFTER the actor ctx
 *  (arg 0 is the ActorContext, which varies per instance and is scrubbed). */
export function exchangeKey(method: string, args: unknown[]): string {
  return `${method}:${JSON.stringify(args.slice(1))}`;
}

/**
 * Serve mode: a Broker backed by a tape. Calls return the recorded result for the
 * matching (method, args) key, served in recorded order when a key repeats. An
 * unmatched call throws, so a gap in the tape is loud, not silently wrong.
 */
export function buildReplayBroker(tape: Exchange[]): Broker {
  const queues = new Map<string, Exchange[]>();
  for (const ex of tape) {
    if (ex.plane !== "broker") continue;
    const key = exchangeKey(ex.method, ex.args);
    (queues.get(key) ?? queues.set(key, []).get(key)!).push(ex);
  }
  const base = { kind: "replay", live: false };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      const method = String(prop);
      if (method === "then") return undefined; // not a thenable
      return async (...args: unknown[]) => {
        const key = exchangeKey(method, args);
        const q = queues.get(key);
        if (!q || q.length === 0) {
          throw new Error(`replay: no recorded exchange for ${method} (key ${key})`);
        }
        const ex = q.shift()!;
        if (!ex.ok) throw new Error(`replay: recorded failure for ${method}: ${JSON.stringify(ex.error ?? {})}`);
        return ex.result;
      };
    },
  }) as unknown as Broker;
}

export interface RedriveOptions {
  allowWrites?: boolean;
  dryRun?: boolean;
}

export interface RedriveStep {
  seq: number;
  method: string;
  status: "ok" | "diverged" | "failed" | "skipped-write" | "dry-run";
  detail?: string;
}

export interface RedriveReport {
  total: number;
  ran: number;
  ok: number;
  diverged: number;
  failed: number;
  skipped: number;
  steps: RedriveStep[];
}

/**
 * Re-drive a tape against a live broker (instance B), diffing each live result
 * against the recording. Read-only unless `allowWrites`; `dryRun` lists only.
 */
export async function redrive(
  tape: Exchange[],
  broker: Broker,
  ctx: ActorContext,
  opts: RedriveOptions = {},
): Promise<RedriveReport> {
  const steps: RedriveStep[] = [];
  let ran = 0, ok = 0, diverged = 0, failed = 0, skipped = 0;
  const brokerCalls = tape.filter((e) => e.plane === "broker");
  for (const ex of brokerCalls) {
    const write = isWriteMethod(ex.method);
    if (write && !opts.allowWrites) {
      skipped++;
      steps.push({ seq: ex.seq, method: ex.method, status: "skipped-write", detail: "read-only; pass allowWrites to include" });
      continue;
    }
    if (opts.dryRun) {
      steps.push({ seq: ex.seq, method: ex.method, status: "dry-run", detail: write ? "WRITE" : "read" });
      continue;
    }
    const fn = (broker as unknown as Record<string, unknown>)[ex.method];
    if (typeof fn !== "function") {
      failed++;
      steps.push({ seq: ex.seq, method: ex.method, status: "failed", detail: "target broker has no such method" });
      continue;
    }
    // Substitute the local actor ctx for the recorded (scrubbed) one in arg 0.
    const callArgs = ex.args.length > 0 ? [ctx, ...ex.args.slice(1)] : [ctx];
    try {
      const live = await (fn as (...a: unknown[]) => Promise<unknown>).apply(broker, callArgs);
      ran++;
      const diff = ex.ok ? firstDifference(ex.result, live) : null;
      if (diff) {
        diverged++;
        steps.push({ seq: ex.seq, method: ex.method, status: "diverged", detail: diff });
      } else {
        ok++;
        steps.push({ seq: ex.seq, method: ex.method, status: "ok" });
      }
    } catch (err) {
      failed++;
      steps.push({ seq: ex.seq, method: ex.method, status: "failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return { total: brokerCalls.length, ran, ok, diverged, failed, skipped, steps };
}
