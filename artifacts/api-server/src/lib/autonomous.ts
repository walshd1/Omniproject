import { randomBytes } from "node:crypto";
import type { ActorContext, ActorKind } from "../broker/types";
import { type Role, ROLES, grantsForRole, grantsSatisfy } from "./rbac";

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
  onBehalfOf?: string | undefined;
  /** Why it is acting (carried into the principal label for audit/provenance). */
  reason?: string | undefined;
}

/**
 * Autonomous sessions are deliberately SHORT-LIVED. Re-keying an autonomous actor is
 * free (mint a fresh sessionBind), so there's no reason to let one live long: a tight
 * window shrinks the value of a leaked key to near-zero. Default 30s; configurable via
 * AUTONOMOUS_SESSION_SECONDS but hard-clamped to [5s, 5min] so it can never be made
 * long-lived. Consumers should re-mint per action rather than reuse a context.
 */
const DEFAULT_TTL_MS = 30_000;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 300_000;

export function autonomousTtlMs(): number {
  const secs = Number(process.env["AUTONOMOUS_SESSION_SECONDS"]?.trim());
  if (!Number.isFinite(secs) || secs <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, secs * 1000));
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
 * The ALLOWLIST of known autonomous actors and the MAX role each may run as. The
 * minter refuses any id that isn't here, and refuses a role above the registered cap —
 * so this powerful "create a valid keyed session" capability can only ever produce a
 * principal an admin has pre-declared, never an arbitrary/escalated one. Built-ins are
 * least-privilege; an operator extends this via config (registerAutonomousActor).
 */
const REGISTRY = new Map<string, Role>([
  ["health-watch", "contributor"], // raises notifications / applies guarded changes
  ["nl-action", "contributor"], //    executes a natural-language command for a user
  ["portfolio-copilot", "viewer"], // read-only Q&A over the read model
  ["reconciler", "viewer"], //        cross-backend entity resolution (read-only)
]);

/** Register (or raise/lower) the max role an autonomous actor id may run as (admin/config). */
export function registerAutonomousActor(id: string, maxRole: Role): void {
  REGISTRY.set(id, maxRole);
}

/** The max role a known actor may run as, or undefined if it isn't an allowed source. */
export function authorizedRole(id: string): Role | undefined {
  return REGISTRY.get(id);
}

/** Thrown when the minter is asked to create a principal that isn't allowed. */
export class AutonomousMintDenied extends Error {
  constructor(message: string) { super(message); this.name = "AutonomousMintDenied"; }
}

/**
 * Mint a KEYED, RBAC-roled ActorContext for an autonomous actor.
 *
 * This is a PRIVILEGED capability — it fabricates a session that passes the per-session
 * broker key derivation and provenance binding, exactly like a human login — so it is
 * deliberately constrained:
 *
 *  - KNOWN SOURCE ONLY: `spec.id` must be in the allowlist (REGISTRY); an unknown id is
 *    refused. The requested role may not exceed the registered cap for that id.
 *  - TIME-BOUND: the caller MUST pass `now` (the invocation time, from a trusted clock).
 *    It is stamped as `issuedAt` and the result is checked to match — so a mint is
 *    provably "as of" that instant and a stale/replayed context is detectable
 *    (see `assertMintFresh`). `now` must be a sane epoch-ms value.
 *
 * The fresh `sessionBind` makes the actor's broker/vendor calls keyed and its provenance
 * entries session-bound. Pure apart from these checks; throws AutonomousMintDenied on a
 * disallowed request.
 */
export function mintAutonomousContext(spec: AutonomousSpec, now: number): ActorContext {
  if (!Number.isFinite(now) || now <= 0) throw new AutonomousMintDenied("mint requires a valid invocation timestamp");
  const max = authorizedRole(spec.id);
  if (!max) throw new AutonomousMintDenied(`unknown autonomous actor "${spec.id}" — not an allowed source`);
  if (!ROLES.includes(spec.role)) throw new AutonomousMintDenied(`invalid role "${spec.role}"`);
  if (!grantsSatisfy(grantsForRole(max), spec.role)) {
    throw new AutonomousMintDenied(`autonomous actor "${spec.id}" may run as at most ${max}, not ${spec.role}`);
  }

  const sub = autonomousSub(spec);
  const ctx: ActorContext = {
    sub,
    role: spec.role,
    name: spec.reason ? `${spec.id} (${spec.reason})` : spec.id,
    actorKind: actorKindOf(spec),
    issuedAt: now,
    // Short-lived by design — the session expires quickly; re-mint to re-key (free).
    expiresAt: now + autonomousTtlMs(),
    sessionBind: { sub, smono: process.hrtime.bigint().toString(), salt: randomBytes(16).toString("hex") },
  };
  // The result must reflect the time it was minted for — a self-check that the stamp
  // wasn't lost/altered during construction (the minter's own integrity guard).
  if (ctx.issuedAt !== now) throw new AutonomousMintDenied("mint timestamp mismatch");
  return ctx;
}

/**
 * Confirm a minted context is FRESH for this run: stamped, not in the future, not past
 * its short expiry, and within the (short) TTL of `now`. A consumer of an autonomous
 * context calls this so a cached or replayed principal can't be reused beyond its tiny
 * window — re-mint instead (re-keying is free). `maxAgeMs` defaults to the configured
 * autonomous TTL; an explicit `expiresAt` on the context is also enforced.
 */
export function assertMintFresh(ctx: Pick<ActorContext, "issuedAt" | "expiresAt">, now: number, maxAgeMs = autonomousTtlMs()): void {
  if (typeof ctx.issuedAt !== "number") throw new AutonomousMintDenied("context carries no mint timestamp");
  if (ctx.issuedAt > now) throw new AutonomousMintDenied("mint timestamp is in the future");
  if (typeof ctx.expiresAt === "number" && now > ctx.expiresAt) throw new AutonomousMintDenied("minted context has expired");
  if (now - ctx.issuedAt > maxAgeMs) throw new AutonomousMintDenied("minted context is stale");
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
