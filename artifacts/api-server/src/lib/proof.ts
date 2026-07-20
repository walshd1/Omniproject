/**
 * PROOF server logic — the authoritative sanitiser + storage access for the creative-review surface (2.4).
 *
 * SECURITY: a proof REFERENCES a deliverable (image/PDF that lives elsewhere) and carries a list of
 * `annotation`-family primitives (pin/box/highlight) pinned onto it — nothing authored is executed or
 * trusted. `sanitizeProofWrite` is the single choke point every write passes through: the deliverable url is
 * restricted to a safe scheme (never a `data:`/`javascript:` payload — zero-at-rest), coordinates are clamped
 * to the normalised 0..1 range, each annotation is validated by its type (smuggled fields dropped), the note
 * text is length-capped, and the whole proof is size-bounded. The review DECISION and its author are set
 * server-side (its own route), never from a write. Proofs live in the scoped encrypted-JSON store (the
 * storage-target model), like whiteboards — one shared self-describing-id + scope primitive, no drift.
 */
import type { ActorContext, Proof, ProofMeta, ProofWrite } from "../broker/types";
import { makeScopedId, parseScopedId, scopeFromParsed, type ArtifactScope, type StorageTarget } from "./artifact-store";
import {
  ANNOTATION_TYPES, REGION_ANNOTATION_TYPES, DELIVERABLE_KINDS, REVIEW_DECISIONS, PROOF_LIMITS,
  type Annotation, type AnnotationType, type Deliverable, type DeliverableKind, type ProofDecision,
} from "@workspace/backend-catalogue";

/** A rejected proof write (maps to 400). */
export class ProofError extends Error {
  constructor(message: string) { super(message); this.name = "ProofError"; }
}

/** The artifact-store type key for proofs. */
export const PROOF_ARTIFACT = "proof";

/** Proofs live only in the encrypted-JSON areas (no sidecar), so the target is a subset of StorageTarget. */
export type ProofStorage = "user" | "project" | "org";
const PROOF_STORAGE_SET = new Set<ProofStorage>(["user", "project", "org"]);
const isProofStorage = (s: unknown): s is ProofStorage => typeof s === "string" && PROOF_STORAGE_SET.has(s as ProofStorage);

const ANNOTATION_TYPE_SET = new Set<string>(ANNOTATION_TYPES);
const REGION_SET = new Set<string>(REGION_ANNOTATION_TYPES);
const DELIVERABLE_KIND_SET = new Set<string>(DELIVERABLE_KINDS);
const REVIEW_DECISION_SET = new Set<string>(REVIEW_DECISIONS);
/** Schemes a deliverable url may use — everything else (data:, javascript:, file:, …) is rejected. */
const SAFE_URL_SCHEMES = new Set(["http:", "https:"]);

/** A sanitised proof write PLUS its chosen storage target. */
export interface SanitizedProofWrite extends ProofWrite {
  storage: ProofStorage;
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

/** A number clamped to the normalised annotation range [0, 1] (defaulted when absent/NaN). */
function norm(v: unknown, def = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(1, Math.max(0, n));
}

/**
 * Validate a deliverable reference: a known media kind + a SAFE-scheme absolute url OR a root-relative path
 * (an in-app attachment reference like `/api/attachments/<id>`). Throws {@link ProofError} on a bad shape.
 */
export function sanitizeDeliverable(raw: unknown): Deliverable {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const kind = obj["kind"];
  if (typeof kind !== "string" || !DELIVERABLE_KIND_SET.has(kind)) throw new ProofError("a deliverable needs a kind of image or pdf");
  const rawUrl = typeof obj["url"] === "string" ? obj["url"].trim() : "";
  if (!rawUrl) throw new ProofError("a deliverable needs a url");
  let url: string;
  if (rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
    url = rawUrl.slice(0, 2000); // a same-origin, root-relative attachment reference
  } else {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { throw new ProofError("the deliverable url is not valid"); }
    if (!SAFE_URL_SCHEMES.has(parsed.protocol)) throw new ProofError(`the deliverable url scheme "${parsed.protocol}" is not allowed`);
    url = parsed.href.slice(0, 2000);
  }
  const out: Deliverable = { kind: kind as DeliverableKind, url };
  const label = cleanText(obj["label"], PROOF_LIMITS.maxLabel).trim();
  if (label) out.label = label;
  return out;
}

/**
 * Sanitise one raw annotation into a well-formed {@link Annotation}, or return null to DROP it (unknown type
 * or unusable). Only the fields that apply to the annotation's `type` survive.
 */
export function sanitizeAnnotation(raw: unknown, index: number): Annotation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];
  if (typeof type !== "string" || !ANNOTATION_TYPE_SET.has(type)) return null;
  const t = type as AnnotationType;
  const id = cleanText(obj["id"], 64) || `a-${index + 1}`;
  const ann: Annotation = { id, type: t, x: norm(obj["x"]), y: norm(obj["y"]) };
  if (REGION_SET.has(t)) {
    ann.w = norm(obj["w"], 0.1);
    ann.h = norm(obj["h"], 0.1);
  }
  const text = cleanText(obj["text"], PROOF_LIMITS.maxText);
  if (text) ann.text = text;
  const page = Number(obj["page"]);
  if (Number.isFinite(page) && page >= 1) ann.page = Math.min(PROOF_LIMITS.maxPage, Math.floor(page));
  if (obj["resolved"] === true) ann.resolved = true;
  return ann;
}

/** Sanitise a whole annotation list (bound the count; drop unknown/malformed rather than fail the save). */
export function sanitizeAnnotations(raw: unknown): Annotation[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ProofError("annotations must be an array");
  if (raw.length > PROOF_LIMITS.maxAnnotations) throw new ProofError(`a proof may have at most ${PROOF_LIMITS.maxAnnotations} annotations`);
  const out: Annotation[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ann = sanitizeAnnotation(raw[i], i);
    if (ann) out.push(ann);
  }
  return out;
}

