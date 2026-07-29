import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseNotes } from "../lib/task-notes";
import { MarkdownLite } from "./MarkdownLite";

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
        : <MarkdownLite value={value} />}
    </div>
  );
}
