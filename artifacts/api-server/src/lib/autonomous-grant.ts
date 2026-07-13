import type { ActorContext } from "../broker/types";
import { isAutonomous, assertMintFresh, assertAutonomousCan, AutonomousForbidden } from "./autonomous";
import { aiContainmentLevel, type AiContainment } from "./ai-containment";
import { aiKillEngaged } from "./ai-kill";
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
  projects?: string[] | undefined;
  /** Allowed surfaces/screens, or ["*"]. Omitted ⇒ unrestricted by surface. */
  surfaces?: string[] | undefined;
  /** Allowed fields to write, or ["*"]. Omitted ⇒ unrestricted by field. */
  fields?: string[] | undefined;
  /** Grant expiry (epoch ms). Omitted ⇒ no extra time bound beyond the session TTL. */
  notAfter?: number | undefined;
  /** Per-process cap on writes under this grant (a runaway/looping guard). */
  maxWrites?: number | undefined;
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

/**
 * Validate + normalise an untrusted grant to a clean AutonomousWriteGrant, or null if unusable.
 * Applied on EVERY bulk load (admin config JSON, sealed-file restore, cross-replica fleet converge) so
 * a malformed or hostile grant can never widen autonomous write authorization — a grant is an
 * elevation, so its shape is checked whenever it moves, not trusted for having come from "our" store.
 */
export function cleanGrant(raw: unknown): AutonomousWriteGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const actorId = typeof g["actorId"] === "string" ? g["actorId"].trim() : "";
  if (!actorId) return null; // no actor ⇒ the grant can never match a principal; drop it
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : undefined;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: AutonomousWriteGrant = { actorId, actions: strArr(g["actions"]) ?? [] };
  const projects = strArr(g["projects"]); if (projects) out.projects = projects;
  const surfaces = strArr(g["surfaces"]); if (surfaces) out.surfaces = surfaces;
  const fields = strArr(g["fields"]); if (fields) out.fields = fields;
  const notAfter = num(g["notAfter"]); if (notAfter !== undefined) out.notAfter = notAfter;
  const maxWrites = num(g["maxWrites"]); if (maxWrites !== undefined) out.maxWrites = maxWrites;
  if (g["allowBroad"] === true) out.allowBroad = true; // only the literal true opts into broad scope
  return out;
}

/** Replace the whole grant set (admin config JSON / restore / fleet converge). Every grant is
 *  validated (see cleanGrant); malformed entries are dropped rather than trusted. */
export function setAutonomousGrants(grants: readonly unknown[]): void {
  GRANTS.clear();
  for (const g of grants) { const clean = cleanGrant(g); if (clean) GRANTS.set(clean.actorId, clean); }
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

/**
 * The pure decision: would this autonomous write be allowed? Returns the first failing
 * reason, or null when allowed. NO side effects — no logging, no rate-counter increment —
 * so it backs both the throwing authorize path AND a dry-run preview.
 * Order: kill switch → fresh keyed session → RBAC → grant exists → containment → scope →
 * time → rate cap.
 */
function checkWrite(ctx: ActorContext, req: WriteRequest): string | null {
  if (aiKillEngaged()) return "AI kill switch engaged";
  try { assertMintFresh(ctx, req.now); } catch { return "stale or unverified autonomous session"; }
  try { assertAutonomousCan(ctx, "contributor"); }
  catch (e) { if (e instanceof AutonomousForbidden) return "actor role below contributor"; throw e; }

  const id = actorIdOf(ctx);
  const grant = id ? getAutonomousGrant(id) : undefined;
  if (!id || !grant) return "no write grant for this actor";

  try { assertGrantContainment(grant, aiContainmentLevel(req.surface ?? undefined)); }
  catch (e) { return e instanceof AutonomousWriteDenied ? e.message : "grant too broad for AI exposure"; }

  if (!grant.actions.includes(req.action)) return `action "${req.action}" not in grant`;
  if (typeof grant.notAfter === "number" && req.now > grant.notAfter) return "grant has expired";
  if (req.projectId && grant.projects && !grant.projects.includes("*") && !grant.projects.includes(req.projectId)) return `project "${req.projectId}" out of scope`;
  if (req.surface && grant.surfaces && !grant.surfaces.includes("*") && !grant.surfaces.includes(req.surface)) return `surface "${req.surface}" out of scope`;
  if (req.fields?.length && grant.fields && !grant.fields.includes("*")) {
    const bad = req.fields.find((f) => !grant.fields!.includes(f));
    if (bad) return `field "${bad}" not writable under grant`;
  }
  if (typeof grant.maxWrites === "number" && (writeCounts.get(id) ?? 0) >= grant.maxWrites) return "write cap reached";
  return null;
}

/**
 * DRY-RUN: would this autonomous write be permitted, and why or why not? No side effects
 * (no audit entry, no rate consumed) — for previewing what an actor COULD do before it
 * acts. Non-autonomous contexts are always "allowed" (not this gate's concern).
 */
export function previewAutonomousWrite(ctx: ActorContext, req: WriteRequest): { allowed: boolean; reason?: string } {
  if (!isAutonomous(ctx)) return { allowed: true };
  const reason = checkWrite(ctx, req);
  return reason ? { allowed: false, reason } : { allowed: true };
}

/**
 * Authorise an autonomous write, or throw. Runs the same checks as the preview, then —
 * on pass — consumes a rate slot and writes the mandatory allow-log; on fail, logs the
 * denial (fail-closed) and throws. Non-autonomous contexts pass through.
 */
export function authorizeAutonomousWrite(ctx: ActorContext, req: WriteRequest): void {
  if (!isAutonomous(ctx)) return; // humans use the normal RBAC route, not this gate

  const reason = checkWrite(ctx, req);
  if (reason) {
    logDecision(ctx, req, "denied", reason); // fail-closed: a logging throw also denies
    throw new AutonomousWriteDenied(`autonomous write denied (${reason})`);
  }

  // Passed every check → consume the rate slot, then the mandatory allow-log.
  const id = actorIdOf(ctx)!;
  const grant = getAutonomousGrant(id)!;
  if (typeof grant.maxWrites === "number") writeCounts.set(id, (writeCounts.get(id) ?? 0) + 1);
  logDecision(ctx, req, "allowed");
}
