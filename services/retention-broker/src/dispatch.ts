/**
 * Map a retention op name + JSON body to a `RetentionSource` call. Pure over the injected source, so
 * it's unit-testable without a running HTTP server. The gateway's `BrokerRetentionSource` calls these
 * ops (`/retention/<op>`), so the names here are the wire contract — keep them in lock-step.
 */
import type { RetentionSource } from "./contract";
import { parseWindow, parseEntries, parseSnapshot, requireString, requireStringArray } from "./validate";

export type Op = "read-snapshots" | "read-journal" | "append-journal" | "write-snapshot" | "last-snapshot-at";

export const OPS: readonly Op[] = ["read-snapshots", "read-journal", "append-journal", "write-snapshot", "last-snapshot-at"];

export function isOp(x: string): x is Op {
  return (OPS as readonly string[]).includes(x);
}

export async function dispatch(source: RetentionSource, op: Op, body: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "read-snapshots":
      return source.readSnapshots(requireString(body["entity"], "entity"), requireStringArray(body["ids"], "ids"), parseWindow(body["window"]));
    case "read-journal":
      return source.readJournal(requireString(body["entity"], "entity"), requireString(body["id"], "id"), parseWindow(body["window"]));
    case "append-journal":
      await source.appendJournal(parseEntries(body["entries"]));
      return { ok: true };
    case "write-snapshot":
      await source.writeSnapshot(parseSnapshot(body["snapshot"]));
      return { ok: true };
    case "last-snapshot-at":
      return { asOf: await source.lastSnapshotAt(requireString(body["entity"], "entity"), requireString(body["id"], "id")) };
  }
}
