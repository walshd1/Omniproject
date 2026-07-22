/**
 * Task notes — a small, PURE markdown-lite parser for a task's free-text notes (the `description`
 * string). Tasks keep their notes as a plain string (the backend already stores it); this turns that
 * string into a typed block/inline tree the renderer walks. No HTML is produced here — the renderer
 * emits React text nodes — and link hrefs are scheme-allowlisted (`isSafeNoteHref`) so an authored
 * `javascript:`/`data:` URL never becomes a live anchor.
 *
 * Supported: `#`/`##`/`###` headings, `>` quotes, ``` fenced code, `- `/`* ` bullets,
 * `- [ ]`/`- [x]` checklists, `1.` numbered lists, blank-line paragraph breaks; inline `**bold**`,
 * `*italic*`/`_italic_`, `` `code` `` and `[text](url)` links. Anything unrecognised is plain text.
 */

/** An inline run within a block. */
export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; text: string }
  | { t: "italic"; text: string }
  | { t: "code"; text: string }
  | { t: "link"; text: string; href: string };

/** A block-level node. */
export type NoteBlock =
  | { t: "heading"; level: 1 | 2 | 3; spans: Inline[] }
  | { t: "paragraph"; spans: Inline[] }
  | { t: "quote"; spans: Inline[] }
  | { t: "code"; text: string }
  | { t: "bullets"; items: Inline[][] }
  | { t: "numbers"; items: Inline[][] }
  | { t: "checks"; items: Array<{ checked: boolean; spans: Inline[] }> };

/** Only http/https/mailto hrefs become live links; everything else renders as plain text. */
export function isSafeNoteHref(raw: string): boolean {
  const s = raw.trim();
  return /^https?:\/\//i.test(s) || /^mailto:[^\s]+@[^\s]+$/i.test(s);
}

// Inline markers, matched earliest-first with this priority (code binds tightest, then link, bold, italic).
const INLINE_PATTERNS: Array<{ re: RegExp; make: (m: RegExpExecArray) => Inline }> = [
  { re: /`([^`]+)`/, make: (m) => ({ t: "code", text: m[1]! }) },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ t: "link", text: m[1]!, href: m[2]! }) },
  { re: /\*\*([^*]+)\*\*/, make: (m) => ({ t: "bold", text: m[1]! }) },
  { re: /\*([^*]+)\*/, make: (m) => ({ t: "italic", text: m[1]! }) },
  { re: /_([^_]+)_/, make: (m) => ({ t: "italic", text: m[1]! }) },
];

/** Parse one line of text into inline runs. Non-nesting: the first marker wins, then we continue after it. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { index: number; length: number; node: Inline } | null = null;
    for (const { re, make } of INLINE_PATTERNS) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, node: make(m) };
      }
    }
    if (!best) { out.push({ t: "text", text: rest }); break; }
    if (best.index > 0) out.push({ t: "text", text: rest.slice(0, best.index) });
    out.push(best.node);
    rest = rest.slice(best.index + best.length);
  }
  return out.length ? out : [{ t: "text", text: "" }];
}

const BULLET_RE = /^[-*]\s+(.*)$/;
const CHECK_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const NUMBER_RE = /^\d+\.\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;

/** Parse a notes string into block nodes. */
export function parseNotes(md: string): NoteBlock[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  let i = 0;

  const flushParas = (buf: string[]): void => {
    if (buf.length) blocks.push({ t: "paragraph", spans: parseInline(buf.join(" ").trim()) });
    buf.length = 0;
  };

  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Fenced code — consume until the closing fence (or end of input).
    if (trimmed.startsWith("```")) {
      flushParas(para);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) { code.push(lines[i]!); i++; }
      i++; // skip closing fence
      blocks.push({ t: "code", text: code.join("\n") });
      continue;
    }

    if (trimmed === "") { flushParas(para); i++; continue; }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushParas(para);
      blocks.push({ t: "heading", level: heading[1]!.length as 1 | 2 | 3, spans: parseInline(heading[2]!) });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParas(para);
      blocks.push({ t: "quote", spans: parseInline(trimmed.replace(/^>\s?/, "")) });
      i++;
      continue;
    }

    // Checklist run — a checkbox item can't also be a plain bullet, so test it first.
    if (CHECK_RE.test(trimmed)) {
      flushParas(para);
      const items: Array<{ checked: boolean; spans: Inline[] }> = [];
      while (i < lines.length) {
        const m = CHECK_RE.exec(lines[i]!.trim());
        if (!m) break;
        items.push({ checked: m[1]!.toLowerCase() === "x", spans: parseInline(m[2]!) });
        i++;
      }
      blocks.push({ t: "checks", items });
      continue;
    }

    // Bullet run.
    if (BULLET_RE.test(trimmed)) {
      flushParas(para);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (CHECK_RE.test(t)) break; // a checkbox line ends the plain-bullet run
        const m = BULLET_RE.exec(t);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      blocks.push({ t: "bullets", items });
      continue;
    }

    // Numbered run.
    if (NUMBER_RE.test(trimmed)) {
      flushParas(para);
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = NUMBER_RE.exec(lines[i]!.trim());
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      blocks.push({ t: "numbers", items });
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushParas(para);
  return blocks;
}
