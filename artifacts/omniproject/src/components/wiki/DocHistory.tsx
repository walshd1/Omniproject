import { useState } from "react";
import { Button } from "@/components/ui/button";
import { History, RotateCcw, X } from "lucide-react";
import { useWikiDocVersions, useWikiDocVersion, type WikiDoc, type WikiDocVersion } from "../../lib/wiki";
import { diffDocBlocks, summarizeDiff, type BlockDiffStatus } from "../../lib/wiki-diff";
import { DocRenderer } from "./DocRenderer";

/**
 * DocHistory — the version-history panel for a wiki document (roadmap 2.1 slice 5). Lists the document's
 * saved revisions (newest first) from the backend through the broker seam; selecting one shows a structural
 * diff of what changed BETWEEN that revision and the current document, and (for authors) offers a one-click
 * restore. Restore is not a special power: it re-saves the current document with the chosen revision's
 * content through the ordinary update path, so it passes the same sanitising choke point and RBAC gate as any
 * edit — and itself becomes a new revision. When the backend doesn't retain history the list errors (501)
 * and the panel says so.
 */
const STATUS_LABEL: Record<BlockDiffStatus, string> = { added: "Added", removed: "Removed", changed: "Changed", unchanged: "Unchanged" };
const STATUS_CLASS: Record<BlockDiffStatus, string> = {
  added: "border-green-400 bg-green-50 dark:bg-green-950/30",
  removed: "border-red-400 bg-red-50 dark:bg-red-950/30 line-through opacity-70",
  changed: "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
  unchanged: "border-border",
};

export function DocHistory({ docId, current, canRestore, restoring, onRestore, onClose }: {
  docId: string;
  current: WikiDoc;
  canRestore: boolean;
  restoring?: boolean;
  onRestore: (version: WikiDocVersion) => void;
  onClose: () => void;
}) {
  const versionsQ = useWikiDocVersions(docId);
  const [selectedId, setSelectedId] = useState("");
  const versionQ = useWikiDocVersion(docId, selectedId || undefined);

  const versions = Array.isArray(versionsQ.data) ? versionsQ.data : [];
  const selected = versionQ.data;
  // Changes BETWEEN the selected revision and the current document ("what changed since this revision").
  const diff = selected ? diffDocBlocks(selected.blocks, current.blocks) : [];
  const changed = diff.filter((d) => d.status !== "unchanged");
  const tally = summarizeDiff(diff);
  const titleChanged = !!selected && selected.title !== current.title;

  return (
    <aside className="border border-border rounded p-3 space-y-3" data-testid="doc-history">
      <header className="flex items-center gap-2">
        <History className="h-4 w-4" />
        <h3 className="text-xs font-black uppercase tracking-widest flex-1">Version history</h3>
        <button type="button" aria-label="Close history" data-testid="history-close" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </header>

      {versionsQ.isError ? (
        <p className="text-xs text-muted-foreground" data-testid="history-unavailable">History is not available for this document.</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="history-empty">No saved revisions yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-3">
          <ul className="space-y-1" data-testid="history-list">
            {versions.map((v) => (
              <li key={v.versionId}>
                <button type="button" data-testid={`history-version-${v.versionId}`} onClick={() => setSelectedId(v.versionId)}
                  className={`w-full text-left text-xs px-2 py-1 rounded border ${v.versionId === selectedId ? "border-foreground bg-muted font-bold" : "border-border hover:bg-muted/50"}`}>
                  <span className="block truncate">{v.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{new Date(v.at).toLocaleString()}{v.author ? ` · ${v.author}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0" data-testid="history-detail">
            {!selected ? (
              <p className="text-xs text-muted-foreground">Select a revision to see what changed since — and to restore it.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] text-muted-foreground flex-1" data-testid="history-diff-summary">
                    Since this revision: {tally.added} added · {tally.changed} changed · {tally.removed} removed
                  </p>
                  {canRestore && (
                    <Button type="button" size="sm" variant="outline" data-testid="history-restore" disabled={restoring} onClick={() => onRestore(selected)}>
                      <RotateCcw className="h-3 w-3 mr-1" />{restoring ? "Restoring…" : "Restore this revision"}
                    </Button>
                  )}
                </div>

                {titleChanged && (
                  <p className="text-[11px]" data-testid="history-title-change">
                    Title: <span className="line-through opacity-70">{selected.title}</span> → <span className="font-bold">{current.title}</span>
                  </p>
                )}

                {changed.length === 0 && !titleChanged ? (
                  <p className="text-xs text-muted-foreground" data-testid="history-no-change">This revision matches the current document.</p>
                ) : (
                  <ul className="space-y-1" data-testid="history-diff">
                    {changed.map((d, i) => (
                      <li key={`${d.block.id}-${i}`} className={`rounded border p-2 ${STATUS_CLASS[d.status]}`}>
                        <span className="block text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{STATUS_LABEL[d.status]} · {d.block.type}</span>
                        <div className="text-sm"><DocRenderer blocks={[d.block]} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
