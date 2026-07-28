import { randomUUID } from "node:crypto";
import type { ActorContext, Broker } from "./types";
import { recordWrite, retentionSourceFor } from "../history/retention";
import { resolveCadence } from "../history/cadence";
import { resolveHistoryRetention } from "../lib/history-retention";
import type { ConfigScopes } from "../lib/scoped-config";
import { logger } from "../lib/logger";

/**
 * OPTIONAL, OFF-BY-DEFAULT retention capture around the broker seam.
 *
 * `recordWrite` (the durable-history write-path glue) was implemented and tested but called from NOWHERE
 * — so a deployment that configured a retention source still captured nothing automatically. Every
 * through-broker write funnels through the broker's write methods (the same set the autonomous-guard
 * wraps), so wrapping them here captures each write ONCE, for every broker and every call site (routes
 * AND in-process jobs), instead of a per-handler call that would miss some path.
 *
 * Zero-at-rest preserved by construction: capture is gated on `retentionSourceFor(scope) !== null`, which
 * is the pre-existing "is a retention store configured?" predicate — `null` (the default) means the whole
 * body is skipped and nothing is built, called or stored. Capture is also BEST-EFFORT and out-of-band:
 * it runs strictly AFTER the underlying write resolves (a failed write is never captured), and
 * `recordWrite` is fire-and-forget (`void … .catch`), so a journal/snapshot fault can never fail — or
 * slow — the originating write. This mirrors `lib/domain-event.ts`'s established best-effort pattern.
 */

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** What to capture for one write: the entity/id to snapshot, the post-image, and the project scope. */
interface Captured {
  entity: string;
  id: string | null;
  next: Record<string, unknown>;
  projectId: string | null;
}
type CaptureClassifier = (args: unknown[], result: unknown) => Captured | null;

/** Prefer the write's RESULT as the post-image (a complete entity) when the method returns one; else the
 *  payload that was written. Either way the snapshot reflects what the write produced. */
const post = (result: unknown, payload: Record<string, unknown>): Record<string, unknown> => {
  const r = rec(result);
  return Object.keys(r).length > 0 ? r : payload;
};
const idFrom = (result: unknown, ...fallbacks: (string | null)[]): string | null =>
  str(rec(result)["id"]) ?? fallbacks.find((f): f is string => !!f) ?? null;

/**
 * One classifier per guarded broker write method (parity with `GUARDED_WRITES`, asserted in the test), so
 * a new broker write can't silently skip capture. A classifier returns the snapshot to record, or `null`
 * to mean "this write is not a trend/snapshot entity" (comments, attachments, credentials, generic
 * commands) — an EXPLICIT no-capture, not an accidental omission. The captured set is deliberately the
 * snapshottable PPM entities (issue / project / task); widening it is a follow-up, not a correctness gap.
 */
const CAPTURE_CLASSIFIERS: Record<string, CaptureClassifier> = {
  writeIssue: (args, result) => {
    if (str(args[1]) === "delete") return null; // no post-image to snapshot for a deletion
    const input = rec(args[2]);
    return { entity: "issue", id: idFrom(result, str(input["issueId"]), str(input["id"])), next: post(result, input), projectId: str(input["projectId"]) };
  },
  createProject: (args, result) => {
    const input = rec(args[1]);
    const id = idFrom(result, str(input["id"]));
    return { entity: "project", id, next: post(result, input), projectId: id };
  },
  updateProject: (args, result) => {
    const id = str(args[1]);
    return { entity: "project", id, next: post(result, rec(args[2])), projectId: id };
  },
  createTask: (args, result) => {
    const input = rec(args[1]);
    return { entity: "task", id: idFrom(result, str(input["id"])), next: post(result, input), projectId: str(input["projectId"]) };
  },
  updateTask: (args, result) => {
    const id = str(args[1]);
    const patch = rec(args[2]);
    return { entity: "task", id, next: post(result, patch), projectId: str(patch["projectId"]) };
  },
  // Explicit no-capture: not trend/snapshot entities, or no stable single-entity post-image. Kept in the
  // registry so the parity test forces any NEW broker write to be classified here before it can ship.
  createTaskItem: () => null,
  addRaid: () => null,
  addTaskComment: () => null,
  addTaskAttachment: () => null,
  writeWikiDoc: () => null,
  writeWhiteboard: () => null,
  storeCredential: () => null,
  commandWithSource: () => null,
  nativeImport: () => null,
};

/** The set of broker write methods this wrapper intercepts — DERIVED from the classifier registry, so it
 *  can't drift from the guarded-write set (the parity test asserts it equals `GUARDED_WRITES`). */
export const CAPTURED_WRITES: ReadonlySet<string> = new Set(Object.keys(CAPTURE_CLASSIFIERS));

/**
 * Wrap a broker so every write is captured to the durable history store when one is configured. A no-op
 * (transparent pass-through) when no retention source is registered. Generic in the broker type so it can
 * wrap a concrete adapter (e.g. `ReferenceBroker`) without losing its extra methods.
 */
export function wrapWithRetentionCapture<T extends Broker>(
  base: T,
  opts: { now?: () => Date; uuid?: () => string } = {},
): T {
  const now = opts.now ?? (() => new Date());
  const uuid = opts.uuid ?? (() => randomUUID());
  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      const method = String(prop);
      if (typeof orig !== "function" || !CAPTURED_WRITES.has(method)) {
        return typeof orig === "function" ? (orig as (...a: unknown[]) => unknown).bind(target) : orig;
      }
      const classify = CAPTURE_CLASSIFIERS[method]!;
      return async function (this: unknown, ...args: unknown[]) {
        // The write runs first and its result is returned unconditionally at the end, so capture can never
        // change the write's outcome; a write that rejects propagates and is NOT captured.
        const result = await (orig as (...a: unknown[]) => unknown).apply(target, args);
        try {
          const captured = classify(args, result);
          if (captured && captured.id) {
            const scope: ConfigScopes = captured.projectId ? { projectId: captured.projectId } : {};
            const source = retentionSourceFor(scope); // null ⇒ off-by-default: skip entirely (zero-at-rest)
            if (source) {
              const ctx = args[0] as ActorContext | undefined;
              const meta = { changedAt: now().toISOString(), changedBy: ctx?.sub ?? ctx?.email ?? null, txnId: uuid() };
              const cadence = resolveCadence(resolveHistoryRetention(scope), scope);
              // Fire-and-forget: a capture fault is logged and swallowed, never propagated to the write.
              void recordWrite(source, captured.entity, captured.id, {}, captured.next, meta, cadence).catch((err) =>
                logger.warn({ err, method }, "retention capture failed"),
              );
            }
          }
        } catch (err) {
          // Classification itself must never break a write either.
          logger.warn({ err, method }, "retention capture classify failed");
        }
        return result;
      };
    },
  }) as T;
}
