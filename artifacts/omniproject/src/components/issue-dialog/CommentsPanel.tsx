import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useComments, useAddComment, useDeleteComment } from "../../lib/comments";
import { MarkdownLite } from "../MarkdownLite";
import { activeMentionQuery, applyMention, filterCandidates, mentionCandidates } from "../../lib/mention-suggest";

/**
 * Comment thread on any shared surface (the "comments" feature module). Reads/writes the
 * shared-state-backed `/api/comments/:roomId` endpoint keyed by the caller-supplied room id
 * (`issue:<projectId>:<issueId>` for a work item, `doc:<docId>` for a wiki page, …).
 *
 * Bodies are stored as plain **markdown-lite source** (the same format task notes use) and rendered
 * read-only through `MarkdownLite` — escaped React nodes, never HTML — so the stored value stays a plain
 * string (zero-at-rest-safe; the gateway forwards it verbatim to the backend when persistence is on).
 * `@mentions` in the body are parsed server-side and notify the mentioned user; the composer offers a
 * free-text typeahead seeded from the thread's own participants (there is no user directory to query).
 * Delete is offered on every comment; the server enforces "author or pmo/admin".
 */
export function CommentsPanel({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const { data: comments } = useComments(roomId);
  const add = useAddComment(roomId);
  const del = useDeleteComment(roomId);
  const [body, setBody] = useState("");

  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  // The active `@partial` (position + query) being typed, and the highlighted suggestion.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const candidates = useMemo(() => mentionCandidates(comments), [comments]);
  const suggestions = mention ? filterCandidates(candidates, mention.query) : [];
  const menuOpen = mention != null && suggestions.length > 0;

  // Restore focus + caret after a mention insert rewrites the (controlled) value.
  useEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [body]);

  const syncFrom = (el: HTMLTextAreaElement) => {
    const active = activeMentionQuery(el.value, el.selectionStart ?? el.value.length);
    setMention(active);
    setMentionIdx(0);
  };

  const insertMention = (token: string) => {
    const el = taRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? body.length;
    const next = applyMention(body, mention.start, caret, token);
    pendingCaret.current = next.caret;
    setBody(next.text);
    setMention(null);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim(), {
      onSuccess: () => { setBody(""); setMention(null); },
      onError: (err) => toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not add the comment.", variant: "destructive" }),
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(suggestions[mentionIdx]!.token); return; }
      if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
    }
    // Cmd/Ctrl+Enter submits; a plain Enter stays a newline (the composer is multi-line now).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const remove = (id: string) =>
    del.mutate(id, {
      onError: (err) => toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not delete it.", variant: "destructive" }),
    });

  return (
    <section data-testid="comments" className="border-t border-border pt-4 mt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Comments</h3>

      <ul className="space-y-1.5">
        {(comments ?? []).length === 0 && <li className="text-xs text-muted-foreground">No comments yet.</li>}
        {(comments ?? []).map((c) => (
          <li key={c.id} className="text-sm border border-border p-2 flex items-start gap-2">
            <span className="flex-1 min-w-0">
              <MarkdownLite value={c.body} className="space-y-1.5 break-words" />
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                — {c.author.label} · {new Date(c.createdAt).toLocaleString()}
              </span>
            </span>
            <button
              type="button"
              onClick={() => remove(c.id)}
              aria-label="Delete comment"
              className="shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 text-muted-foreground hover:text-destructive"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="space-y-2">
        <div className="relative">
          <textarea
            ref={taRef}
            aria-label="New comment"
            value={body}
            onChange={(e) => { setBody(e.target.value); syncFrom(e.target); }}
            onKeyDown={onKeyDown}
            onClick={(e) => syncFrom(e.currentTarget)}
            rows={2}
            placeholder="Add a comment… **markdown** supported · @mention a teammate · ⌘/Ctrl+Enter to send"
            className="w-full min-h-[3rem] rounded-none border border-border bg-card px-3 py-2 text-sm font-mono resize-y"
          />
          {menuOpen && (
            <ul
              data-testid="mention-menu"
              role="listbox"
              aria-label="Mention suggestions"
              className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-48 overflow-auto border border-border bg-popover shadow-md"
            >
              {suggestions.map((s, i) => (
                <li key={s.token} role="option" aria-selected={i === mentionIdx}>
                  <button
                    type="button"
                    data-testid={`mention-option-${s.token}`}
                    onMouseDown={(e) => e.preventDefault()} // keep textarea focus so the insert lands
                    onClick={() => insertMention(s.token)}
                    className={`w-full text-left px-2 py-1.5 text-sm flex items-center gap-2 ${i === mentionIdx ? "bg-accent" : "hover:bg-accent/60"}`}
                  >
                    <span className="font-mono">@{s.token}</span>
                    {s.label !== s.token && <span className="text-muted-foreground text-xs truncate">{s.label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!body.trim() || add.isPending}
            className="rounded-none uppercase font-bold tracking-wider text-xs h-10"
          >
            Comment
          </Button>
        </div>
      </form>
    </section>
  );
}
