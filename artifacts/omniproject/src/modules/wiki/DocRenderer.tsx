import { Fragment, type ReactNode } from "react";
import type { DocBlock } from "@workspace/backend-catalogue";

/**
 * DocRenderer — the generic, read-only renderer for a document's primitive blocks (roadmap 2.1). It switches
 * on each block's `type` (the `block` primitive family) exactly as the screen engine switches on panel kinds.
 *
 * SECURITY: block text is rendered as React text nodes, never as HTML — React escapes it, so an authored
 * string can't inject markup or script. Embeds are references (the server already restricted the URL to a
 * safe scheme); we render them as a plain outbound link, not an inline frame.
 */

const CALLOUT_TONE_CLASS: Record<string, string> = {
  info: "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  warn: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  success: "border-green-400 bg-green-50 dark:bg-green-950/30",
  danger: "border-red-400 bg-red-50 dark:bg-red-950/30",
};

const WIKI_LINK_RE = /\[\[([^\]|]{1,300})(?:\|([^\]]{0,300}))?\]\]/g;

/** Render a text string, turning `[[Target]]` / `[[Target|label]]` wiki-links into styled spans. Text is
 *  emitted as React nodes (escaped), so nothing authored can inject markup. */
function renderText(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  let key = 0;
  while ((m = WIKI_LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const target = (m[1] ?? "").trim();
    const label = (m[2] ?? "").trim() || target;
    out.push(<span key={key++} className="text-primary underline decoration-dotted" data-wikilink={target}>{label}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

/** Render a single block. */
function BlockView({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "heading": {
      const level = block.level === 1 || block.level === 3 ? block.level : 2;
      const cls = level === 1 ? "text-2xl font-bold" : level === 3 ? "text-base font-bold" : "text-xl font-bold";
      const Tag = (`h${level}`) as "h1" | "h2" | "h3";
      return <Tag className={cls}>{renderText(block.text ?? "")}</Tag>;
    }
    case "paragraph":
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{renderText(block.text ?? "")}</p>;
    case "quote":
      return <blockquote className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground">{renderText(block.text ?? "")}</blockquote>;
    case "code":
      return <pre className="overflow-x-auto rounded bg-muted p-2 text-xs font-mono"><code>{block.text ?? ""}</code></pre>;
    case "callout":
      return <div className={`rounded border-l-4 p-2 text-sm ${CALLOUT_TONE_CLASS[block.tone ?? "info"] ?? CALLOUT_TONE_CLASS["info"]}`}>{renderText(block.text ?? "")}</div>;
    case "bullet-list":
      return <ul className="list-disc pl-5 text-sm space-y-1">{(block.items ?? []).map((it, i) => <li key={i}>{renderText(it.text)}</li>)}</ul>;
    case "numbered-list":
      return <ol className="list-decimal pl-5 text-sm space-y-1">{(block.items ?? []).map((it, i) => <li key={i}>{renderText(it.text)}</li>)}</ol>;
    case "checklist":
      return (
        <ul className="text-sm space-y-1">
          {(block.items ?? []).map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <input type="checkbox" checked={!!it.checked} readOnly aria-label={it.text} className="mt-1" />
              <span className={it.checked ? "line-through text-muted-foreground" : ""}>{renderText(it.text)}</span>
            </li>
          ))}
        </ul>
      );
    case "divider":
      return <hr className="border-border" />;
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <tbody>
              {(block.rows ?? []).map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c} className="border border-border px-2 py-1">{renderText(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "embed":
      return (
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline break-all">
          {block.caption || block.url}
        </a>
      );
    default:
      return null;
  }
}

/** Render a document body — an ordered list of primitive blocks. */
export function DocRenderer({ blocks }: { blocks: readonly DocBlock[] }) {
  if (!blocks.length) return <p className="text-xs text-muted-foreground" data-testid="doc-empty">This document is empty.</p>;
  return (
    <div className="space-y-3" data-testid="doc-renderer">
      {blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </div>
  );
}
