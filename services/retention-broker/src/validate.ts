/**
 * Request-body validation for the retention wire ops. The broker writes attacker-reachable input
 * straight into S3/DynamoDB/BigQuery, so every op's body is validated here BEFORE it reaches a
 * `RetentionSource`. A `ValidationError` maps to HTTP 400 in server.ts; anything else is a 500.
 *
 * Timestamps are held to a strict ISO-8601 shape: the object-store key layout embeds `changedAt`/
 * `asOf` verbatim (`journal/{entity}/{id}/{changedAt}#{txnId}#{field}.json`), so a value containing
 * `/` or `#` would inject extra key segments and corrupt the "lexical order = time order" invariant.
 */
import type { EntitySnapshot, HistoryEntry, TimeWindow, Provenance } from "./contract";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const PROVENANCE: readonly Provenance[] = ["sourced", "derived", "sample", "replayed", "projected"];
// Date-time with required timezone (Z or ±HH:MM). No `/` or `#`, so it is always a safe key segment.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) throw new ValidationError(`${field} must be a non-empty string`);
  return v;
}

/** A value that becomes a KEY SEGMENT in the storage layout (`journal/{entity}/{id}/{changedAt}#{txnId}#{field}`).
 *  Reject the path/field separators and traversal, or a crafted value could collide with, overwrite, or
 *  escape another entry's key — silent append-log / audit-trail tampering. */
export function requireKeySegment(v: unknown, field: string): string {
  const s = requireString(v, field);
  // eslint-disable-next-line no-control-regex
  if (/[/\\#]/.test(s) || s.includes("..") || /[\x00-\x1f]/.test(s)) {
    throw new ValidationError(`${field} must not contain path/segment separators (/, \\, #), "..", or control characters`);
  }
  return s;
}

function requireTimestamp(v: unknown, field: string): string {
  const s = requireString(v, field);
  if (!ISO_8601.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ValidationError(`${field} must be an ISO-8601 timestamp`);
  }
  return s;
}

function requireStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new ValidationError(`${field} must be an array`);
  return v.map((x, i) => requireString(x, `${field}[${i}]`));
}

export function parseWindow(v: unknown): TimeWindow {
  if (typeof v !== "object" || v === null) throw new ValidationError("window must be an object");
  const w = v as Record<string, unknown>;
  return { from: requireTimestamp(w["from"], "window.from"), to: requireTimestamp(w["to"], "window.to") };
}

function parseEntry(v: unknown, i: number): HistoryEntry {
  if (typeof v !== "object" || v === null) throw new ValidationError(`entries[${i}] must be an object`);
  const e = v as Record<string, unknown>;
  return {
    entity: requireKeySegment(e["entity"], `entries[${i}].entity`),
    id: requireKeySegment(e["id"], `entries[${i}].id`),
    field: requireKeySegment(e["field"], `entries[${i}].field`),
    oldValue: e["oldValue"],
    newValue: e["newValue"],
    changedAt: requireTimestamp(e["changedAt"], `entries[${i}].changedAt`),
    changedBy: e["changedBy"] == null ? null : requireString(e["changedBy"], `entries[${i}].changedBy`),
    txnId: requireKeySegment(e["txnId"], `entries[${i}].txnId`),
  };
}

export function parseEntries(v: unknown): HistoryEntry[] {
  if (!Array.isArray(v)) throw new ValidationError("entries must be an array");
  return v.map(parseEntry);
}

export function parseSnapshot(v: unknown): EntitySnapshot {
  if (typeof v !== "object" || v === null) throw new ValidationError("snapshot must be an object");
  const s = v as Record<string, unknown>;
  const provenance = requireString(s["provenance"], "snapshot.provenance");
  if (!(PROVENANCE as readonly string[]).includes(provenance)) {
    throw new ValidationError(`snapshot.provenance must be one of ${PROVENANCE.join(", ")}`);
  }
  const values = s["values"];
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new ValidationError("snapshot.values must be an object");
  }
  return {
    entity: requireKeySegment(s["entity"], "snapshot.entity"),
    id: requireKeySegment(s["id"], "snapshot.id"),
    asOf: requireTimestamp(s["asOf"], "snapshot.asOf"),
    values: values as Record<string, unknown>,
    provenance: provenance as Provenance,
  };
}

export { requireString, requireTimestamp, requireStringArray };
