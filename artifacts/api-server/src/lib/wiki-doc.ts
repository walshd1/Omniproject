/**
 * WIKI document server logic — the authoritative sanitiser + broker access for collaborative docs (2.1).
 *
 * SECURITY: nothing a user authors is ever executed or trusted. `sanitizeWikiDocWrite` is the single choke
 * point every write passes through: it strips control characters, caps every length, validates each block by
 * its type, and allows only safe URL schemes on embeds. Bodies are stored as neutral block JSON (never HTML),
 * so there is no markup sink — the renderer escapes on the way out. Bodies live in the backend through the
 * broker seam (zero-at-rest); this module only sanitises on the way in and reads back on the way out.
 */
import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import type { ActorContext, WikiSpace, WikiDoc, WikiDocWrite, WikiDocVersion, WikiDocVersionMeta } from "../broker/types";
import type { StorageTarget } from "./artifact-store";
import {
  makeScopedId, parseScopedId, scopeFromParsed, isStorageTarget,
  listArtifacts, getArtifact, putArtifact, deleteArtifact,
} from "./artifact-store";
import { sanitizeText } from "./coerce";
import {
  DOC_BLOCK_TYPES, WIKI_LIMITS, CALLOUT_TONES, docWikiLinks, slugifyDocTitle,
  type DocBlock, type DocBlockType, type DocListItem, type CalloutTone,
} from "@workspace/backend-catalogue";

/** A rejected wiki write (maps to 400). */
export class WikiError extends Error {
  constructor(message: string) { super(message); this.name = "WikiError"; }
}

const BLOCK_TYPE_SET = new Set<string>(DOC_BLOCK_TYPES);
const TONE_SET = new Set<string>(CALLOUT_TONES);
/** URL schemes an `embed` reference may use — everything else (javascript:, data:, file:, …) is rejected. */
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// `sanitizeText` — the free-text control-char stripper — now lives in ./coerce (the shared primitives
// home, imported above for this module's own block sanitisers); re-exported so existing importers keep the name.
export { sanitizeText };

/** Validate an embed URL against the safe-scheme allow-list; returns the normalised href or throws. */
export function sanitizeEmbedUrl(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new WikiError("an embed block needs a url");
  let url: URL;
  try { url = new URL(s); } catch { throw new WikiError("embed url is not a valid absolute url"); }
  if (!SAFE_URL_SCHEMES.has(url.protocol)) throw new WikiError(`embed url scheme "${url.protocol}" is not allowed`);
  return url.href.slice(0, WIKI_LIMITS.maxText);
}

function sanitizeListItems(raw: unknown): DocListItem[] {
  if (!Array.isArray(raw)) throw new WikiError("a list block needs an items array");
  if (raw.length > WIKI_LIMITS.maxListItems) throw new WikiError(`a list block may have at most ${WIKI_LIMITS.maxListItems} items`);
  return raw.map((it) => {
    const obj = (it ?? {}) as Record<string, unknown>;
    const item: DocListItem = { text: sanitizeText(obj["text"], WIKI_LIMITS.maxText) };
    if (obj["checked"] === true) item.checked = true;
    return item;
  });
}

function sanitizeTableRows(raw: unknown): string[][] {
  if (!Array.isArray(raw)) throw new WikiError("a table block needs a rows array");
  if (raw.length > WIKI_LIMITS.maxTableRows) throw new WikiError(`a table may have at most ${WIKI_LIMITS.maxTableRows} rows`);
  return raw.map((row) => {
    if (!Array.isArray(row)) throw new WikiError("each table row must be an array of cells");
    if (row.length > WIKI_LIMITS.maxTableCols) throw new WikiError(`a table row may have at most ${WIKI_LIMITS.maxTableCols} cells`);
    return row.map((cell) => sanitizeText(cell, WIKI_LIMITS.maxText));
  });
}

/**
 * Sanitise one raw block into a well-formed `DocBlock`, or throw {@link WikiError}. Only the fields that
 * apply to the block's `type` survive — everything else is dropped, so a malicious extra field can't ride
 * along into storage.
 */
