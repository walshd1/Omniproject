import { Fragment, type ReactNode } from "react";
import { parseNotes, isSafeNoteHref, type Inline, type NoteBlock } from "../lib/task-notes";

/**
 * MarkdownLite — the shared read-only renderer for the repo's markdown-lite string format (the same one
 * `parseNotes` accepts: headings, quotes, fenced code, bullet/numbered/checklist lists, and inline
 * `**bold**`, `*italic*`, `` `code` ``, `[text](url)`). Used for task notes/descriptions and issue comments,
 * so both render identically from one place.
 *
 * SECURITY: every run is emitted as an escaped React text node — never HTML, no `dangerouslySetInnerHTML` —
 * and only http/https/mailto links become anchors (`isSafeNoteHref`); an unsafe href renders as plain text.
 */
export function MarkdownLite({ value, className }: { value: string; className?: string }) {
  const blocks = parseNotes(value);
  if (blocks.length === 0) return null;
  return <div className={className ?? "space-y-2 text-sm"}>{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
}

/** Render one inline run as an escaped React node. */
function InlineView({ span }: { span: Inline }): ReactNode {
  switch (span.t) {
    case "bold": return <strong>{span.text}</strong>;
    case "italic": return <em>{span.text}</em>;
    case "code": return <code className="font-mono bg-muted px-1 rounded text-xs">{span.text}</code>;
    case "link":
      return isSafeNoteHref(span.href)
        ? <a href={span.href} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">{span.text}</a>
        : <>{span.text}</>;
    default: return <>{span.text}</>;
  }
}

const Spans = ({ spans }: { spans: Inline[] }): ReactNode =>
  <>{spans.map((s, i) => <Fragment key={i}><InlineView span={s} /></Fragment>)}</>;

/** Render one block node. */
function BlockView({ block }: { block: NoteBlock }): ReactNode {
  switch (block.t) {
    case "heading": {
      const cls = block.level === 1 ? "text-base font-bold" : block.level === 3 ? "text-xs font-bold uppercase tracking-wider" : "text-sm font-bold";
      const Tag = (`h${block.level}`) as "h1" | "h2" | "h3";
      return <Tag className={cls}><Spans spans={block.spans} /></Tag>;
    }
    case "paragraph": return <p className="whitespace-pre-wrap"><Spans spans={block.spans} /></p>;
    case "quote": return <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground"><Spans spans={block.spans} /></blockquote>;
    case "code": return <pre className="overflow-x-auto rounded bg-muted p-2 text-xs font-mono"><code>{block.text}</code></pre>;
    case "bullets": return <ul className="list-disc pl-5 space-y-1">{block.items.map((it, i) => <li key={i}><Spans spans={it} /></li>)}</ul>;
    case "numbers": return <ol className="list-decimal pl-5 space-y-1">{block.items.map((it, i) => <li key={i}><Spans spans={it} /></li>)}</ol>;
    case "checks":
      return (
        <ul className="space-y-1">
          {block.items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <input type="checkbox" checked={it.checked} readOnly aria-hidden="true" className="mt-1" tabIndex={-1} />
              <span className={it.checked ? "line-through text-muted-foreground" : ""}><Spans spans={it.spans} /></span>
            </li>
          ))}
        </ul>
      );
    default: return null;
  }
}
