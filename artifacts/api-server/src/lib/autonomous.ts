import { randomBytes } from "node:crypto";
import type { ActorContext, ActorKind } from "../broker/types";
import { type Role, grantsForRole, grantsSatisfy } from "./rbac";

/**
 * Autonomous principals.
 *
 * Anything that acts WITHOUT a live human request — a scheduled job, a health-watch
 * rule firing a change, an AI agent executing an action on a user's behalf — is a
 * first-class principal, NOT an anonymous system call. It gets exactly the same
 * machinery a human session gets:
 *
 *  - a namespaced identity (`automation:<id>` or `agent:<id>:<onBehalfOf>`), so its
 *    actions are attributable and greppable in audit + provenance;
 *  - a per-session KEY: a fresh `sessionBind` (monotonic start + CSPRNG salt) so its
 *    broker/vendor calls are signed with a derived per-session key (lib/session-key)
 *    and its provenance entries carry a `sessionMac` — keyed and bound like a human;
 *  - an RBAC ROLE it runs AS, enforced by `assertAutonomousCan`. Least privilege:
 *    callers must grant a role explicitly; an under-privileged actor is refused.
 *
 * So an autonomous actor can never reach a vendor/broker unkeyed, nor exceed the role
 * it was granted — the same guarantees a human user is held to.
 */
export interface AutonomousSpec {
  /** Stable id of the automation/agent (e.g. "health-watch", "nl-action"). */
  id: string;
  /** The RBAC role the actor runs AS. Least privilege — grant the minimum needed. */
  role: Role;
  /** When acting FOR a human (an agent), their sub — recorded in the principal id so
   *  the action is traceable to the person who delegated it. */
  onBehalfOf?: string;
  /** Why it is acting (carried into the principal label for audit/provenance). */
  reason?: string;
}

/** The namespaced, clearly-non-human principal id for an autonomous actor. */
export function autonomousSub(spec: Pick<AutonomousSpec, "id" | "onBehalfOf">): string {
  return spec.onBehalfOf ? `agent:${spec.id}:${spec.onBehalfOf}` : `automation:${spec.id}`;
}

/** The kind of principal a spec describes. */
export function actorKindOf(spec: Pick<AutonomousSpec, "onBehalfOf">): ActorKind {
  return spec.onBehalfOf ? "agent" : "automation";
}

/**
 * Mint a KEYED, RBAC-roled ActorContext for an autonomous actor. The fresh
 * `sessionBind` makes its broker/vendor calls keyed (per-session derived key) and its
 * provenance entries session-bound — identical to a human login. Pure: no side effects,
 * so callers record audit/provenance through the normal broker path.
 */
export function mintAutonomousContext(spec: AutonomousSpec): ActorContext {
  const sub = autonomousSub(spec);
  return {
    sub,
    role: spec.role,
    name: spec.reason ? `${spec.id} (${spec.reason})` : spec.id,
    actorKind: actorKindOf(spec),
    sessionBind: { sub, smono: process.hrtime.bigint().toString(), salt: randomBytes(16).toString("hex") },
  };
}

/** Thrown when an autonomous actor attempts an action above the role it was granted. */
export class AutonomousForbidden extends Error {
  constructor(public actor: string, public need: Role, public have: Role) {
    super(`autonomous actor "${actor}" (role ${have}) is not permitted: requires ${need}`);
    this.name = "AutonomousForbidden";
  }
}

/** Is this context an autonomous (non-human) principal? */
export function isAutonomous(ctx: Pick<ActorContext, "actorKind">): boolean {
  return ctx.actorKind === "automation" || ctx.actorKind === "agent";
}

/**
 * Enforce RBAC for an autonomous actor before it performs `need`-gated work. Same gate
 * semantics as the HTTP `requireRole` middleware, but for a principal with no request.
 * Throws AutonomousForbidden when under-privileged.
 */
export function assertAutonomousCan(ctx: ActorContext, need: Role): void {
  const have = (ctx.role as Role) ?? "viewer";
  if (!grantsSatisfy(grantsForRole(have), need)) {
    throw new AutonomousForbidden(ctx.sub ?? "unknown", need, have);
  }
}
