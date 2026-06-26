import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTaskItems,
  useCreateTaskItem,
  useGetCapabilities,
  getListTaskItemsQueryKey,
  type TaskItemInput,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { canSurfaceEntity, canStoreEntity } from "../lib/capabilities-fields";

const KIND_LABEL: Record<string, string> = { issue: "Issue", note: "Note" };

/**
 * The child issues & notes raised against a task (#94 backend). Only renders when
 * the backend can surface them; the add form offers only the kinds it can store.
 */
export function TaskItemsPanel({ projectId, taskId }: { projectId: string; taskId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: caps } = useGetCapabilities();

  const canSurface = canSurfaceEntity(caps, "issue", false) || canSurfaceEntity(caps, "note", false);
  const storableKinds = (["issue", "note"] as const).filter((k) => canStoreEntity(caps, k, false));

  const { data: items } = useListTaskItems(projectId, taskId, {
    query: { enabled: canSurface, queryKey: getListTaskItemsQueryKey(projectId, taskId) },
  });
  const create = useCreateTaskItem();
  const [kind, setKind] = useState<string>("");
  const [content, setContent] = useState("");

  if (!canSurface) return null;
  const activeKind = kind || storableKinds[0] || "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !activeKind) return;
    const data: TaskItemInput = { kind: activeKind as TaskItemInput["kind"], content: content.trim() };
    create.mutate(
      { projectId, issueId: taskId, data },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListTaskItemsQueryKey(projectId, taskId) });
          setContent("");
          toast({ title: `${KIND_LABEL[activeKind] ?? "Item"} added` });
        },
        onError: () => toast({ title: "ERROR", description: "Could not add it.", variant: "destructive" }),
      },
    );
  };

  return (
    <section data-testid="task-items" className="border-t border-border pt-4 mt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Issues &amp; Notes</h3>

      <ul className="space-y-1.5">
        {(items ?? []).length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
        {(items ?? []).map((it) => (
          <li key={it.id} className="text-sm border border-border p-2 flex items-start gap-2">
            <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 ${it.kind === "issue" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
              {KIND_LABEL[it.kind] ?? it.kind}
            </span>
            <span className="flex-1">
              {it.content}
              {it.author && <span className="block text-[11px] text-muted-foreground mt-0.5">— {it.author}</span>}
            </span>
          </li>
        ))}
      </ul>

      {storableKinds.length > 0 ? (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          {storableKinds.length > 1 ? (
            <Select value={activeKind} onValueChange={setKind}>
              <SelectTrigger aria-label="Kind" className="w-28 rounded-none border-border h-10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="rounded-none border-border">
                {storableKinds.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs font-bold uppercase text-muted-foreground">{KIND_LABEL[activeKind]}</span>
          )}
          <Input
            aria-label="New item content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={activeKind === "issue" ? "Describe the issue…" : "Add a note…"}
            className="flex-1 min-w-40 rounded-none border-border h-10 font-mono"
          />
          <Button type="submit" disabled={!content.trim() || create.isPending}
            className="rounded-none uppercase font-bold tracking-wider text-xs h-10">Add</Button>
        </form>
      ) : (
        <p className="text-[11px] text-muted-foreground">This backend surfaces these but can't store new ones.</p>
      )}
    </section>
  );
}
