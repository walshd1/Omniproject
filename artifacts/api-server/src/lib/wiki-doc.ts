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
import type { WikiSpace, WikiDoc, WikiDocWrite, WikiDocVersion, WikiDocVersionMeta } from "../broker/types";
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

/** Strip control characters (keep tab/newline) and cap length so authored text can never carry a payload
 *  or blow a limit. This runs on every free-text value before storage. */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    // Keep tab (9) and newline (10); drop other C0 controls (<32), DEL (127) and C1 controls (128-159).
    const printable = c === 9 || c === 10 || (c >= 32 && c !== 127 && !(c >= 128 && c <= 159));
    if (printable) out += ch;
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

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
 * Sanitise a whole document write. The single choke point for POST/PUT — validates the title/space, derives
 * a slug when missing, and sanitises every block. Throws {@link WikiError} (→ 400) on any hard violation.
 */
export function sanitizeWikiDocWrite(raw: unknown): WikiDocWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const spaceId = typeof obj["spaceId"] === "string" ? obj["spaceId"].trim() : "";
  if (!spaceId) throw new WikiError("a document needs a spaceId");
  const title = sanitizeText(obj["title"], WIKI_LIMITS.maxTitle).trim();
  if (!title) throw new WikiError("a document needs a title");
  const blocks = sanitizeDocBlocks(obj["blocks"] ?? []);
  const out: WikiDocWrite = { spaceId, title, blocks };
  const parentId = obj["parentId"];
  if (typeof parentId === "string" && parentId.trim()) out.parentId = parentId.trim();
  const slug = typeof obj["slug"] === "string" && obj["slug"].trim() ? slugifyDocTitle(obj["slug"]) : slugifyDocTitle(title);
  out.slug = slug;
  return out;
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
