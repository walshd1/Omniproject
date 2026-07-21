/**
 * GOAL / OKR server logic (roadmap 3.2) — the authoritative sanitiser + storage access for first-class goal
 * objects. A goal is an OBJECTIVE (title + description) with a list of measurable KEY RESULTS (target/current
 * on a unit); its progress is DERIVED from key-result attainment, never trusted from the client. Goals live
 * in the scoped, AES-256-GCM-sealed artifact store (the storage-target model — user / project / org), exactly
 * like proofs/whiteboards/wiki; ids are self-describing so a read routes to the right store, and a `user`
 * scope always uses the caller's own sub. `sanitizeGoalWrite` is the single choke point every write passes
 * through (identity, progress and version are set server-side). Later slices add check-ins, work links and a
 * cadence on top of this row without a migration.
 */
import type { ActorContext } from "../broker/types";
import { makeScopedId, parseScopedId, scopeFromParsed, type ArtifactScope, type StorageTarget } from "./artifact-store";
import { sanitizeText as cleanText } from "./coerce";
import { actorLabel } from "./actor";
import { nextOccurrence } from "./recurrence";
import { KEY_RESULT_KINDS, isBinaryKeyResultKind, type KeyResultKind } from "@workspace/backend-catalogue";

const KEY_RESULT_KIND_SET = new Set<string>(KEY_RESULT_KINDS);
const isKeyResultKind = (k: unknown): k is KeyResultKind => typeof k === "string" && KEY_RESULT_KIND_SET.has(k);

/** A rejected goal write (maps to 400). */
export class GoalError extends Error {
  constructor(message: string) { super(message); this.name = "GoalError"; }
}

/** The artifact-store type key for goals. */
export const GOAL_ARTIFACT = "goal";

/** Goals live only in the encrypted-JSON areas (no sidecar) — a subset of StorageTarget. */
export type GoalStorage = "user" | "project" | "org";
const GOAL_STORAGE_SET = new Set<GoalStorage>(["user", "project", "org"]);
const isGoalStorage = (s: unknown): s is GoalStorage => typeof s === "string" && GOAL_STORAGE_SET.has(s as GoalStorage);

/** The lifecycle status of a goal (author-set; the read layer may highlight a mismatch with progress). */
export type GoalStatus = "draft" | "on_track" | "at_risk" | "off_track" | "achieved";
const GOAL_STATUS_SET = new Set<GoalStatus>(["draft", "on_track", "at_risk", "off_track", "achieved"]);
const isGoalStatus = (s: unknown): s is GoalStatus => typeof s === "string" && GOAL_STATUS_SET.has(s as GoalStatus);

export const GOAL_LIMITS = {
  maxTitle: 200,
  maxDescription: 4000,
  maxUnit: 24,
  maxKeyResultLabel: 200,
  maxKeyResults: 20,
  maxCheckInNote: 2000,
  maxCheckIns: 100,
  maxLinks: 200,
  maxRef: 256,
  maxLinkLabel: 200,
  maxCadence: 128,
  maxGoalBytes: 64 * 1024,
} as const;

/**
 * A measurable key result — a typed primitive (the `keyResult` family in the unified store): progress from
 * `startValue` → `target`, currently at `current` (in `unit`). Its `kind` (number/percent/currency/milestone)
 * governs how attainment is computed (milestone is binary) and how the value renders.
 */
export interface KeyResult {
  id: string;
  label: string;
  kind: KeyResultKind;
  startValue: number;
  target: number;
  current: number;
  unit?: string;
}

/** A point-in-time progress check-in on a goal (the cadence history). */
export interface GoalCheckIn {
  id: string;
  at: string;
  by: string | null;
  note: string | null;
  /** The status recorded at this check-in. */
  status: GoalStatus;
  /** The goal's derived progress at this check-in (a snapshot). */
  progressPct: number;
  /** The key-result values applied by this check-in (KR id → value). */
  krValues: Record<string, number>;
}

/**
 * A link from a goal to a piece of work in a system of record. Reference-only (zero-at-rest) — like the
 * dependency overlay, we keep an addressing triple + an optional cached label, never the item's content.
 */
export interface GoalLink {
  /** Stable, URL-safe key derived from the addressing triple (so a link is idempotent + deletable by key). */
  key: string;
  system: string;
  projectRef: string;
  itemRef: string;
  label?: string;
  linkedAt: string;
}