export function sanitizeDocBlock(raw: unknown, index: number): DocBlock {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const type = obj["type"];
  if (typeof type !== "string" || !BLOCK_TYPE_SET.has(type)) throw new WikiError(`block ${index} has an unknown type`);
  const t = type as DocBlockType;
  const id = sanitizeText(obj["id"], 64) || `b${index + 1}`;
  const block: DocBlock = { id, type: t };
  switch (t) {
    case "heading": {
      block.text = sanitizeText(obj["text"], WIKI_LIMITS.maxTitle);
      const lvl = Number(obj["level"]);
      block.level = lvl === 1 || lvl === 3 ? lvl : 2;
      break;
    }
    case "paragraph":
    case "quote":
    case "code":
      block.text = sanitizeText(obj["text"], WIKI_LIMITS.maxText);
      break;
    case "callout": {
      block.text = sanitizeText(obj["text"], WIKI_LIMITS.maxText);
      const tone = obj["tone"];
      block.tone = (typeof tone === "string" && TONE_SET.has(tone) ? tone : "info") as CalloutTone;
      break;
    }
    case "bullet-list":
    case "numbered-list":
    case "checklist":
      block.items = sanitizeListItems(obj["items"]);
      break;
    case "table":
      block.rows = sanitizeTableRows(obj["rows"]);
      break;
    case "embed": {
      block.url = sanitizeEmbedUrl(obj["url"]);
      const caption = sanitizeText(obj["caption"], WIKI_LIMITS.maxTitle);
      if (caption) block.caption = caption;
      break;
    }
    case "divider":
      break;
  }
  return block;
}

/** Sanitise a whole block list. */
export function sanitizeDocBlocks(raw: unknown): DocBlock[] {
  if (!Array.isArray(raw)) throw new WikiError("blocks must be an array");
  if (raw.length > WIKI_LIMITS.maxBlocks) throw new WikiError(`a document may have at most ${WIKI_LIMITS.maxBlocks} blocks`);
  return raw.map((b, i) => sanitizeDocBlock(b, i));
}

/**
 * Where a document is stored — the author's CHOICE (permission-gated at the route):
 *   - `user`     the author's PRIVATE encrypted-JSON area (only they see it).
 *   - `project`  a project's shared encrypted-JSON area (needs project scope).
 *   - `org`      the org-wide shared encrypted-JSON area (needs org-write permission).
 *   - `sidecar`  the built-in system-of-record (the broker), when it models a wiki.
 * The same storage-target pattern as whiteboards — one shared primitive, no drift.
 */
export type WikiDocStorage = StorageTarget;
/** The artifact-store type keys for wiki documents and their retained revisions. */
export const WIKI_DOC_ARTIFACT = "wiki-doc";
export const WIKI_VERSION_ARTIFACT = "wiki-doc-version";
/** How many revisions to retain per JSON-stored document (a bounded ring, mirroring the sidecar). */
export const MAX_WIKI_DOC_VERSIONS = 50;

/** A sanitised document write PLUS its chosen storage target. */
export interface SanitizedWikiDocWrite extends WikiDocWrite {
  storage: WikiDocStorage;
  projectId?: string;
}

/**
 * Sanitise a whole document write. The single choke point for POST/PUT — validates the title/space, derives
 * a slug when missing, sanitises every block, and records the storage target. Throws {@link WikiError}
 * (→ 400) on any hard violation.
 */
export function sanitizeWikiDocWrite(raw: unknown): SanitizedWikiDocWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const spaceId = typeof obj["spaceId"] === "string" ? obj["spaceId"].trim() : "";
  if (!spaceId) throw new WikiError("a document needs a spaceId");
  const title = sanitizeText(obj["title"], WIKI_LIMITS.maxTitle).trim();
  if (!title) throw new WikiError("a document needs a title");
  const blocks = sanitizeDocBlocks(obj["blocks"] ?? []);
  // Storage target — the author's choice, permission-gated at the route. Defaults to the private user area.
  const storage: WikiDocStorage = isStorageTarget(obj["storage"]) ? obj["storage"] : "user";
  const out: SanitizedWikiDocWrite = { spaceId, title, blocks, storage };
  const parentId = obj["parentId"];
  if (typeof parentId === "string" && parentId.trim()) out.parentId = parentId.trim();
  const slug = typeof obj["slug"] === "string" && obj["slug"].trim() ? slugifyDocTitle(obj["slug"]) : slugifyDocTitle(title);
  out.slug = slug;
  const projectId = obj["projectId"];
  if (typeof projectId === "string" && projectId.trim()) out.projectId = projectId.trim();
  if (storage === "project" && !out.projectId) throw new WikiError("a project document needs a projectId");
  return out;
}

