/**
 * Map a retention op name + JSON body to a `RetentionSource` call. Pure over the injected source, so
 * it's unit-testable without a running HTTP server. The gateway's `BrokerRetentionSource` calls these
 * ops (`/retention/<op>`), so the names here are the wire contract — keep them in lock-step.
 */
import type { RetentionSource, EntitySnapshot, HistoryEntry, TimeWindow } from "./contract";

export type Op = "read-snapshots" | "read-journal" | "append-journal" | "write-snapshot" | "last-snapshot-at";

export const OPS: readonly Op[] = ["read-snapshots", "read-journal", "append-journal", "write-snapshot", "last-snapshot-at"];

export function isOp(x: string): x is Op {
  return (OPS as readonly string[]).includes(x);
}

export async function dispatch(source: RetentionSource, op: Op, body: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "read-snapshots":
      return source.readSnapshots(String(body["entity"]), body["ids"] as string[], body["window"] as TimeWindow);
    case "read-journal":
      return source.readJournal(String(body["entity"]), String(body["id"]), body["window"] as TimeWindow);
    case "append-journal":
      await source.appendJournal(body["entries"] as HistoryEntry[]);
      return { ok: true };
    case "write-snapshot":
      await source.writeSnapshot(body["snapshot"] as EntitySnapshot);
      return { ok: true };
    case "last-snapshot-at":
      return { asOf: await source.lastSnapshotAt(String(body["entity"]), String(body["id"])) };
  }
}
