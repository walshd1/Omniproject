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

/** Build the write-authorization request from a broker write method + its args. Unknown/absent fields
 *  are simply omitted — the grant check treats an absent scope element as unconstrained-by-that-element. */
function writeRequestFor(method: string, args: unknown[], now: number): WriteRequest | null {
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  switch (method) {
    case "writeIssue": {
      const op = str(args[1]) ?? "update";
      const input = rec(args[2]);
      const fields = Object.keys(input).filter((k) => k !== "projectId" && k !== "issueId");
      return { action: `${op}_issue`, projectId: str(input["projectId"]), fields, now };
    }
    case "createProject": return { action: "create_project", projectId: str(rec(args[1])["id"]), fields: Object.keys(rec(args[1])), now };
    case "updateProject": return { action: "update_project", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now };
    case "createTaskItem": return { action: "create_task_item", projectId: str(args[1]), now };
    case "addRaid": return { action: "add_raid", projectId: str(args[1]), fields: Object.keys(rec(args[2])), now };
    case "createTask": return { action: "create_task", projectId: str(rec(args[1])["projectId"]), now };
    case "updateTask": return { action: "update_task", projectId: str(rec(args[2])["projectId"]), now };
    case "addTaskComment": return { action: "add_task_comment", now };
    case "addTaskAttachment": return { action: "add_task_attachment", now };
    default: return null;
  }
}

const GUARDED_WRITES = new Set([
  "writeIssue", "createProject", "updateProject", "createTaskItem", "addRaid",
  "createTask", "updateTask", "addTaskComment", "addTaskAttachment",
]);

/** Wrap a broker so every write is first passed through the autonomous-write gate. */
export function wrapWithAutonomousGuard(base: Broker, opts: { now?: () => number } = {}): Broker {
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
      return async function (this: unknown, ...args: unknown[]) {
        const req = writeRequestFor(method, args, now());
        // Throws AutonomousWriteDenied (fail-closed) for an out-of-grant autonomous write; a no-op for
        // humans. Runs BEFORE the write reaches the broker, so a denied write never touches the backend.
        if (req) authorizeAutonomousWrite(args[0] as ActorContext, req);
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Broker;
}
