import { Fragment, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { parseNotes, isSafeNoteHref, type Inline, type NoteBlock } from "../lib/task-notes";

/**
 * TaskNotes — the rich (markdown-lite) notes field for a task. Renders the stored `description` string
 * through the pure `parseNotes` tree in read mode, and swaps to a plain textarea on "Edit" (the source
 * markdown IS the value — no separate rich model to keep in sync). Saving hands the raw string back to
 * the caller, which patches `description`.
 *
 * SECURITY: every run is emitted as a React text node (escaped) — never HTML — and only http/https/mailto
 * links become anchors (`isSafeNoteHref`); an unsafe href renders as its plain link text.
 */
export function TaskNotes({ value, onSave, saving }: {
  value: string;
  onSave: (next: string) => void;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="space-y-2" data-testid="task-notes-editor">
        <textarea
          aria-label="Notes"
          className="w-full min-h-[8rem] rounded-none border border-border bg-card px-3 py-2 text-sm font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Notes — supports **bold**, *italic*, `code`, - lists, - [ ] checkboxes, [links](https://…)"
        />
        <div className="flex gap-2">
          <Button className="rounded-none" onClick={() => { onSave(draft); setEditing(false); }} disabled={saving}>Save</Button>
          <Button className="rounded-none" variant="outline" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
  }

  const blocks = parseNotes(value);
  return (
    <div className="space-y-2" data-testid="task-notes">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest">Notes</h3>
        <button type="button" className="text-[11px] uppercase tracking-widest text-primary hover:underline" onClick={() => { setDraft(value); setEditing(true); }}>Edit</button>
      </div>
      {blocks.length === 0
        ? <p className="text-xs text-muted-foreground">No notes yet.</p>
        : <div className="space-y-2 text-sm">{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>}
    </div>
  );
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
