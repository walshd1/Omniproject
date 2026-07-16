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
  maxGoalBytes: 64 * 1024,
} as const;

/** A measurable key result: progress from `startValue` → `target`, currently at `current` (in `unit`). */
export interface KeyResult {
  id: string;
  label: string;
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
  storage: GoalStorage;
  projectId?: string;
}

/** Strip control characters and cap length on a free-text value. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    const printable = c === 9 || c === 10 || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
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
export function keyResultAttainment(kr: Pick<KeyResult, "startValue" | "target" | "current">): number {
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
  const storage: GoalStorage = isGoalStorage(obj["storage"]) ? obj["storage"] : "user";
  const out: SanitizedGoalWrite = { title, description: description || null, status, keyResults, storage };
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
export const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

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
  return {
    ...existing,
    keyResults,
    progressPct,
    status,
    checkins,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
    updatedBy: by,
  };
}

/** Apply an UPDATE to an existing goal, preserving id/owner/storage/createdAt; progress is recomputed. */
export function mergeGoalRow(existing: Goal, input: SanitizedGoalWrite, ctx: ActorContext, now: string): Goal {
  return {
    ...existing,
    title: input.title,
    description: input.description,
    projectId: input.projectId ?? existing.projectId ?? null,
    status: input.status,
    keyResults: input.keyResults,
    progressPct: goalProgress(input.keyResults),
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
    updatedAt: g.updatedAt,
  };
  if (g.projectId !== undefined) meta.projectId = g.projectId;
  if (g.ownerSub !== undefined) meta.ownerSub = g.ownerSub;
  if (g.storage !== undefined) meta.storage = g.storage;
  return meta;
}