/**
 * Sanitise a whole proof write — the single choke point for POST/PUT. Validates the name + deliverable,
 * sanitises the annotations, and records the storage target. Throws {@link ProofError} (→ 400).
 */
export function sanitizeProofWrite(raw: unknown): SanitizedProofWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const name = cleanText(obj["name"], PROOF_LIMITS.maxName).trim();
  if (!name) throw new ProofError("a proof needs a name");
  const deliverable = sanitizeDeliverable(obj["deliverable"]);
  const annotations = sanitizeAnnotations(obj["annotations"]);
  const storage: ProofStorage = isProofStorage(obj["storage"]) ? obj["storage"] : "user";
  const out: SanitizedProofWrite = { name, deliverable, annotations, storage };
  const projectId = obj["projectId"];
  if (typeof projectId === "string" && projectId.trim()) out.projectId = projectId.trim();
  if (storage === "project" && !out.projectId) throw new ProofError("a project proof needs a projectId");
  const serialized = JSON.stringify({ name, deliverable, annotations });
  if (serialized.length > PROOF_LIMITS.maxProofBytes) throw new ProofError("the proof is too large");
  return out;
}

// ── Storage-target model: self-describing ids, JSON-store rows, decisions ────────────────────────────────

/** Build a self-describing proof id (shared scoped-id primitive). */
export const makeProofId = (storage: ProofStorage, localId: string, projectId?: string): string =>
  makeScopedId(storage as StorageTarget, localId, projectId);
/** Parse a self-describing proof id, or null if malformed / not a JSON target. */
export function parseProofId(id: string): { storage: ProofStorage; projectId?: string; localId: string } | null {
  const parsed = parseScopedId(id);
  if (!parsed || !isProofStorage(parsed.storage)) return null;
  return parsed.projectId !== undefined
    ? { storage: parsed.storage, projectId: parsed.projectId, localId: parsed.localId }
    : { storage: parsed.storage, localId: parsed.localId };
}
/** The encrypted-JSON scope for a proof id (the caller's OWN sub is always used for a user proof). */
export const proofScope = (parsed: { storage: ProofStorage; projectId?: string }, sub: string | undefined): ArtifactScope | null =>
  scopeFromParsed(parsed as { storage: StorageTarget; projectId?: string }, sub);

/** A proof actor's label (email > name > sub) for the audit `decidedBy`/`updatedBy`. */
export const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

/** Build the row for a NEW proof from a sanitised write. The owner is stamped from ctx (never the client);
 *  the proof starts at version 1 with a `pending` decision. */
export function newJsonProofRow(id: string, input: SanitizedProofWrite, ctx: ActorContext, now: string): Proof {
  return {
    id,
    name: input.name,
    projectId: input.projectId ?? null,
    ownerSub: ctx.sub ?? null,
    storage: input.storage,
    deliverable: input.deliverable,
    version: 1,
    annotations: input.annotations,
    decision: "pending",
    decidedBy: null,
    decidedAt: null,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/**
 * Apply an UPDATE to an existing proof, preserving its id/owner/storage. If the deliverable URL changes the
 * version bumps and the decision RE-OPENS to `pending` (a decision is bound to the version it reviewed).
 */
export function mergeJsonProofRow(existing: Proof, input: SanitizedProofWrite, ctx: ActorContext, now: string): Proof {
  const deliverableChanged = existing.deliverable.url !== input.deliverable.url || existing.deliverable.kind !== input.deliverable.kind;
  const common = {
    name: input.name,
    projectId: input.projectId ?? existing.projectId ?? null,
    deliverable: input.deliverable,
    annotations: input.annotations,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
  if (deliverableChanged) {
    // A new deliverable re-opens the review: bump the version and CLEAR the prior decision (drop its version).
    const { decisionVersion: _dropped, ...rest } = existing;
    return { ...rest, ...common, version: (existing.version ?? 1) + 1, decision: "pending", decidedBy: null, decidedAt: null };
  }
  return { ...existing, ...common, version: existing.version ?? 1 };
}

/** Whether a string is a settable review decision (approved / rejected / changes-requested). */
export const isReviewDecision = (v: unknown): v is ProofDecision => typeof v === "string" && REVIEW_DECISION_SET.has(v);

/** Record a review decision on a proof, BOUND to its current version, stamping the given reviewer label +
 *  time. The label form (rather than a ctx) lets an approval executor apply a decision detached from a req. */
export function applyDecisionByLabel(existing: Proof, decision: ProofDecision, by: string | null, now: string): Proof {
  return {
    ...existing,
    decision,
    decisionVersion: existing.version ?? 1,
    decidedBy: by,
    decidedAt: now,
    updatedAt: now,
    updatedBy: by,
  };
}

/** Record a review decision from a request context (the direct, unbound path). */
export function applyDecision(existing: Proof, decision: ProofDecision, ctx: ActorContext, now: string): Proof {
  return applyDecisionByLabel(existing, decision, actorLabel(ctx), now);
}

/** The metadata view of a proof (deliverable + annotations dropped) — the list projection. */
export function proofMeta(p: Proof): ProofMeta {
  const meta: ProofMeta = { id: p.id, name: p.name, version: p.version ?? 1, decision: p.decision ?? "pending", updatedAt: p.updatedAt };
  if (p.projectId !== undefined) meta.projectId = p.projectId;
  if (p.ownerSub !== undefined) meta.ownerSub = p.ownerSub;
  if (p.storage !== undefined) meta.storage = p.storage;
  if (p.updatedBy !== undefined) meta.updatedBy = p.updatedBy;
  return meta;
}
