import type { ActorContext } from "../broker/types";
import { isAutonomous, assertMintFresh, assertAutonomousCan, AutonomousForbidden } from "./autonomous";
import { aiContainmentLevel, type AiContainment } from "./ai-containment";
import { recordAudit } from "./audit";

/**
 * Autonomous WRITE authorisation — the hard limit that stops an autonomous session being
 * a backdoor.
 *
 * A keyed autonomous actor MAY write, but only inside a tightly-scoped, admin-declared
 * GRANT. The model is DEFAULT-DENY and the grant pins exactly:
 *   - WHAT:  which write actions (and, optionally, which fields) it may perform;
 *   - WHERE: which projects (and surfaces) it may touch;
 *   - HOW LONG: a validity window (`notAfter`) on top of the actor's already-short
 *     session — so even a leaked grant ages out.
 * plus a per-process write CAP. Every decision — allow OR deny — is logged (mandatory,
 * fail-closed: if the audit sink throws, the write is denied), so an autonomous write is
 * never invisible. No grant ⇒ no writes; a stale/expired session ⇒ no writes; out of
 * scope ⇒ no writes. That is the "no backdoor" guarantee.
 *
 * Grants live in the in-memory registry, seeded from admin config (default EMPTY). They
 * are NOT a human-bypass: humans write through the normal RBAC route; this gate is only
 * consulted for `actorKind` automation/agent.
 */
export interface AutonomousWriteGrant {
  /** The actor id this grant applies to (the registry id, e.g. "health-watch"). */
  actorId: string;
  /** Allowed write actions (e.g. ["update_issue"]). Empty ⇒ no writes. */
  actions: string[];
  /** Allowed project ids, or ["*"] for any. Omitted ⇒ none allowed (must be explicit). */
  projects?: string[];
  /** Allowed surfaces/screens, or ["*"]. Omitted ⇒ unrestricted by surface. */
  surfaces?: string[];
  /** Allowed fields to write, or ["*"]. Omitted ⇒ unrestricted by field. */
  fields?: string[];
  /** Grant expiry (epoch ms). Omitted ⇒ no extra time bound beyond the session TTL. */
  notAfter?: number;
  /** Per-process cap on writes under this grant (a runaway/looping guard). */
  maxWrites?: number;
  /** Explicit opt-in to a BROAD (wildcard/unspecified) scope. Honoured only when AI is
   *  local — remote/public AI hard-reject broad grants regardless. Forces an admin to
   *  state intent; the default posture everywhere is many narrow grants, not one broad one. */
  allowBroad?: boolean;
}

const GRANTS = new Map<string, AutonomousWriteGrant>();
const writeCounts = new Map<string, number>();

/** Seed/replace an autonomous write grant (admin/config). */
export function registerAutonomousGrant(grant: AutonomousWriteGrant): void {
  GRANTS.set(grant.actorId, grant);
}

/** The grant for an actor id, or undefined (⇒ default deny). */
export function getAutonomousGrant(actorId: string): AutonomousWriteGrant | undefined {
  return GRANTS.get(actorId);
}

/** Every active write grant (for the admin dashboard). No secrets — pure scope data. */
export function listAutonomousGrants(): AutonomousWriteGrant[] {
  return [...GRANTS.values()];
}

/** Replace the whole grant set (admin applies the config JSON). */
export function setAutonomousGrants(grants: AutonomousWriteGrant[]): void {
  GRANTS.clear();
  for (const g of grants) GRANTS.set(g.actorId, g);
}

/** Test-only: clear grants + counters. */
export function __resetAutonomousGrants(): void {
  GRANTS.clear();
  writeCounts.clear();
}

/** The registry id behind an autonomous principal's sub (automation:<id> / agent:<id>:<who>). */
export function actorIdOf(ctx: Pick<ActorContext, "sub">): string | null {
  const sub = ctx.sub ?? "";
  const m = /^(?:automation|agent):([^:]+)/.exec(sub);
  return m ? m[1]! : null;
}

/** Thrown when an autonomous write falls outside its grant (or there is no grant). */
export class AutonomousWriteDenied extends Error {
  constructor(message: string) { super(message); this.name = "AutonomousWriteDenied"; }
}

/** A scope is BROAD when it is a wildcard or simply unspecified (⇒ unrestricted). */
function isBroadScope(list?: string[]): boolean {
  return !list || list.length === 0 || list.includes("*");
}

/**
 * Containment check, scaled to AI exposure. The more exposed the AI, the tighter the
 * grant must be:
 *  - public / remote: NO broad scopes anywhere (projects, surfaces AND fields must be
 *    explicitly enumerated), and a time bound (notAfter) + write cap (maxWrites) are
 *    MANDATORY. Maximum constraint — many narrow grants, never one broad one.
 *  - local: a broad scope is allowed ONLY with an explicit `allowBroad` opt-in (granular
 *    is still the default even on local).
 *  - off: AI can't drive an actor, so no extra constraint.
 * Pure + testable; throws AutonomousWriteDenied on a too-broad grant for the level.
 */
