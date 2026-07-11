import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useComments, useAddComment, useDeleteComment } from "../../lib/comments";

/**
 * Comment thread on a work item (the "comments" feature module). Reads/writes the shared-state-backed
 * `/api/comments/:roomId` endpoint keyed by the `issue:<projectId>:<issueId>` room id. `@mentions` in
 * the body are parsed server-side and notify the mentioned user over the notification stream — the
 * input is plain text, no client parsing needed. Delete is offered on every comment; the server
 * enforces "author or pmo/admin".
 */
export function CommentsPanel({ projectId, issueId }: { projectId: string; issueId: string }) {
  const roomId = `issue:${projectId}:${issueId}`;
  const { toast } = useToast();
  const { data: comments } = useComments(roomId);
  const add = useAddComment(roomId);
  const del = useDeleteComment(roomId);
  const [body, setBody] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim(), {
      onSuccess: () => setBody(""),
      onError: (err) => toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not add the comment.", variant: "destructive" }),
    });
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
            <span className="flex-1">
              {c.body}
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

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment… @mention a teammate"
          className="flex-1 min-w-40 rounded-none border-border h-10"
        />
        <Button
          type="submit"
          disabled={!body.trim() || add.isPending}
          className="rounded-none uppercase font-bold tracking-wider text-xs h-10"
        >
          Comment
        </Button>
      </form>
    </section>
  );
}
