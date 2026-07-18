/**
 * ORG REGISTRY server logic (org-wide store of APPROVED bespoke items) — the authoritative sanitiser +
 * storage + approval flow. A registry item is a typed, pure-JSON building block (template / report /
 * primitive / plugin / screen / dashboard / form / jsonDef) the org curates: submitted by a contributor,
 * reviewed by an admin (approve/reject), and — once approved — OPTIONALLY released to the community for the
 * (as-yet-unbuilt) online marketplace. Items are ORG-WIDE config in the sealed artifact store.
 * `sanitizeRegistrySubmit` is the single choke point; identity + review + release are stamped server-side.
 */
import type { ActorContext } from "../broker/types";
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, type ArtifactScope } from "./artifact-store";
import { sanitizeText as cleanText } from "./coerce";
import { actorLabel } from "./actor";
import {
  REGISTRY_ITEM_KINDS, type RegistryItemKind, type RegistryApprovalStatus, type RegistryVisibility,
} from "@workspace/backend-catalogue";

/** A rejected registry submission (maps to 400). */
export class RegistryError extends Error {
  constructor(message: string) { super(message); this.name = "RegistryError"; }
}

/** The artifact-store type key for registry items. */
export const REGISTRY_ARTIFACT = "registry-item";

/** Registry items are always org-wide config. */
export const REGISTRY_SCOPE: ArtifactScope = { kind: "org" };

const ITEM_KIND_SET = new Set<string>(REGISTRY_ITEM_KINDS);
const isItemKind = (k: unknown): k is RegistryItemKind => typeof k === "string" && ITEM_KIND_SET.has(k);

export const REGISTRY_LIMITS = {
  maxName: 200,
  maxPublisher: 200,
  maxVersion: 32,
  maxDescription: 4000,
  maxTags: 12,
  maxTag: 40,
  maxNote: 2000,
  maxPayloadBytes: 512 * 1024,
} as const;

/** A stored registry item. */
export interface RegistryItem {
  id: string;
  kind: RegistryItemKind;
  name: string;
  publisher: string;
  version: string;
  description: string | null;
  tags: string[];
  /** The pure-JSON building-block definition this item packages. */
  payload: unknown;
  approvalStatus: RegistryApprovalStatus;
  visibility: RegistryVisibility;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  releasedAt: string | null;
  /** The id the community marketplace assigned on publish, when a remote is connected (else null). */
  communityRef: string | null;
  updatedAt: string;
  rowVersion: number;
}

/** The list projection of a registry item (payload dropped). */
export interface RegistryItemMeta {
  id: string;
  kind: RegistryItemKind;
  name: string;
  publisher: string;
  version: string;
  approvalStatus: RegistryApprovalStatus;
  visibility: RegistryVisibility;
  tags: string[];
  submittedBy: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface SanitizedRegistrySubmit {
  kind: RegistryItemKind;
  name: string;
  publisher: string;
  version: string;
  description: string | null;
  tags: string[];
  payload: unknown;
}

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    const tag = cleanText(t, REGISTRY_LIMITS.maxTag).trim();
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= REGISTRY_LIMITS.maxTags) break;
  }
  return out;
}

/** Sanitise a registry submission — the single choke point. Throws {@link RegistryError} (→ 400). */
export function sanitizeRegistrySubmit(raw: unknown): SanitizedRegistrySubmit {
  const obj = (raw ?? {}) as Record<string, unknown>;
  if (!isItemKind(obj["kind"])) throw new RegistryError(`kind must be one of ${REGISTRY_ITEM_KINDS.join(", ")}`);
  const name = cleanText(obj["name"], REGISTRY_LIMITS.maxName).trim();
  if (!name) throw new RegistryError("an item needs a name");
  const publisher = cleanText(obj["publisher"], REGISTRY_LIMITS.maxPublisher).trim();
  if (!publisher) throw new RegistryError("an item needs a publisher");
  const version = cleanText(obj["version"], REGISTRY_LIMITS.maxVersion).trim() || "1.0.0";
  const description = cleanText(obj["description"], REGISTRY_LIMITS.maxDescription).trim();
  const payload = obj["payload"];
  if (payload === undefined || payload === null || typeof payload !== "object") throw new RegistryError("an item needs a JSON payload object");
  if (JSON.stringify(payload).length > REGISTRY_LIMITS.maxPayloadBytes) throw new RegistryError("the item payload is too large");
  return { kind: obj["kind"], name, publisher, version, description: description || null, tags: cleanTags(obj["tags"]), payload };
}


