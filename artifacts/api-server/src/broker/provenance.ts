import { randomUUID } from "node:crypto";
import { record } from "../lib/provenance";
import type { SessionBind } from "../lib/session-key";
import type { Broker } from "./types";

/**
 * Provenance decorator for the broker seam. Wraps the broker in a Proxy that, for every
 * call, records a chained fingerprint of the INVOKE (actor + action + request args) and
 * the RESULT (or error) — content stays in transit, only MACs persist (see
 * lib/provenance). Being a Proxy it needs no per-method wiring and covers methods added
 * later. Purely additive: it never alters arguments or results.
 *
 * On by default; set PROVENANCE_DISABLED to turn it off (e.g. for a hot read path).
 */
export function provenanceEnabled(): boolean {
  return !/^(1|true|on|yes)$/i.test(process.env["PROVENANCE_DISABLED"]?.trim() ?? "");
}

function actorOf(args: unknown[]): string | null {
  const ctx = args[0];
  if (ctx && typeof ctx === "object") {
    const c = ctx as { sub?: string; email?: string };
    return c.sub ?? c.email ?? null;
  }
  return null;
}

/** The per-session binding off the ctx arg, so the chain commits to the session identity
 *  (null for system/unauthenticated calls). */
function sessionBindOf(args: unknown[]): SessionBind | null {
  const ctx = args[0];
  if (ctx && typeof ctx === "object") return (ctx as { sessionBind?: SessionBind }).sessionBind ?? null;
  return null;
}

/** Wrap a broker so every call records a chained invoke/result fingerprint (additive). */
export function wrapWithProvenance<T extends Broker>(broker: T): T {
  return new Proxy(broker, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const action = String(prop);
      return (...args: unknown[]) => {
        const callId = randomUUID();
        const actor = actorOf(args);
        const sessionBind = sessionBindOf(args);
        // Fingerprint the request (skip the ctx arg — it carries the auth token).
        record({ callId, hop: "invoke", action, actor, sessionBind, content: args.slice(1) });
        try {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (out instanceof Promise) {
            return out.then(
              (res) => { record({ callId, hop: "result", action, actor, sessionBind, content: res }); return res; },
              (err) => { record({ callId, hop: "error", action, actor, sessionBind, content: { error: err instanceof Error ? err.message : String(err) } }); throw err; },
            );
          }
          record({ callId, hop: "result", action, actor, sessionBind, content: out });
          return out;
        } catch (err) {
          record({ callId, hop: "error", action, actor, sessionBind, content: { error: err instanceof Error ? err.message : String(err) } });
          throw err;
        }
      };
    },
  });
}
