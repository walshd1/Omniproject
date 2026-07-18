import type { ActorContext, Broker } from "./types";
import { authorizeAutonomousWrite, type WriteRequest } from "../lib/autonomous-grant";

/**
 * ALWAYS-ON autonomous-write guard around the broker seam.
 *
 * `authorizeAutonomousWrite` is the fail-closed gate that bounds a KEYED autonomous actor's writes to
 * its admin-declared grant (action/project/surface/field scope + time bound + write cap + mandatory
 * audit). It was implemented and tested but never wired to a write path — so the guardrail was dormant:
 * an autonomous actor's write would have been bounded only by its coarse RBAC role. Every broker write
 * funnels through these methods, so wrapping them here enforces the gate by construction, for every
 * broker and every call site (routes AND in-process autonomous jobs), instead of per-handler.
 *
 * It is a NO-OP for human contexts (`authorizeAutonomousWrite` returns immediately when the context
 * isn't autonomous), so normal writes are unaffected; it only constrains `automation:`/`agent:` actors.
 * Placed innermost (closest to the real broker) so no wrapper can route a write around it.
 */

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** One classifier per guarded broker write method: maps its args → the WriteRequest the grant check
 *  bounds. Each does ONE job (classify ONE method) and ALWAYS returns a request — a guarded method can
 *  never yield "no request" and thereby skip the check. Unknown/absent scope fields are omitted; the
 *  grant check treats an absent scope element as unconstrained-by-that-element. */
const WRITE_CLASSIFIERS = {
  writeIssue: (args, now): WriteRequest => {
    const op = str(args[1]) ?? "update";
    const input = rec(args[2]);
    const fields = Object.keys(input).filter((k) => k !== "projectId" && k !== "issueId");
    return { action: `${op}_issue`, projectId: str(input["projectId"]), fields, now };
  },
  createProject: (args, now): WriteRequest => ({ action: "create_project", projectId: str(rec(args[1])["id"]), fields: Object.keys(rec(args[1])), now }),
  updateProject: (args, now): WriteRequest => ({ action: "update_project", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now }),
  createTaskItem: (args, now): WriteRequest => ({ action: "create_task_item", projectId: str(args[1]), now }),
  addRaid: (args, now): WriteRequest => ({ action: "add_raid", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now }),
  createTask: (args, now): WriteRequest => ({ action: "create_task", projectId: str(rec(args[1])["projectId"]), now }),
  updateTask: (args, now): WriteRequest => ({ action: "update_task", projectId: str(rec(args[2])["projectId"]), now }),
  addTaskComment: (_args, now): WriteRequest => ({ action: "add_task_comment", now }),
  addTaskAttachment: (_args, now): WriteRequest => ({ action: "add_task_attachment", now }),
  // writeWikiDoc(ctx, op, input) authors a knowledge-base document — a genuine mutation. Guard it under a
  // per-op action so an autonomous actor must be granted `${op}_wiki_doc`; the wiki isn't project-scoped,
  // so projectId is null (the grant bounds it by action/field, fail-closed for an ungranted actor).
  writeWikiDoc: (args, now): WriteRequest => {
    const op = str(args[1]) ?? "update";
    const input = rec(args[2]);
    const fields = Object.keys(input).filter((k) => k !== "id" && k !== "spaceId");
    return { action: `${op}_wiki_doc`, projectId: null, fields, now };
  },
  // writeWhiteboard(ctx, op, input) authors a visual canvas — a genuine mutation. Same shape as the wiki:
  // a per-op action grant (`${op}_whiteboard`), not project-scoped (projectId null), fail-closed.
  writeWhiteboard: (args, now): WriteRequest => {
    const op = str(args[1]) ?? "update";
    const input = rec(args[2]);
    const fields = Object.keys(input).filter((k) => k !== "id");
    return { action: `${op}_whiteboard`, projectId: null, fields, now };
  },
  // storeCredential(ctx, {backend,name,value}) delegates a vendor secret into the broker vault — a
  // genuine mutation. The secret VALUE is never put in the request (grants scope by action/project,
  // not by content); an autonomous actor with no store_credential grant is denied, fail-closed.
  storeCredential: (_args, now): WriteRequest => ({ action: "store_credential", projectId: null, now }),
  // commandWithSource(ctx, action, payload, source) is the generic n8n command edge — it can forward
  // ANY mutating action (create/update/delete_project, RAID, …). Guard it under its own action name
  // so a grant must name that action; an ungranted autonomous command is denied by construction.
  commandWithSource: (args, now): WriteRequest => ({ action: str(args[1]) ?? "command", projectId: str(rec(args[2])["projectId"]), now }),
  // nativeImport(ctx, req) brings a native artifact back THROUGH the broker as an attachment written to the
  // target project/issue (route stamps write:true) — a genuine mutation. Guard it under `native_import`,
  // project-scoped by the target, so an autonomous actor must be granted it (fail-closed if ungranted).
  nativeImport: (args, now): WriteRequest => ({ action: "native_import", projectId: str(rec(rec(args[1])["target"])["projectId"]), now }),
  // Dependency-graph writes (roadmap §5.5): writeDependency(ctx, projectId, link) /
  // removeDependency(ctx, projectId, from, to, kind) mutate the project's edge set — guard them project-scoped.
  writeDependency: (args, now): WriteRequest => ({ action: "write_dependency", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now }),
  removeDependency: (args, now): WriteRequest => ({ action: "remove_dependency", projectId: str(args[1]), now }),
  // Sprint/iteration writes (roadmap §5.5): writeSprint(ctx, projectId, sprint) upserts a sprint;
  // removeSprint(ctx, projectId, sprintId) deletes one — both mutate the project's iteration set, guard project-scoped.
  writeSprint: (args, now): WriteRequest => ({ action: "write_sprint", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now }),
  removeSprint: (args, now): WriteRequest => ({ action: "remove_sprint", projectId: str(args[1]), now }),
} satisfies Record<string, (args: unknown[], now: number) => WriteRequest>;

