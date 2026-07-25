/**
 * The PROJECTION ENGINE — the one vendor-neutral substrate for applying an advertised mapping to hard data.
 *
 * This is the shared core the whole "backend advertises its mapping → generic projector maps to an agnostic
 * surface" model is built on. It holds only mechanism — value-map lookup, the closed set of field transforms,
 * dotted-path extraction, wrapper-unwrapping, and predicate evaluation — with NO vendor knowledge. Composers
 * layer over it:
 *   - `broker/backends/invoice-mapping` composes these into a bidirectional invoice record projection (the
 *     richest consumer: field maps + transforms + inbound extraction + settlement predicate);
 *   - `broker/vocabulary` uses {@link applyValueMap} to apply a backend's advertised status dialect
 *     (`statusVocabulary.toCanonical`) — the same value-map primitive, one implementation.
 *
 * The transform set is CLOSED: every non-rename mapping is a named primitive here, so an advertised mapping is
 * pure data with no server-side evaluation of vendor-supplied expressions.
 */
import type { InvoiceSyncOutboundField as TransformField, InvoiceSyncPredicate as Predicate } from "@workspace/backend-catalogue";

export type { TransformField, Predicate };

/** A record that is definitely a plain object, or null. */
export const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Apply an advertised value-map: look `rawKey` up in `map` (optionally lower-cased first) and return the hit,
 * else `fallback`. This is the single implementation behind every "native value → canonical" dialect map —
 * a backend's `statusVocabulary`, an invoice line's `type_id` map, etc.
 */
export function applyValueMap<T = string>(
  rawKey: unknown,
  map: Record<string, T> | undefined,
  opts: { lowerCase?: boolean; fallback?: T } = {},
): T | undefined {
  if (!map) return opts.fallback;
  const raw = typeof rawKey === "string" ? rawKey : String(rawKey);
  const key = opts.lowerCase ? raw.trim().toLowerCase() : raw;
  const hit = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  return hit ?? opts.fallback;
}

/** Read a dotted path with numeric index support (`a.b.0.c`). Returns undefined if any hop is missing. */
export function getPath(src: unknown, path: string): unknown {
  let cur: unknown = src;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(seg);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else return undefined;
  }
  return cur;
}

/** Descend into the first present wrapper object (like `{data:{…}}`), else return the record as-is. */
export function unwrap(raw: unknown, keys: readonly string[] | undefined): Record<string, unknown> | null {
  const outer = asRecord(raw);
  if (!outer) return null;
  for (const k of keys ?? []) {
    const inner = asRecord(outer[k]);
    if (inner) return inner;
  }
  return outer;
}

/** Apply one advertised outbound field transform against its source record. `src` is passed so a transform can
 *  read a SIBLING field (e.g. sign a value based on the record's `kind`). Pure; the transform set is closed. */
export function applyTransform(src: Record<string, unknown>, f: TransformField): unknown {
  const raw = src[f.from];
  if (!("transform" in f)) return raw;
  switch (f.transform) {
    case "date-only": {
      if (typeof raw !== "string" || !raw) return null;
      const d = raw.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    }
    case "map":
      return applyValueMap(raw, f.map, { fallback: f.default });
    case "sign-when": {
      const n = Number(raw);
      return src[f.whenField] === f.equals ? -Math.abs(n) : n;
    }
    case "const-when-gt":
      return Number(raw) > f.gt ? f.then : f.else;
  }
}

/** Evaluate an advertised settlement predicate over a normalised record — a leaf (strict-equality set and/or
 *  numeric comparisons) or a boolean combinator. Pure. */
export function evalPredicate(rec: Record<string, unknown>, p: Predicate): boolean {
  if ("anyOf" in p) return p.anyOf.some((sub) => evalPredicate(rec, sub));
  if ("allOf" in p) return p.allOf.every((sub) => evalPredicate(rec, sub));
  const raw = rec[p.field];
  if (p.equalsAny && p.equalsAny.some((e) => e === raw)) return true;
  if (p.lte !== undefined || p.gt !== undefined || p.finite) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    if (p.lte !== undefined && !(n <= p.lte)) return false;
    if (p.gt !== undefined && !(n > p.gt)) return false;
    return p.lte !== undefined || p.gt !== undefined; // `finite` alone is a gate, not a match
  }
  return false;
}
