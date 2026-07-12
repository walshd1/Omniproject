import { useMemo, useState } from "react";
import type { BoardColumn, ViewRecord } from "../../lib/view-engine/types";

/**
 * Generic kanban-style board — the entity-agnostic engine behind both the issue Kanban and the task
 * GTD board. Columns are supplied by the caller (a column preset), so the SAME board renders a GTD
 * workflow, a scrum flow, or a plain status kanban with no code change. Drag a card between columns
 * to change its status, or use the per-card selector (keyboard-accessible). Any status not covered
 * by the preset still gets its own trailing column rather than being dropped.
 */
export function RecordBoard<T>({
  records,
  columns,
  noun,
  labelForPriority,
  onMove,
  onOpen,
}: {
  records: ViewRecord<T>[];
  columns: BoardColumn[];
  noun: string;
  labelForPriority: (p: string | null | undefined) => string;
  onMove: (record: ViewRecord<T>, status: string) => void;
  onOpen: (record: ViewRecord<T>) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const cols = useMemo(() => {
    const known = new Set(columns.map((c) => c.status));
    const extra = [...new Set(records.map((r) => r.status).filter((s) => s && !known.has(s)))];
    return [...columns, ...extra.map((s) => ({ status: s, label: s }))];
  }, [columns, records]);

  const move = (record: ViewRecord<T>, status: string) => {
    if (record.status !== status) onMove(record, status);
  };

  return (
    <div className="flex gap-4 h-full min-w-max pb-4" data-testid="record-board">
      {cols.map((col) => {
        const cards = records.filter((r) => r.status === col.status);
        return (
          <div
            key={col.status}
            className="w-72 flex flex-col bg-card border border-border"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { const r = records.find((x) => x.id === dragId); if (r) move(r, col.status); setDragId(null); }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-black uppercase tracking-wider">{col.label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-2" aria-label={col.label}>
              {cards.map((r) => (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  className="border border-border bg-background px-2 py-2 space-y-1"
                >
                  <button type="button" onClick={() => onOpen(r)} className="text-sm text-left hover:underline block w-full">{r.title}</button>
                  {(r.chips.length > 0 || (r.priority && r.priority !== "none")) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      {r.chips.map((c, i) => (
                        <span key={i} className={c.mono ? "font-mono" : undefined}>{i > 0 ? "· " : ""}{c.text}</span>
                      ))}
                      {r.priority && r.priority !== "none" && <span className="uppercase border border-border px-1">{labelForPriority(r.priority)}</span>}
                    </div>
                  )}
                  <select
                    aria-label={`Move ${r.title}`}
                    className="w-full rounded-none border border-border bg-card px-1 py-0.5 text-[11px]"
                    value={r.status}
                    onChange={(e) => move(r, e.target.value)}
                  >
                    {cols.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                  </select>
                </div>
              ))}
              {cards.length === 0 && <p className="text-[11px] text-muted-foreground px-1 py-2">—</p>}
            </div>
          </div>
        );
      })}
      {cols.length === 0 && <p className="text-sm text-muted-foreground p-4">No {noun}s to show.</p>}
    </div>
  );
}