/** Build the row for a newly submitted item (draft, internal; identity stamped from ctx). */
export function newRegistryItem(id: string, input: SanitizedRegistrySubmit, ctx: ActorContext, now: string): RegistryItem {
  return {
    id, kind: input.kind, name: input.name, publisher: input.publisher, version: input.version,
    description: input.description, tags: input.tags, payload: input.payload,
    approvalStatus: "draft", visibility: "internal",
    submittedBy: actorLabel(ctx), submittedAt: now,
    reviewedBy: null, reviewedAt: null, reviewNote: null,
    releasedAt: null, communityRef: null,
    updatedAt: now, rowVersion: 1,
  };
}

/** Record an approve/reject review (approving makes an item reusable org-wide). Bumps rowVersion. */
export function reviewRegistryItem(existing: RegistryItem, decision: "approved" | "rejected", ctx: ActorContext, note: string | null, now: string): RegistryItem {
  return {
    ...existing,
    approvalStatus: decision,
    reviewedBy: actorLabel(ctx),
    reviewedAt: now,
    reviewNote: note,
    // A rejected item can't stay released.
    visibility: decision === "rejected" ? "internal" : existing.visibility,
    releasedAt: decision === "rejected" ? null : existing.releasedAt,
    communityRef: decision === "rejected" ? null : existing.communityRef,
    updatedAt: now,
    rowVersion: (existing.rowVersion ?? 1) + 1,
  };
}

/** Release an APPROVED item to the community (records the remote ref if a marketplace is connected). */
export function releaseRegistryItem(existing: RegistryItem, communityRef: string | null, now: string): RegistryItem {
  return { ...existing, visibility: "community", releasedAt: now, communityRef, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 };
}

/** Retract a released item back to internal-only. */
export function retractRegistryItem(existing: RegistryItem, now: string): RegistryItem {
  return { ...existing, visibility: "internal", releasedAt: null, communityRef: null, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 };
}

/** The metadata view of a registry item (payload dropped) — the list projection. */
export function registryItemMeta(it: RegistryItem): RegistryItemMeta {
  return {
    id: it.id, kind: it.kind, name: it.name, publisher: it.publisher, version: it.version,
    approvalStatus: it.approvalStatus ?? "draft", visibility: it.visibility ?? "internal",
    tags: it.tags ?? [], submittedBy: it.submittedBy ?? null, submittedAt: it.submittedAt, updatedAt: it.updatedAt,
  };
}

/** True when a stored registry ROW is safe to reimport from a backup: a string id, a valid item kind, a name,
 *  and a pure-JSON payload object. The def-store import calls this so a tampered/injected item is dropped, not
 *  written — the same "importer re-validates" rule the def rows follow. */
export function isImportableRegistryItem(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !r["id"]) return false;
  if (!isItemKind(r["kind"])) return false;
  if (typeof r["name"] !== "string" || !r["name"]) return false;
  if (r["payload"] === undefined || r["payload"] === null || typeof r["payload"] !== "object") return false;
  return true;
}

// ── Org store ────────────────────────────────────────────────────────────────────────────────────────────
export const listRegistryItems = (): RegistryItem[] => listArtifacts<RegistryItem>(REGISTRY_ARTIFACT, REGISTRY_SCOPE);
export const getRegistryItem = (id: string): RegistryItem | null => getArtifact<RegistryItem>(REGISTRY_ARTIFACT, REGISTRY_SCOPE, id);
export const putRegistryItem = (it: RegistryItem): void => putArtifact(REGISTRY_ARTIFACT, REGISTRY_SCOPE, it);
export const deleteRegistryItem = (id: string): boolean => deleteArtifact(REGISTRY_ARTIFACT, REGISTRY_SCOPE, id);

/** Every APPROVED item (optionally of a kind) — the reuse hook the app draws curated building blocks from. */
export function approvedRegistryItems(kind?: RegistryItemKind): RegistryItem[] {
  return listRegistryItems().filter((it) => it.approvalStatus === "approved" && (!kind || it.kind === kind));
}

/** Every item RELEASED to the community — what a connected online marketplace would publish. */
export function communityRegistryItems(): RegistryItem[] {
  return listRegistryItems().filter((it) => it.visibility === "community" && it.approvalStatus === "approved");
}
