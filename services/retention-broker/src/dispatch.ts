/**
 * Map a retention op name + JSON body to a `RetentionSource` call. Pure over the injected source, so
 * it's unit-testable without a running HTTP server. The gateway's `BrokerRetentionSource` calls these
 * ops (`/retention/<op>`), so the names here are the wire contract — keep them in lock-step.
 */
import type { RetentionSource } from "./contract";
import { parseWindow, parseEntries, parseSnapshot, requireString, requireStringArray, requireTimestamp } from "./validate";

export type Op =
  | "read-snapshots"
  | "read-journal"
  | "append-journal"
  | "write-snapshot"
  | "last-snapshot-at"
  | "dispose-older-than"
  | "erase-entity";

export const OPS: readonly Op[] = [
  "read-snapshots",
  "read-journal",
  "append-journal",
  "write-snapshot",
  "last-snapshot-at",
  "dispose-older-than",
  "erase-entity",
];

export function isOp(x: string): x is Op {
  return (OPS as readonly string[]).includes(x);
}

/** Raised when a disposal/erasure op reaches a source whose backend can't delete. Maps to HTTP 501. */
export class UnsupportedOpError extends Error {
  constructor(op: string) {
    super(`retention source does not support "${op}"`);
    this.name = "UnsupportedOpError";
  }
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
    case "dispose-older-than": {
      if (!source.disposeOlderThan) throw new UnsupportedOpError(op);
      const cutoff = requireTimestamp(body["cutoff"], "cutoff");
      // heldKeys is optional; an absent value means "nothing held" (empty array).
      const heldKeys = body["heldKeys"] === undefined ? [] : requireStringArray(body["heldKeys"], "heldKeys");
      return source.disposeOlderThan(cutoff, { heldKeys });
    }
    case "erase-entity": {
      if (!source.eraseEntity) throw new UnsupportedOpError(op);
      return source.eraseEntity(requireString(body["entity"], "entity"), requireString(body["id"], "id"));
    }
  }
}
