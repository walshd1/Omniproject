import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTaskComments, useAddComment, useTaskAttachments, useAddAttachment, useUpdateTask, PRIORITIES, type Task } from "../lib/tasks";
import { usePriorityLabels } from "../lib/priority-labels";
import { TaskNotes } from "./TaskNotes";
import { TagEditor } from "./TagEditor";
import { TaskSubtasks } from "./TaskSubtasks";
import { TaskRecurrence } from "./TaskRecurrence";

/**
 * Task detail — the fields plus the discussion thread and file attachment REFERENCES for one task,
 * over the existing /api/tasks/:id/(comments|attachments) endpoints. Attachments are references
 * (filename + URL), never bytes; if the backend can't store them the add just reports so.
 */
export function TaskDetailDialog({ task, open, onOpenChange }: { task: Task | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const id = task?.id ?? "";
  const { toast } = useToast();
  const { data: comments = [] } = useTaskComments(id, open && !!id);
  const addComment = useAddComment(id);
  const { data: attachments = [] } = useTaskAttachments(id, open && !!id);
  const addAttachment = useAddAttachment(id);
  const updateTask = useUpdateTask();
  const { labelFor } = usePriorityLabels();
  const [comment, setComment] = useState("");
  const [fname, setFname] = useState("");
  const [furl, setFurl] = useState("");

  if (!task) return null;

  const postComment = () => {
    if (!comment.trim()) return;
    addComment.mutate(comment.trim(), { onSuccess: () => setComment("") });
  };
  const postAttachment = () => {
    if (!fname.trim()) return;
    addAttachment.mutate({ filename: fname.trim(), ...(furl.trim() ? { url: furl.trim() } : {}) }, {
      onSuccess: () => { setFname(""); setFurl(""); },
      onError: (e) => toast({ title: "COULDN'T ATTACH", description: e instanceof Error ? e.message : "This backend may not support attachments.", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-none border-border max-w-2xl">
        <DialogHeader><DialogTitle className="uppercase tracking-tight">{task.title}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-auto">
          {/* Fields */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider border border-border px-1.5 py-0.5">{task.status}</span>
            {task.context && <span className="font-mono border border-border px-1.5 py-0.5">{task.context}</span>}
            {task.assignee && <span className="border border-border px-1.5 py-0.5">{task.assignee}</span>}
            {task.dueDate && <span className="border border-border px-1.5 py-0.5">due {task.dueDate}</span>}
            <label className="flex items-center gap-1">
              <span className="uppercase tracking-widest">Priority</span>
              <select
                aria-label="Priority"
                className="rounded-none border border-border bg-card px-1.5 py-0.5 text-[11px]"
                value={(task.priority as string) || "none"}
                onChange={(e) => updateTask.mutate({ id: task.id, patch: { priority: e.target.value } })}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p === "none" ? "none" : labelFor(p)}</option>)}
              </select>
            </label>
          </div>
          {/* Rich (markdown-lite) notes — the stored `description` string, rendered + inline-editable. */}
          <TaskNotes
            value={task.description ?? ""}
            saving={updateTask.isPending}
            onSave={(next) => updateTask.mutate({ id: task.id, patch: { description: next } })}
          />

          {/* Per-user tag colour + hierarchy overlay (personal, localStorage). */}
          <TagEditor tags={task.tags ?? []} />

          {/* Subtasks — create children + re-parent this task (builds the tree the list view renders). */}
          <TaskSubtasks task={task} />

          {/* Repeat — authoring for the server-side recurrence engine. */}
          <TaskRecurrence task={task} />

          {/* Comments */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Comments</h3>
            <ul className="space-y-2">
              {comments.length === 0 && <li className="text-xs text-muted-foreground">No comments yet.</li>}
              {comments.map((c) => (
                <li key={c.id} className="border border-border px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.author ?? "—"} · {c.createdAt.slice(0, 10)}</div>
                  <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input className="flex-1 rounded-none border border-border bg-card px-3 py-2 text-sm" placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") postComment(); }} />
              <Button className="rounded-none" onClick={postComment} disabled={!comment.trim() || addComment.isPending}>Post</Button>
            </div>
          </div>

          {/* Attachments (references) */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Attachments</h3>
            <ul className="space-y-1">
              {attachments.length === 0 && <li className="text-xs text-muted-foreground">No attachments.</li>}
              {attachments.map((a) => (
                <li key={a.id} className="text-sm flex items-center gap-2">
                  {a.url ? <a href={a.url} className="text-primary underline" target="_blank" rel="noreferrer">{a.filename}</a> : <span>{a.filename}</span>}
                  {a.contentType && <span className="text-[10px] text-muted-foreground">{a.contentType}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className="flex-1 min-w-[8rem] rounded-none border border-border bg-card px-3 py-2 text-sm" placeholder="filename" value={fname} onChange={(e) => setFname(e.target.value)} />
              <input className="flex-1 min-w-[8rem] rounded-none border border-border bg-card px-3 py-2 text-sm" placeholder="https://…" value={furl} onChange={(e) => setFurl(e.target.value)} />
              <Button className="rounded-none" variant="outline" onClick={postAttachment} disabled={!fname.trim() || addAttachment.isPending}>Attach</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