/** A stored goal row. */
export interface Goal {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  ownerSub: string | null;
  storage: GoalStorage;
  status: GoalStatus;
  keyResults: KeyResult[];
  /** Derived (0–100), recomputed from key-result attainment on every write — never client-supplied. */
  progressPct: number;
  /** Progress check-in history (most recent last); appended by the check-in route, bounded. */
  checkins: GoalCheckIn[];
  /** Links to work items in a system of record (reference-only). */
  links: GoalLink[];
  /** Check-in cadence — a recurrence rule ("every 2 weeks", "FREQ=WEEKLY", …), or null for no cadence. */
  cadence: string | null;
  /** The next scheduled check-in date (YYYY-MM-DD), derived from the cadence; null when no cadence. */
  nextCheckInAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** The list projection of a goal (key results dropped). */
export interface GoalMeta {
  id: string;
  title: string;
  status: GoalStatus;
  progressPct: number;
  keyResultCount: number;
  checkInCount: number;
  lastCheckInAt: string | null;
  linkCount: number;
  cadence?: string | null;
  nextCheckInAt?: string | null;
  projectId?: string | null;
  ownerSub?: string | null;
  storage?: GoalStorage;
  updatedAt: string;
}

/** A sanitised goal write PLUS its chosen storage target. */
export interface SanitizedGoalWrite {
  title: string;
  description: string | null;
  status: GoalStatus;
  keyResults: KeyResult[];
  cadence: string | null;
  storage: GoalStorage;
  projectId?: string;
}

/** A finite number or a default. */
function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Attainment of ONE key result as a 0–100 percentage: how far `current` has travelled from `startValue`
 * toward `target`. Works for increasing AND decreasing targets (the ratio is sign-symmetric); when start ==
 * target it's 100 if met, else 0. Clamped to [0, 100]. Pure.
 */
export function keyResultAttainment(kr: Pick<KeyResult, "startValue" | "target" | "current"> & { kind?: KeyResultKind }): number {
  // A binary (milestone) key result is met-or-not; the proportional kinds roll `current` toward `target`.
  if (kr.kind && isBinaryKeyResultKind(kr.kind)) return kr.current >= kr.target ? 100 : 0;
  const span = kr.target - kr.startValue;
  if (span === 0) return kr.current >= kr.target ? 100 : 0;
  const ratio = (kr.current - kr.startValue) / span;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/** A goal's overall progress: the mean attainment of its key results (0 when it has none). Pure. */
export function goalProgress(keyResults: readonly KeyResult[]): number {
  if (keyResults.length === 0) return 0;
  const sum = keyResults.reduce((acc, kr) => acc + keyResultAttainment(kr), 0);
  return Math.round(sum / keyResults.length);
}

/** Sanitise one raw key result, or throw {@link GoalError}. Ids are stamped when absent so KRs stay addressable. */
export function sanitizeKeyResult(raw: unknown, index: number): KeyResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new GoalError("each key result must be an object");
  const obj = raw as Record<string, unknown>;
  const label = cleanText(obj["label"], GOAL_LIMITS.maxKeyResultLabel).trim();
  if (!label) throw new GoalError("a key result needs a label");
  const kr: KeyResult = {
    id: cleanText(obj["id"], 64) || `kr-${index + 1}`,
    label,
    kind: isKeyResultKind(obj["kind"]) ? obj["kind"] : "number",
    startValue: num(obj["startValue"], 0),
    target: num(obj["target"], 0),
    current: num(obj["current"], num(obj["startValue"], 0)),
  };
  const unit = cleanText(obj["unit"], GOAL_LIMITS.maxUnit).trim();
  if (unit) kr.unit = unit;
  return kr;
}

/** Sanitise the whole key-result list (bound the count; each KR must be valid). */
export function sanitizeKeyResults(raw: unknown): KeyResult[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new GoalError("keyResults must be an array");
  if (raw.length > GOAL_LIMITS.maxKeyResults) throw new GoalError(`a goal may have at most ${GOAL_LIMITS.maxKeyResults} key results`);
  return raw.map((kr, i) => sanitizeKeyResult(kr, i));
}

/** Sanitise a whole goal write — the single choke point for POST/PUT. Throws {@link GoalError} (→ 400). */
export function sanitizeGoalWrite(raw: unknown): SanitizedGoalWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const title = cleanText(obj["title"], GOAL_LIMITS.maxTitle).trim();
  if (!title) throw new GoalError("a goal needs a title");
  const description = cleanText(obj["description"], GOAL_LIMITS.maxDescription).trim();
  const keyResults = sanitizeKeyResults(obj["keyResults"]);
  const status: GoalStatus = isGoalStatus(obj["status"]) ? obj["status"] : "on_track";
  const cadenceRaw = cleanText(obj["cadence"], GOAL_LIMITS.maxCadence).trim();
  const cadence = cadenceRaw || null;
  const storage: GoalStorage = isGoalStorage(obj["storage"]) ? obj["storage"] : "user";
  const out: SanitizedGoalWrite = { title, description: description || null, status, keyResults, cadence, storage };
  const projectId = obj["projectId"];
  if (typeof projectId === "string" && projectId.trim()) out.projectId = projectId.trim();
  if (storage === "project" && !out.projectId) throw new GoalError("a project goal needs a projectId");
  const serialized = JSON.stringify({ title, description, keyResults });
  if (serialized.length > GOAL_LIMITS.maxGoalBytes) throw new GoalError("the goal is too large");
  return out;
}