/** A broker method the autonomous gate must run authorization for. */
export type GuardedWriteMethod = keyof typeof WRITE_CLASSIFIERS;

/** The guarded set is DERIVED from the classifier registry, so the two can never drift: every guarded
 *  method has a classifier, and every classifier is guarded. (Exported for the parity arch-test.) */
export const GUARDED_WRITES: ReadonlySet<string> = new Set(Object.keys(WRITE_CLASSIFIERS));

/** Wrap a broker so every write is first passed through the autonomous-write gate. Generic in the
 *  broker type so it can wrap a CONCRETE adapter (e.g. ReferenceBroker) without losing its extra,
 *  non-neutral methods (`commandWithSource`) — the Proxy is transparent, so returning `T` is sound. */
export function wrapWithAutonomousGuard<T extends Broker>(base: T, opts: { now?: () => number } = {}): T {
  const now = opts.now ?? (() => Date.now());
  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      const method = String(prop);
      if (typeof orig !== "function" || !GUARDED_WRITES.has(method)) {
        return typeof orig === "function" ? (orig as (...a: unknown[]) => unknown).bind(target) : orig;
      }
      // `async` so a denial surfaces as a REJECTED promise (the broker write methods are all async),
      // never a synchronous throw an `await` caller could mishandle.
      const classify = WRITE_CLASSIFIERS[method as GuardedWriteMethod];
      return async function (this: unknown, ...args: unknown[]) {
        // FAIL-CLOSED: a method in GUARDED_WRITES ALWAYS has a classifier (the set is derived from the
        // registry), so this is unreachable by construction — but if that invariant were ever broken we
        // throw rather than let the write proceed UNGATED (the old `if (req)` silently skipped it).
        if (!classify) throw new Error(`autonomous-guard: guarded method "${method}" has no write classifier`);
        // Throws AutonomousWriteDenied (fail-closed) for an out-of-grant autonomous write; a no-op for
        // humans. Runs BEFORE the write reaches the broker, so a denied write never touches the backend.
        authorizeAutonomousWrite(args[0] as ActorContext, classify(args, now()));
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;
}
