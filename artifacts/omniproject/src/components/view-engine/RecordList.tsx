import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { CHIP_TONE_CLASS, type ViewRecord } from "../../lib/view-engine/types";
import { buildTaskTree, flattenTaskTree } from "../../lib/task-tree";

/**
 * Generic record list — the entity-agnostic list view. Renders any normalised records with a
 * complete/reopen checkbox (driven by the descriptor's closed-status set), the status, metadata
 * chips and an optional priority badge. Used by both tasks and issues through the view engine.
 *
 * SUBTASK TREE (opt-in): when a `parentOf` is supplied, the records are rendered as a fold/unfold tree over
 * that parent link — children indent under their parent and a caret folds a subtree. Fold state is per-user
 * (localStorage, keyed by `treeStorageKey`). Without `parentOf` the list renders exactly as a flat list.
 */
export function RecordList<T>({
  records,
  noun,
  labelForPriority,
  closedStatuses,
  onToggleDone,
  onOpen,
  emptyMessage,
  parentOf,
  treeStorageKey = "record-tree-fold",
}: {
  records: ViewRecord<T>[];
  noun: string;
  labelForPriority: (p: string | null | undefined) => string;
  closedStatuses: string[];
  onToggleDone: (record: ViewRecord<T>) => void;
  onOpen: (record: ViewRecord<T>) => void;
  emptyMessage: string;
  /** OPTIONAL: the parent id of a record (its subtask link). Present ⇒ render a fold/unfold tree. */
  parentOf?: (record: ViewRecord<T>) => string | null | undefined;
  treeStorageKey?: string;
}) {
  const closed = new Set(closedStatuses);
  const [folded, setFolded] = useState<Set<string>>(() => readFolded(treeStorageKey));

  const toggleFold = (id: string): void => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeFolded(treeStorageKey, next);
      return next;
    });
  };

  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid={`${noun}-list-empty`}>{emptyMessage}</p>;
  }

  // Compute the visible rows: a flat list as-is, or a depth-stamped tree walk when `parentOf` is given.
  const byId = new Map(records.map((r) => [r.id, r]));
  const rows: Array<{ record: ViewRecord<T>; depth: number; hasChildren: boolean }> = parentOf
    ? flattenTaskTree(
        buildTaskTree(records.map((r) => ({ id: r.id, parentTaskId: parentOf(r) ?? null }))),
        folded,
      )
        .map((n) => ({ record: byId.get(n.task.id)!, depth: n.depth, hasChildren: n.hasChildren }))
        .filter((r) => r.record)
    : records.map((r) => ({ record: r, depth: 0, hasChildren: false }));

  return (
    <ul className="divide-y divide-border border border-border">
      {rows.map(({ record: r, depth, hasChildren }) => {
        const isClosed = closed.has(r.status);
        return (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2" style={depth ? { paddingLeft: `${0.75 + depth * 1.25}rem` } : undefined}>
            {parentOf && (
              hasChildren ? (
                <button type="button" aria-label={folded.has(r.id) ? `Expand ${r.title}` : `Collapse ${r.title}`} onClick={() => toggleFold(r.id)} className="text-muted-foreground hover:text-foreground">
                  {folded.has(r.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              ) : (
                <span className="w-3.5" aria-hidden="true" />
              )
            )}
            <input
              type="checkbox"
              aria-label={isClosed ? `Reopen ${r.title}` : `Complete ${r.title}`}
              checked={isClosed}
              onChange={() => onToggleDone(r)}
            />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpen(r)} className={`text-sm text-left hover:underline ${isClosed ? "line-through text-muted-foreground" : ""}`}>{r.title}</button>
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground mt-0.5">
                <span className="uppercase tracking-wider">{r.status}</span>
                {r.chips.map((c, i) => (
                  <span key={i} className={[c.mono ? "font-mono" : "", c.tone ? CHIP_TONE_CLASS[c.tone] : ""].filter(Boolean).join(" ") || undefined}>{c.text}</span>
                ))}
              </div>
            </div>
            {r.priority && r.priority !== "none" && (
              <span className="text-[10px] uppercase tracking-widest border border-border px-1.5 py-0.5">{labelForPriority(r.priority)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Read the folded-id set from localStorage (empty + safe when unavailable or malformed). */
function readFolded(key: string): Set<string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch { return new Set(); }
}

/** Persist the folded-id set (best-effort). */
function writeFolded(key: string, folded: Set<string>): void {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify([...folded])); } catch { /* ignore */ }
}