// ── Storage-target model: self-describing ids, JSON-store rows ────────────────────────────────────────────

/** Build a self-describing goal id (shared scoped-id primitive). */
export const makeGoalId = (storage: GoalStorage, localId: string, projectId?: string): string =>
  makeScopedId(storage as StorageTarget, localId, projectId);

/** Parse a self-describing goal id, or null if malformed / not a JSON target. */
export function parseGoalId(id: string): { storage: GoalStorage; projectId?: string; localId: string } | null {
  const parsed = parseScopedId(id);
  if (!parsed || !isGoalStorage(parsed.storage)) return null;
  return parsed.projectId !== undefined
    ? { storage: parsed.storage, projectId: parsed.projectId, localId: parsed.localId }
    : { storage: parsed.storage, localId: parsed.localId };
}

/** The encrypted-JSON scope for a goal id (the caller's OWN sub is always used for a user goal). */
export const goalScope = (parsed: { storage: GoalStorage; projectId?: string }, sub: string | undefined): ArtifactScope | null =>
  scopeFromParsed(parsed as { storage: StorageTarget; projectId?: string }, sub);

/** A goal actor's label (email > name > sub) for the audit `updatedBy`. */
export { actorLabel };

/** Build the row for a NEW goal from a sanitised write (owner stamped from ctx; progress derived; version 1). */
export function newGoalRow(id: string, input: SanitizedGoalWrite, ctx: ActorContext, now: string): Goal {
  return {
    id,
    title: input.title,
    description: input.description,
    projectId: input.projectId ?? null,
    ownerSub: ctx.sub ?? null,
    storage: input.storage,
    status: input.status,
    keyResults: input.keyResults,
    progressPct: goalProgress(input.keyResults),
    checkins: [],
    links: [],
    cadence: input.cadence,
    nextCheckInAt: input.cadence ? nextOccurrence(input.cadence, now) : null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** The stable, URL-safe key for a work-item link (base64url of the addressing triple). Pure + deterministic. */
export function goalLinkKey(system: string, projectRef: string, itemRef: string): string {
  return Buffer.from(JSON.stringify([system, projectRef, itemRef])).toString("base64url");
}

/** Validate + normalise a raw work-item link (throws {@link GoalError} on a bad shape). */
export function sanitizeGoalLink(raw: unknown, now: string): GoalLink {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const system = cleanText(obj["system"], GOAL_LIMITS.maxRef).trim();
  const projectRef = cleanText(obj["projectRef"], GOAL_LIMITS.maxRef).trim();
  const itemRef = cleanText(obj["itemRef"], GOAL_LIMITS.maxRef).trim();
  if (!system || !projectRef || !itemRef) throw new GoalError("a link needs system, projectRef and itemRef");
  const link: GoalLink = { key: goalLinkKey(system, projectRef, itemRef), system, projectRef, itemRef, linkedAt: now };
  const label = cleanText(obj["label"], GOAL_LIMITS.maxLinkLabel).trim();
  if (label) link.label = label;
  return link;
}

/** Add a work-item link (idempotent by key; bounded). Bumps version. */
export function addGoalLink(existing: Goal, link: GoalLink, ctx: ActorContext, now: string): Goal {
  const links = existing.links ?? [];
  if (links.some((l) => l.key === link.key)) return existing; // idempotent — already linked
  if (links.length >= GOAL_LIMITS.maxLinks) throw new GoalError(`a goal may have at most ${GOAL_LIMITS.maxLinks} links`);
  return { ...existing, links: [...links, link], version: (existing.version ?? 1) + 1, updatedAt: now, updatedBy: actorLabel(ctx) };
}

/** Remove a work-item link by key. Bumps version only if something was removed. */
export function removeGoalLink(existing: Goal, key: string, ctx: ActorContext, now: string): Goal {
  const links = existing.links ?? [];
  const next = links.filter((l) => l.key !== key);
  if (next.length === links.length) return existing;
  return { ...existing, links: next, version: (existing.version ?? 1) + 1, updatedAt: now, updatedBy: actorLabel(ctx) };
}

/** A sanitised check-in write: an optional note + status, and the key-result values to apply. */
export interface SanitizedCheckIn {
  note: string | null;
  status?: GoalStatus;
  krValues: Record<string, number>;
}

/** Sanitise a check-in write — a capped note, an optional valid status, and numeric key-result values keyed
 *  by KR id (unknown ids are dropped when applied). Throws {@link GoalError} (→ 400). */
export function sanitizeCheckInWrite(raw: unknown): SanitizedCheckIn {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const note = cleanText(obj["note"], GOAL_LIMITS.maxCheckInNote).trim();
  const out: SanitizedCheckIn = { note: note || null, krValues: {} };
  if (isGoalStatus(obj["status"])) out.status = obj["status"];
  const raw2 = obj["krValues"];
  if (raw2 !== undefined && raw2 !== null) {
    if (typeof raw2 !== "object" || Array.isArray(raw2)) throw new GoalError("krValues must be an object keyed by key-result id");
    let count = 0;
    for (const [k, v] of Object.entries(raw2 as Record<string, unknown>)) {
      if (count++ >= GOAL_LIMITS.maxKeyResults) break;
      const n = Number(v);
      if (typeof k === "string" && k && Number.isFinite(n)) out.krValues[k.slice(0, 64)] = n;
    }
  }
  return out;
}

/**
 * Apply a check-in: update the named key results' `current` values, recompute progress, optionally set the
 * status, and append a bounded snapshot to the history. Version bumps. Pure (the caller supplies the id +
 * clock so it stays testable).
 */
export function applyCheckIn(existing: Goal, input: SanitizedCheckIn, checkInId: string, ctx: ActorContext, now: string): Goal {
  const keyResults = existing.keyResults.map((kr) =>
    Object.prototype.hasOwnProperty.call(input.krValues, kr.id) ? { ...kr, current: input.krValues[kr.id]! } : kr,
  );
  const progressPct = goalProgress(keyResults);
  const status = input.status ?? existing.status ?? "on_track";
  const by = actorLabel(ctx);
  const checkin: GoalCheckIn = { id: checkInId, at: now, by, note: input.note, status, progressPct, krValues: input.krValues };
  const checkins = [...(existing.checkins ?? []), checkin].slice(-GOAL_LIMITS.maxCheckIns);
  // Checking in advances the cadence to the next occurrence after this check-in.
  const nextCheckInAt = existing.cadence ? nextOccurrence(existing.cadence, now) : (existing.nextCheckInAt ?? null);
  return {
    ...existing,
    keyResults,
    progressPct,
    status,
    checkins,
    nextCheckInAt,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
    updatedBy: by,
  };
}

/** Apply an UPDATE to an existing goal, preserving id/owner/storage/createdAt; progress is recomputed. */
export function mergeGoalRow(existing: Goal, input: SanitizedGoalWrite, ctx: ActorContext, now: string): Goal {
  // The cadence changing (incl. cleared) reseeds the next check-in; an unchanged cadence keeps its schedule.
  const cadenceChanged = (existing.cadence ?? null) !== input.cadence;
  const nextCheckInAt = cadenceChanged
    ? (input.cadence ? nextOccurrence(input.cadence, now) : null)
    : (existing.nextCheckInAt ?? null);
  return {
    ...existing,
    title: input.title,
    description: input.description,
    projectId: input.projectId ?? existing.projectId ?? null,
    status: input.status,
    keyResults: input.keyResults,
    progressPct: goalProgress(input.keyResults),
    cadence: input.cadence,
    nextCheckInAt,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** The metadata view of a goal (key results dropped) — the list projection. */
export function goalMeta(g: Goal): GoalMeta {
  const checkins = g.checkins ?? [];
  const meta: GoalMeta = {
    id: g.id,
    title: g.title,
    status: g.status ?? "on_track",
    progressPct: g.progressPct ?? 0,
    keyResultCount: g.keyResults?.length ?? 0,
    checkInCount: checkins.length,
    lastCheckInAt: checkins.length ? checkins[checkins.length - 1]!.at : null,
    linkCount: g.links?.length ?? 0,
    cadence: g.cadence ?? null,
    nextCheckInAt: g.nextCheckInAt ?? null,
    updatedAt: g.updatedAt,
  };
  if (g.projectId !== undefined) meta.projectId = g.projectId;
  if (g.ownerSub !== undefined) meta.ownerSub = g.ownerSub;
  if (g.storage !== undefined) meta.storage = g.storage;
  return meta;
}

// ── Check-in cadence sweep (roadmap 3.2 slice 4) ─────────────────────────────────────────────────────────
// A managed cadence: a goal with a recurrence `cadence` carries a `nextCheckInAt`. A sweep (cron/routine-
// driven, like the task reminder sweep) finds goals whose next check-in is due, nudges the owner via the
// notify bus, and rolls the schedule forward — so the reminder recurs every period even if a check-in is
// missed. Pure selection + the injected runner live here; the route wires the store, bus and dedupe.

/** The one-time fire key for a goal's CURRENT check-in — the date is in the key so rolling the schedule
 *  forward is a fresh reminder, while the same due date never double-fires. */
export function goalCheckinFireKey(goal: Pick<Goal, "id" | "nextCheckInAt">): string {
  return `goal:checkin:fired:${goal.id}:${goal.nextCheckInAt ?? ""}`;
}

/** Goals whose check-in is DUE at `nowMs`: a `nextCheckInAt` in the past, not achieved, not already fired. Pure. */
export function dueGoalCheckins(goals: readonly Goal[], nowMs: number, isFired: (key: string) => boolean): Goal[] {
  return goals.filter((g) => {
    if (!g.nextCheckInAt) return false;
    const at = Date.parse(g.nextCheckInAt);
    if (Number.isNaN(at) || at > nowMs) return false;
    if (g.status === "achieved") return false; // an achieved goal needs no more check-ins
    return !isFired(goalCheckinFireKey(g));
  });
}

/** A check-in reminder notification for a goal, targeted at its owner (by sub). */
export function goalCheckinNotification(goal: Goal): { notification: { kind: string; title: string; body: string }; target: { sub?: string } } {
  return {
    notification: {
      kind: "goal-checkin",
      title: `Check-in due: ${goal.title}`,
      body: `Progress ${goal.progressPct ?? 0}% · update your key results`,
    },
    target: goal.ownerSub ? { sub: goal.ownerSub } : {},
  };
}

/** Roll a goal's check-in schedule forward past `now` (pure). No-op when the goal has no cadence. */
export function advanceGoalCadence(goal: Goal, now: string): Goal {
  if (!goal.cadence) return { ...goal, nextCheckInAt: null };
  return { ...goal, nextCheckInAt: nextOccurrence(goal.cadence, now) };
}

export interface GoalCheckinSweepDeps {
  goals: readonly Goal[];
  nowMs: number;
  nowISO: string;
  isFired: (key: string) => boolean | Promise<boolean>;
  markFired: (key: string) => void | Promise<void>;
  notify: (n: { kind: string; title: string; body: string }, target: { sub?: string }) => void | Promise<void>;
  /** Persist the schedule roll-forward for a due goal (the route writes it back to the goal's scope). */
  reschedule: (goal: Goal) => void | Promise<void>;
}

/**
 * Run one check-in sweep: for every goal whose check-in is due, mark-then-notify (at-most-once) and roll the
 * schedule forward. Returns the count nudged. Deterministic given its deps.
 */
export async function runGoalCheckinSweep(deps: GoalCheckinSweepDeps): Promise<{ nudged: number; goalIds: string[] }> {
  const flags = new Map<string, boolean>();
  for (const g of deps.goals) {
    if (g.nextCheckInAt) flags.set(goalCheckinFireKey(g), !!(await deps.isFired(goalCheckinFireKey(g))));
  }
  const due = dueGoalCheckins(deps.goals, deps.nowMs, (k) => flags.get(k) ?? false);
  const goalIds: string[] = [];
  for (const g of due) {
    await deps.markFired(goalCheckinFireKey(g)); // mark first — at-most-once even if notify throws
    const { notification, target } = goalCheckinNotification(g);
    await deps.notify(notification, target);
    await deps.reschedule(advanceGoalCadence(g, deps.nowISO)); // roll the cadence forward
    goalIds.push(g.id);
  }
  return { nudged: goalIds.length, goalIds };
}