// ── Storage-target model: self-describing ids, JSON-store rows + version ring (mirrors whiteboards) ──────────

/** Build a self-describing wiki-doc id (shared scoped-id primitive). */
export const makeWikiDocId = makeScopedId;
/** Parse a self-describing wiki-doc id back to its storage + parts, or null if malformed / not a wiki-doc
 *  target (the def-only `programme` tier is rejected — a wiki doc is never programme-scoped). */
export function parseWikiDocId(id: string): { storage: StorageTarget; projectId?: string; localId: string } | null {
  const p = parseScopedId(id);
  if (!p || !isStorageTarget(p.storage)) return null;
  return p.projectId !== undefined
    ? { storage: p.storage, projectId: p.projectId, localId: p.localId }
    : { storage: p.storage, localId: p.localId };
}
/** The encrypted-JSON scope for a non-sidecar id (the caller's OWN sub is always used for a user doc). */
export const wikiDocScope = scopeFromParsed;

/** The document's actor label (email > name > sub) for the audit `updatedBy`/`author`. */
const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

/**
 * Build the row for a NEW document destined for an encrypted-JSON store. The id is self-describing, the
 * author is recorded, everything else comes from the sanitised write. Kept a plain {@link WikiDoc} so the
 * read path is identical to a sidecar doc.
 */
