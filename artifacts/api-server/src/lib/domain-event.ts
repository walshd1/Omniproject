import type { Request } from "express";
import { contextFromReq } from "../broker";
import { envBool } from "./env-config";
import { logger } from "./logger";
import type { RuleVerb } from "@workspace/backend-catalogue";

/**
 * Domain events — the "ON" of the rules engine. Every noun write (Lane-1 `mountEntity`) and every opted-in
 * verb (Lane-2 `mountCommand`) emits a typed {@link DomainEvent} AFTER it commits, so a rule can fire on a
 * real change instead of only a manual test-run.
 *
 * Delivery is deliberately IN-PROCESS and OUT-OF-BAND:
 *   - **In-process, not cross-replica.** A rule must run ONCE, on the replica that handled the write. Fanning
 *     the event out over Redis (as the notification bus does) would run the rule on every replica ⇒ N-times
 *     execution. Notifications a rule *produces* still fan out via the notify bus; the trigger event does not.
 *   - **Out-of-band + best-effort.** Emit schedules dispatch on the next tick and swallows every error, so a
 *     dispatcher fault can never fail (or slow) the originating write — which has already committed + audited.
 *
 * The whole subsystem is OFF by default ({@link domainEventsEnabled}); with the flag unset nothing is built,
 * subscribed, or emitted, and the write path computes no extra work.
 */

/** The verb a Lane-1 entity op maps to (present tense in the pipeline → past-tense event verb). */
const VERB_OF: Record<string, RuleVerb> = { create: "created", update: "updated", delete: "deleted" };

export interface DomainEvent {
  id: string;
  /** The noun that changed — matches a {@link RuleSurface} key and the `<surface>.<verb>` trigger prefix. */
  surface: string;
  verb: RuleVerb;
  /** `<surface>.<verb>` — compared directly against a trigger's `kind`. */
  triggerKind: string;
  /** The written entity (best-effort — the run's result, else the validated body + route params). */
  subject: Record<string, unknown>;
  scope: { projectId?: string; programmeId?: string };
  actor: { sub?: string; role?: string; actorKind: "human" | "automation" | "agent" };
  /** Cascade guard (populated for rule-driven writes in the chaining phase; depth 0 for a direct write). */
  causation: { depth: number; rootEventId: string; rulePath: string[] };
  at: number;
}

/** Is the rules-engine event subsystem enabled? Off by default — a single flag gates emit + dispatch. */
export function domainEventsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool("RULES_ENGINE_EVENTS", env);
}

type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;
const handlers = new Set<DomainEventHandler>();

/** Register a domain-event handler (the dispatcher). Returns an unsubscribe fn. */
export function onDomainEvent(handler: DomainEventHandler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/** Test seam: current subscriber count. */
export function domainEventHandlerCount(): number {
  return handlers.size;
}

let seq = 0;
function nextEventId(now: number): string {
  seq = (seq + 1) % Number.MAX_SAFE_INTEGER;
  return `evt-${now}-${seq}`;
}

/**
 * Emit a domain event out-of-band: schedule delivery on the next tick and swallow every error, so neither a
 * slow nor a throwing handler can affect the request that produced the event. No-op when there are no
 * handlers. Not gated here — callers gate on {@link domainEventsEnabled} so they skip building the event too.
 */
export function emitDomainEvent(event: DomainEvent): void {
  if (handlers.size === 0) return;
  setImmediate(() => {
    for (const handler of handlers) {
      try {
        void Promise.resolve(handler(event)).catch((err) => logger.warn({ err, evt: event.id }, "domain-event handler failed"));
      } catch (err) {
        logger.warn({ err, evt: event.id }, "domain-event handler threw");
      }
    }
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Build a {@link DomainEvent} from a request + the change. The actor is derived from the request (so an
 * autonomous/agent-driven write is stamped as such), causation starts at depth 0 (a direct write is its own
 * cascade root), and the subject is the best available view of what changed.
 */
export function buildDomainEvent(req: Request, surface: string, verb: RuleVerb, subject: Record<string, unknown>, scope: { projectId?: string; programmeId?: string }): DomainEvent {
  const ctx = contextFromReq(req);
  const now = Date.now();
  const id = nextEventId(now);
  const actor: DomainEvent["actor"] = { actorKind: ctx.actorKind ?? "human" };
  if (ctx.sub) actor.sub = ctx.sub;
  if (ctx.role) actor.role = ctx.role;
  return {
    id,
    surface,
    verb,
    triggerKind: `${surface}.${verb}`,
    subject,
    scope,
    actor,
    causation: { depth: 0, rootEventId: id, rulePath: [] },
    at: now,
  };
}

/**
 * Emit for a Lane-1 entity write (`mountEntity`). Maps the pipeline verb (create/update/delete) to the event
 * verb and assembles the subject from the written result merged with the validated body + route params (so a
 * delete, which often returns no body, still carries the id). Gated by the caller on {@link domainEventsEnabled}.
 */
export function emitEntityWrite(req: Request, entity: string, op: string, projectId: string | null, parts: { body?: unknown; result?: unknown }): void {
  const verb = VERB_OF[op];
  if (!verb) return; // an op with no event mapping doesn't emit
  const subject: Record<string, unknown> = {
    ...(isObj(req.params) ? req.params : {}),
    ...(isObj(parts.body) ? parts.body : {}),
    ...(isObj(parts.result) ? parts.result : {}),
    ...(projectId ? { projectId } : {}),
  };
  emitDomainEvent(buildDomainEvent(req, entity, verb, subject, projectId ? { projectId } : {}));
}
