import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  downloadAttachment,
  formatBytes,
} from "../../lib/attachments";

/**
 * Attachment list on any shared surface (the "attachments" feature module). Reads/writes the
 * `/api/attachments/:roomId` endpoint keyed by the caller-supplied room id (`issue:<projectId>:<issueId>`).
 * The gateway holds only a byte-free pointer; the bytes live in the attachments-broker sidecar. Upload and
 * download move the bytes browser↔sidecar DIRECTLY (via gateway-minted tickets) — the gateway never sees
 * them. Delete is offered on every row; the server enforces "uploader or pmo/admin". Room-agnostic — the
 * same server RBAC applies.
 */
export function AttachmentsPanel({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const { data: attachments } = useAttachments(roomId);
  const upload = useUploadAttachment(roomId);
  const del = useDeleteAttachment(roomId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const send = (file: File | undefined | null) => {
    if (!file) return;
    upload.mutate(file, {
      onError: (err) => toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not upload the file.", variant: "destructive" }),
    });
  };

  const remove = (id: string) =>
    del.mutate(id, {
      onError: (err) => toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not delete it.", variant: "destructive" }),
    });

  const download = (att: { id: string; filename: string }) =>
    void downloadAttachment(roomId, att).catch((err) =>
      toast({ title: "ERROR", description: err instanceof Error ? err.message : "Could not download the file.", variant: "destructive" }),
    );

  return (
    <section data-testid="attachments" className="border-t border-border pt-4 mt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Attachments</h3>

      <ul className="space-y-1.5">
        {(attachments ?? []).length === 0 && <li className="text-xs text-muted-foreground">No attachments yet.</li>}
        {(attachments ?? []).map((a) => (
          <li key={a.id} className="text-sm border border-border p-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => download(a)}
              className="flex-1 min-w-0 text-left truncate font-semibold hover:text-primary hover:underline"
              title={`Download ${a.filename}`}
            >
              {a.filename}
              <span className="block text-[11px] text-muted-foreground font-normal">
                {formatBytes(a.size)} · {a.author.label} · {new Date(a.createdAt).toLocaleString()}
              </span>
            </button>
            <button
              type="button"
              onClick={() => remove(a.id)}
              aria-label="Delete attachment"
              className="shrink-0 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 text-muted-foreground hover:text-destructive"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {/* Drop zone + a real button that opens the (keyboard-accessible) file picker. The <input> is the
          accessible fallback for the drag-drop, which has no click handler (so the a11y guard is satisfied). */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); send(e.dataTransfer.files?.[0]); }}
        className={`flex items-center justify-between gap-2 border border-dashed p-3 ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <span className="text-xs text-muted-foreground">Drop a file here, or</span>
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="rounded-none uppercase font-bold tracking-wider text-xs h-9"
        >
          {upload.isPending ? "Uploading…" : "Choose file"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          aria-label="Upload attachment"
          className="sr-only"
          onChange={(e) => { send(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>
    </section>
  );
}