export function newJsonDocRow(id: string, input: SanitizedWikiDocWrite, ctx: ActorContext, now: string): WikiDoc {
  return {
    id,
    spaceId: input.spaceId,
    parentId: input.parentId ?? null,
    slug: input.slug ?? slugifyDocTitle(input.title),
    title: input.title,
    blocks: input.blocks,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** Apply an UPDATE to an existing JSON document, preserving its id (a write can't move it between stores). */
export function mergeJsonDocRow(existing: WikiDoc, input: SanitizedWikiDocWrite, ctx: ActorContext, now: string): WikiDoc {
  return {
    ...existing,
    spaceId: input.spaceId,
    parentId: input.parentId ?? null,
    slug: input.slug ?? existing.slug,
    title: input.title,
    blocks: input.blocks,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** The summary view of a document (block bodies dropped) — the list projection. */
export function docSummary(d: WikiDoc): WikiDoc {
  return { ...d, blocks: [] };
}

/**
 * Capture a revision of a JSON-stored document into its scope's version collection and trim the per-doc ring.
 * Snapshots are independent copies, so a later edit can't mutate a stored version. `versionId` is unique
 * within the collection. Runs on every JSON create/update, mirroring the sidecar's history retention.
 */
export function captureJsonDocVersion(scope: Parameters<typeof putArtifact>[1], doc: WikiDoc, versionId: string): void {
  putArtifact<WikiDocVersion & { id: string }>(WIKI_VERSION_ARTIFACT, scope, {
    id: versionId, versionId, docId: doc.id, at: doc.updatedAt, author: doc.updatedBy ?? null,
    title: doc.title, blocks: doc.blocks.map((b) => ({ ...b })),
  });
  // Trim this doc's ring: keep the newest MAX_WIKI_DOC_VERSIONS by `at`, delete the rest from the collection.
  const mine = listArtifacts<WikiDocVersion & { id: string }>(WIKI_VERSION_ARTIFACT, scope)
    .filter((v) => v.docId === doc.id)
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const stale of mine.slice(0, Math.max(0, mine.length - MAX_WIKI_DOC_VERSIONS))) {
    deleteArtifact(WIKI_VERSION_ARTIFACT, scope, stale.id);
  }
}

/** The retained revisions of a JSON-stored document, newest first (metadata only). */
export function listJsonDocVersions(scope: Parameters<typeof listArtifacts>[1], docId: string): WikiDocVersionMeta[] {
  return listArtifacts<WikiDocVersion & { id: string }>(WIKI_VERSION_ARTIFACT, scope)
    .filter((v) => v.docId === docId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ versionId, docId: d, at, author, title }) => ({ versionId, docId: d, at, author: author ?? null, title }));
}

/** One retained revision of a JSON-stored document with its blocks, or null. */
export function getJsonDocVersion(scope: Parameters<typeof getArtifact>[1], docId: string, versionId: string): WikiDocVersion | null {
  const v = getArtifact<WikiDocVersion & { id: string }>(WIKI_VERSION_ARTIFACT, scope, versionId);
  return v && v.docId === docId ? { versionId: v.versionId, docId: v.docId, at: v.at, author: v.author ?? null, title: v.title, blocks: v.blocks } : null;
}

/** A backlink: another document that references THIS one via a `[[wiki-link]]`. */
export interface WikiBacklink { id: string; title: string; slug: string; spaceId: string }

/**
 * Resolve the documents that link TO `target` (by title or slug) from the given corpus — computed
 * server-side from the stored block text, so a doc always shows who points at it.
 */
export function resolveBacklinks(target: WikiDoc, corpus: readonly WikiDoc[]): WikiBacklink[] {
  const names = new Set([target.title.toLowerCase(), target.slug.toLowerCase()]);
  const out: WikiBacklink[] = [];
  for (const doc of corpus) {
    if (doc.id === target.id) continue;
    const links = docWikiLinks(doc.blocks).map((l) => l.toLowerCase());
    if (links.some((l) => names.has(l) || slugifyDocTitle(l) === target.slug.toLowerCase())) {
      out.push({ id: doc.id, title: doc.title, slug: doc.slug, spaceId: doc.spaceId });
    }
  }
  return out;
}

// ── Broker access (thin wrappers; the routes guard capability + RBAC first). ──────────────────────────────

/** Whether the active broker models a wiki / knowledge base ("if supported by the backend"). */
export const brokerHasWiki = (): boolean => !!getBroker().getWikiDoc;

/** The wiki spaces (empty when unsupported). */
export const listWikiSpaces = (req: Request): Promise<WikiSpace[]> => {
  const b = getBroker();
  return b.listWikiSpaces ? b.listWikiSpaces(contextFromReq(req)) : Promise.resolve([]);
};
/** Documents, optionally scoped to a space (block bodies omitted in the list view). */
export const listWikiDocs = (req: Request, spaceId?: string): Promise<WikiDoc[]> => {
  const b = getBroker();
  return b.listWikiDocs ? b.listWikiDocs(contextFromReq(req), spaceId ? { spaceId } : undefined) : Promise.resolve([]);
};
/** One document by id, or null. */
export const getWikiDoc = (req: Request, id: string): Promise<WikiDoc | null> => {
  const b = getBroker();
  return b.getWikiDoc ? b.getWikiDoc(contextFromReq(req), id) : Promise.resolve(null);
};
/** Create/update/delete a document (throws if unsupported — the route guards first). */
export const writeWikiDoc = (req: Request, op: "create" | "update" | "delete", input: WikiDocWrite & { id?: string }): Promise<WikiDoc | null> => {
  const b = getBroker();
  if (!b.writeWikiDoc) throw new Error("this backend does not support a wiki");
  return b.writeWikiDoc(contextFromReq(req), op, input);
};

/** Whether the active broker retains document revisions (the version-history capability). */
export const brokerHasWikiVersions = (): boolean => !!getBroker().listWikiDocVersions;
/** A document's saved revisions, newest first (metadata only) — empty when unsupported. */
export const listWikiDocVersions = (req: Request, docId: string): Promise<WikiDocVersionMeta[]> => {
  const b = getBroker();
  return b.listWikiDocVersions ? b.listWikiDocVersions(contextFromReq(req), docId) : Promise.resolve([]);
};
/** One saved revision with its blocks (for preview / diff / restore), or null. */
export const getWikiDocVersion = (req: Request, docId: string, versionId: string): Promise<WikiDocVersion | null> => {
  const b = getBroker();
  return b.getWikiDocVersion ? b.getWikiDocVersion(contextFromReq(req), docId, versionId) : Promise.resolve(null);
};
