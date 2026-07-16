import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PenTool, Plus, Trash2, Save, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../lib/auth";
import type { CanvasElement } from "@workspace/backend-catalogue";
import {
  useWhiteboards, useWhiteboard, useCreateWhiteboard, useSaveWhiteboard, useDeleteWhiteboard,
  type WhiteboardStorage,
} from "../lib/whiteboard";
import { CanvasEditor, type CanvasEditorHandle } from "../components/whiteboard/CanvasEditor";
import { sceneBounds, toExportSvg, svgToPngBlob, downloadBlob, exportFileStem } from "../lib/whiteboard-export";

/**
 * Whiteboards — the visual-canvas page (roadmap 2.3). Browse boards, open one into the native SVG editor
 * (built of our `canvas` primitives), export it as SVG/PNG (client-side, nothing uploaded), and save to a
 * chosen STORAGE TARGET (all AES-256-GCM sealed at rest):
 *   - Personal — the author's private encrypted-JSON area (only they see it),
 *   - Org-wide — the shared encrypted-JSON area (writing needs manager+),
 *   - Built-in store — the sidecar system-of-record, when it's loaded.
 * The returned id is self-describing, so a later read/write routes to the right store. Authoring under the
 * RBAC ladder: read for viewer+, create/edit/delete for contributor+ (an org write additionally needs
 * manager+). A short human label per target keeps the choice legible.
 */
/** The label shown on a board's storage badge / in a toast. */
const STORAGE_LABEL: Record<WhiteboardStorage, string> = {
  user: "Personal", project: "Project", org: "Org-wide", sidecar: "Built-in store",
};
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
  const [newStorage, setNewStorage] = useState<WhiteboardStorage>("user");
  const editorRef = useRef<CanvasEditorHandle>(null);
  useEffect(() => {
    if (boardQ.data) { setElements(boardQ.data.scene.elements ?? []); setDirty(false); }
  }, [boardQ.data]);

  const onChange = (next: CanvasElement[]) => { setElements(next); setDirty(true); };

  const onCreate = () => create.mutate(
    { name: "Untitled board", scene: { elements: [] }, storage: newStorage },
    {
      onSuccess: (b) => { setBoardId(b.id); toast({ title: "WHITEBOARD CREATED", description: `Saved to ${STORAGE_LABEL[newStorage]}` }); },
      onError: (e) => toast({ title: "COULD NOT CREATE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    },
  );
  const onSave = () => {
    if (!boardQ.data) return;
    save.mutate(
      // The storage target is fixed by the board's self-describing id, so the server ignores it on update.
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
  // Export the open board — SVG (vector) or PNG (raster). Purely client-side (nothing leaves the browser).
  const onExport = async (format: "svg" | "png") => {
    const svg = editorRef.current?.getSvg();
    if (!svg || !boardQ.data) return;
    const stem = exportFileStem(boardQ.data.name);
    try {
      const markup = toExportSvg(svg, elements);
      if (format === "svg") {
        downloadBlob(`${stem}.svg`, new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
      } else {
        downloadBlob(`${stem}.png`, await svgToPngBlob(markup, sceneBounds(elements)));
      }
    } catch (e) {
      toast({ title: "COULD NOT EXPORT", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
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
              <div className="flex items-center gap-1">
                <select aria-label="New board storage target" data-testid="whiteboard-storage" value={newStorage} onChange={(e) => setNewStorage(e.target.value as WhiteboardStorage)}
                  className="h-8 border border-border bg-background text-xs px-1">
                  <option value="user">Personal</option>
                  {canDelete && <option value="org">Org-wide</option>}
                  <option value="sidecar">Built-in store</option>
                </select>
                <Button type="button" variant="outline" size="sm" data-testid="whiteboard-new" disabled={create.isPending} onClick={onCreate}>
                  <Plus className="h-3 w-3 mr-1" />New
                </Button>
              </div>
            )}
          </aside>

          <section className="min-w-0" data-testid="whiteboards-main">
            {boardQ.data ? (
              <div className="space-y-2">
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold min-w-0">{boardQ.data.name}</h2>
                  <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-border text-muted-foreground flex-1-none" data-testid="whiteboard-storage-badge">
                    {STORAGE_LABEL[boardQ.data.storage ?? "user"]}
                  </span>
                  <span className="flex-1" />
                  {/* Export is available to anyone who can see the board (incl. viewers) — it's purely client-side. */}
                  <Button type="button" variant="outline" size="sm" data-testid="whiteboard-export-svg" onClick={() => onExport("svg")}><Download className="h-3 w-3 mr-1" />SVG</Button>
                  <Button type="button" variant="outline" size="sm" data-testid="whiteboard-export-png" onClick={() => onExport("png")}><Download className="h-3 w-3 mr-1" />PNG</Button>
                  {canAuthor && <Button type="button" size="sm" data-testid="whiteboard-save" disabled={!dirty || save.isPending} onClick={onSave}><Save className="h-3 w-3 mr-1" />{save.isPending ? "Saving…" : "Save"}</Button>}
                  {/* Delete is contributor+ for personal/project/sidecar boards; an org-wide board additionally needs manager+. */}
                  {canAuthor && (boardQ.data.storage !== "org" || canDelete) &&
                    <Button type="button" variant="ghost" size="sm" data-testid="whiteboard-delete" disabled={del.isPending} onClick={onDelete}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>}
                </header>
                <CanvasEditor ref={editorRef} elements={elements} onChange={onChange} readOnly={!canAuthor} />
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