export function assertGrantContainment(grant: AutonomousWriteGrant, level: AiContainment): void {
  if (level === "public" || level === "remote") {
    const broad: string[] = [];
    if (isBroadScope(grant.projects)) broad.push("projects");
    if (isBroadScope(grant.surfaces)) broad.push("surfaces");
    if (isBroadScope(grant.fields)) broad.push("fields");
    if (broad.length) throw new AutonomousWriteDenied(`AI is ${level}: ${broad.join("/")} must be explicitly enumerated (no wildcard)`);
    if (typeof grant.notAfter !== "number") throw new AutonomousWriteDenied(`AI is ${level}: a time bound (notAfter) is mandatory`);
    if (typeof grant.maxWrites !== "number") throw new AutonomousWriteDenied(`AI is ${level}: a write cap (maxWrites) is mandatory`);
    return;
  }
  if (level === "local") {
    const broad = isBroadScope(grant.projects) || isBroadScope(grant.surfaces) || isBroadScope(grant.fields);
    if (broad && !grant.allowBroad) throw new AutonomousWriteDenied("broad scope requires an explicit allowBroad opt-in (granular preferred even on local)");
  }
}

export interface WriteRequest {
  action: string;
  projectId?: string | null;
  surface?: string | null;
  fields?: string[];
  now: number;
}

/** Mandatory, fail-closed audit of every autonomous write decision. */
function logDecision(ctx: ActorContext, req: WriteRequest, outcome: "allowed" | "denied", reason?: string): void {
  recordAudit({
    ts: new Date().toISOString(),
    category: "autonomous",
    action: `autonomous.write:${req.action}`,
    actor: { sub: ctx.sub, email: ctx.email, role: ctx.role },
    projectId: req.projectId ?? null,
    write: true,
    result: outcome === "allowed" ? "success" : "error",
    meta: { outcome, surface: req.surface ?? null, fields: req.fields ?? null, ...(reason ? { reason } : {}) },
  });
}

function deny(ctx: ActorContext, req: WriteRequest, reason: string): never {
  // Log the denial first (fail-closed: a logging failure also denies, by throwing here).
  logDecision(ctx, req, "denied", reason);
  throw new AutonomousWriteDenied(`autonomous write denied (${reason})`);
}

/**
 * Authorise an autonomous write, or throw. Order: fresh keyed session → RBAC role →
 * grant exists → action/where/field/time scope → rate cap → mandatory allow-log.
 * Non-autonomous contexts are not this gate's concern (returns immediately).
 */
export function authorizeAutonomousWrite(ctx: ActorContext, req: WriteRequest): void {
  if (!isAutonomous(ctx)) return; // humans use the normal RBAC route, not this gate

  // 1) The session must be a fresh, non-expired keyed mint — a stale/replayed autonomous
  //    session can never be used to write (closes the "old token = backdoor" hole).
  try { assertMintFresh(ctx, req.now); }
  catch { deny(ctx, req, "stale or unverified autonomous session"); }

  // 2) RBAC: a write needs at least contributor, capped to the actor's granted role.
  try { assertAutonomousCan(ctx, "contributor"); }
  catch (e) { if (e instanceof AutonomousForbidden) deny(ctx, req, "actor role below contributor"); throw e; }

  // 3) Default deny: an actor with no grant cannot write at all.
  const id = actorIdOf(ctx);
  const grant = id ? getAutonomousGrant(id) : undefined;
  if (!id || !grant) deny(ctx, req, "no write grant for this actor");

  // 3b) Containment scales with AI exposure: a remote/public AI hard-rejects any broad
  //     grant and demands a time bound + write cap; local needs an explicit broad opt-in.
  try { assertGrantContainment(grant!, aiContainmentLevel(req.surface ?? undefined)); }
  catch (e) { deny(ctx, req, e instanceof AutonomousWriteDenied ? e.message : "grant too broad for AI exposure"); }

  // 4) WHAT — action must be explicitly allowed.
  if (!grant!.actions.includes(req.action)) deny(ctx, req, `action "${req.action}" not in grant`);

  // 5) HOW LONG — grant validity window (on top of the short session TTL).
  if (typeof grant!.notAfter === "number" && req.now > grant!.notAfter) deny(ctx, req, "grant has expired");

  // 6) WHERE — project + surface scope.
  if (req.projectId && grant!.projects && !grant!.projects.includes("*") && !grant!.projects.includes(req.projectId)) {
    deny(ctx, req, `project "${req.projectId}" out of scope`);
  }
  if (req.surface && grant!.surfaces && !grant!.surfaces.includes("*") && !grant!.surfaces.includes(req.surface)) {
    deny(ctx, req, `surface "${req.surface}" out of scope`);
  }

  // 7) WHAT (fine) — field scope.
  if (req.fields?.length && grant!.fields && !grant!.fields.includes("*")) {
    const bad = req.fields.find((f) => !grant!.fields!.includes(f));
    if (bad) deny(ctx, req, `field "${bad}" not writable under grant`);
  }

  // 8) Rate cap — a runaway/looping autonomous actor can't flood writes.
  if (typeof grant!.maxWrites === "number") {
    const used = writeCounts.get(id!) ?? 0;
    if (used >= grant!.maxWrites) deny(ctx, req, "write cap reached");
    writeCounts.set(id!, used + 1);
  }

  // 9) Mandatory allow-log (fail-closed: a logging throw propagates and the write aborts).
  logDecision(ctx, req, "allowed");
}
