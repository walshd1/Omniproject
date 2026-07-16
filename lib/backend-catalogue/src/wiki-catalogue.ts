/**
 * WIKI / document content model — the neutral, primitive-built shape for OmniProject's collaborative docs
 * and knowledge base (roadmap 2.1). Same architectural principle as forms, screens and reports: a document
 * is a JSON DEFINITION built of typed BLOCK PRIMITIVES, authored once and rendered by a generic renderer.
 *
 * A document is an ordered list of `DocBlock`s. Each block TYPE is a small class (its config are properties;
 * it renders and validates by its type). The block types are the "documents built of primitives" allow-list:
 * the single `DOC_BLOCK_TYPES` list is what the validator, the authoring palette AND the unified primitive
 * store (the `block` family) all draw from, so the store can never drift from what a document can contain.
 *
 * Bodies are stored through the broker seam (zero-at-rest) — this module only defines the neutral shape and
 * pure helpers (block-type registry, wiki-link parsing, slugging); the authoritative sanitiser runs
 * server-side before anything is written.
 */

/**
 * The supported document block types. Text-bearing: `heading` (with a level), `paragraph`, `quote`,
 * `callout` (with a tone), `code`. Lists: `bullet-list`, `numbered-list`, `checklist` (items may be
 * checked). Structural: `divider`, `table` (a grid of cells), `embed` (a REFERENCE to external content by
 * URL — zero-at-rest, never inlined bytes).
 */
export type DocBlockType =
  | "heading" | "paragraph" | "quote" | "callout" | "code"
  | "bullet-list" | "numbered-list" | "checklist"
  | "divider" | "table" | "embed";

/** The block primitives, as a value — the single list the validator, the authoring palette and the unified
 *  primitive store (`block` family) all draw from, so the family can't drift from the DocBlockType union. */
export const DOC_BLOCK_TYPES: readonly DocBlockType[] = [
  "heading", "paragraph", "quote", "callout", "code",
  "bullet-list", "numbered-list", "checklist",
  "divider", "table", "embed",
];

/** The block types that carry a single free-text body. */
export const TEXT_BLOCK_TYPES: readonly DocBlockType[] = ["heading", "paragraph", "quote", "callout", "code"];
/** The list block types (an ordered set of items). */
export const LIST_BLOCK_TYPES: readonly DocBlockType[] = ["bullet-list", "numbered-list", "checklist"];

/** The tones a `callout` block can carry. */
export type CalloutTone = "info" | "warn" | "success" | "danger";
export const CALLOUT_TONES: readonly CalloutTone[] = ["info", "warn", "success", "danger"];

/** One item in a list block. `checked` only applies to a `checklist`. */
export interface DocListItem {
  text: string;
  checked?: boolean;
}

/**
 * One block in a document. Which optional fields apply depends on `type`: text blocks use `text`; `heading`
 * adds `level`; `callout` adds `tone`; list blocks use `items`; `table` uses `rows`; `embed` uses `url`
 * (+ optional `caption`). A generic renderer switches on `type`.
 */
export interface DocBlock {
  /** Stable id within the document (for keys, presence anchoring, comment threading). */
  id: string;
  type: DocBlockType;
  /** Free text for a text block (heading/paragraph/quote/callout/code). */
  text?: string;
  /** Heading level (1–3); defaulted to 2 when omitted. */
  level?: number;
  /** Callout tone. */
  tone?: CalloutTone;
  /** Items for a list block. */
  items?: DocListItem[];
  /** Rows of cells for a `table` block. */
  rows?: string[][];
  /** External reference for an `embed` block (the content lives elsewhere — zero-at-rest). */
  url?: string;
  /** Optional caption for an `embed`. */
  caption?: string;
}

/** Storage/validation limits (enforced by the server sanitiser). */
export const WIKI_LIMITS = {
  /** Max blocks in one document. */
  maxBlocks: 2000,
  /** Max characters in a single text block / list item / table cell. */
  maxText: 20000,
  /** Max title length. */
  maxTitle: 300,
  /** Max items in one list block. */
  maxListItems: 500,
  /** Max rows / columns in a table block. */
  maxTableRows: 200,
  maxTableCols: 20,
} as const;

/** A wiki-link `[[Target]]` written inside block text — a reference to another doc by title/slug. */
const WIKI_LINK_RE = /\[\[([^\]|]{1,300})(?:\|[^\]]{0,300})?\]\]/g;

/** Extract the wiki-link targets referenced in a piece of text (deduped, in order), e.g. `[[Onboarding]]`. */
export function parseWikiLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(WIKI_LINK_RE)) {
    const target = (m[1] ?? "").trim();
    if (target && !seen.has(target)) { seen.add(target); out.push(target); }
  }
  return out;
}

/** All wiki-link targets referenced anywhere in a document's block text (deduped, in order). */
export function docWikiLinks(blocks: readonly DocBlock[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const texts: string[] = [];
    if (typeof b.text === "string") texts.push(b.text);
    for (const it of b.items ?? []) texts.push(it.text);
    for (const row of b.rows ?? []) for (const cell of row) texts.push(cell);
    for (const t of texts) for (const target of parseWikiLinks(t)) {
      if (!seen.has(target)) { seen.add(target); out.push(target); }
    }
  }
  return out;
}

/** A URL-safe slug for a document title (lowercased, hyphenated, ascii-word runs). */
export function slugifyDocTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "untitled";
}
