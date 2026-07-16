import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PenTool, Plus, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../lib/auth";
import type { CanvasElement } from "@workspace/backend-catalogue";
import {
  useWhiteboards, useWhiteboard, useCreateWhiteboard, useSaveWhiteboard, useDeleteWhiteboard,
} from "../lib/whiteboard";
import { CanvasEditor } from "../components/whiteboard/CanvasEditor";

/**
 * Whiteboards — the visual-canvas page (roadmap 2.3 slice 2). Browse boards, open one into the native SVG
 * editor (built of our `canvas` primitives), and save through the broker seam (zero-at-rest). Authoring under
 * the existing RBAC ladder: read for viewer+, create/edit for contributor+, delete for manager+. When the
 * connected backend has no whiteboard capability the API answers 501 and this page shows an unsupported
 * notice.
 */
export function Whiteboards() {
  const { data: auth } = useAuth();
  const { toast } = useToast();
  const boardsQ = useWhiteboards();
  const [boardId, setBoardId] = useState<string>("");
  const boardQ = useWhiteboard(boardId || undefined);

  const create = useCreateWhiteboard();
  const save = useSaveWhiteboard(boardId);
  const del = useDeleteWhiteboard();

  const canAuthor = roleAtLeast(auth?.role, "contributor");
  const canDelete = roleAtLeast(auth?.role, "manager");
  const unsupported = boardsQ.isError; // routes answer 501 → hook errors when the backend has no whiteboards

  const boards = Array.isArray(boardsQ.data) ? boardsQ.data : [];

  // Working copy of the open board's scene; seeded when a board loads, saved on demand.
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (boardQ.data) { setElements(boardQ.data.scene.elements ?? []); setDirty(false); }
  }, [boardQ.data]);

  const onChange = (next: CanvasElement[]) => { setElements(next); setDirty(true); };

  const onCreate = () => create.mutate(
    { name: "Untitled board", scene: { elements: [] } },
    {
      onSuccess: (b) => { setBoardId(b.id); toast({ title: "WHITEBOARD CREATED" }); },
      onError: (e) => toast({ title: "COULD NOT CREATE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    },
  );
  const onSave = () => {
    if (!boardQ.data) return;
    save.mutate(
      { name: boardQ.data.name, scene: { elements } },
      {
        onSuccess: () => { setDirty(false); toast({ title: "WHITEBOARD SAVED" }); },
        onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
      },
    );
  };
  const onDelete = () => {
    if (!boardId) return;
    del.mutate(boardId, {
      onSuccess: () => { setBoardId(""); setElements([]); toast({ title: "WHITEBOARD DELETED" }); },
      onError: (e) => toast({ title: "COULD NOT DELETE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <div className="p-4 space-y-4" data-testid="whiteboards-page">
      <div className="flex items-center gap-2">
        <PenTool className="h-5 w-5" />
        <h1 className="text-xl font-black uppercase tracking-widest">Whiteboards</h1>
      </div>

      {unsupported ? (
        <p className="text-sm text-muted-foreground" data-testid="whiteboards-unsupported">The connected backend does not provide whiteboards.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[15rem_1fr] gap-4">
          <aside className="space-y-2" data-testid="whiteboards-nav">
            <ul className="space-y-1" data-testid="whiteboards-list">
              {boards.map((b) => (
                <li key={b.id}>
                  <button type="button" data-testid={`board-link-${b.id}`} onClick={() => setBoardId(b.id)}
                    className={`w-full text-left text-sm px-2 py-1 rounded ${b.id === boardId ? "bg-muted font-bold" : "hover:bg-muted/50"}`}>
                    {b.name}
                  </button>
                </li>
              ))}
              {boards.length === 0 && <li className="text-xs text-muted-foreground px-2" data-testid="whiteboards-empty">No whiteboards yet.</li>}
            </ul>
            {canAuthor && (
              <Button type="button" variant="outline" size="sm" data-testid="whiteboard-new" disabled={create.isPending} onClick={onCreate}>
                <Plus className="h-3 w-3 mr-1" />New whiteboard
              </Button>
            )}
          </aside>

          <section className="min-w-0" data-testid="whiteboards-main">
            {boardQ.data ? (
              <div className="space-y-2">
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold flex-1 min-w-0">{boardQ.data.name}</h2>
                  {canAuthor && <Button type="button" size="sm" data-testid="whiteboard-save" disabled={!dirty || save.isPending} onClick={onSave}><Save className="h-3 w-3 mr-1" />{save.isPending ? "Saving…" : "Save"}</Button>}
                  {canDelete && <Button type="button" variant="ghost" size="sm" data-testid="whiteboard-delete" disabled={del.isPending} onClick={onDelete}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>}
                </header>
                <CanvasEditor elements={elements} onChange={onChange} readOnly={!canAuthor} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="whiteboards-no-selection">Select a whiteboard to open, or create one.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
