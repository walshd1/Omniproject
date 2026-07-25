import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { CHIP_TONE_CLASS, type BoardColumn, type ViewRecord } from "../../lib/view-engine/types";

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
  labelForStatus,
  onMove,
  onOpen,
  onCreate,
}: {
  records: ViewRecord<T>[];
  columns: BoardColumn[];
  noun: string;
  labelForPriority: (p: string | null | undefined) => string;
  /** OPTIONAL: labels the trailing (backend-derived) columns not covered by the preset. */
  labelForStatus?: (s: string | null | undefined) => string;
  onMove: (record: ViewRecord<T>, status: string) => void;
  onOpen: (record: ViewRecord<T>) => void;
  /** OPTIONAL: create a new record seeded with a column's status — enables the per-column "+" and the
   *  empty-column "+ Add" affordance. Omitted → the board is read/move-only (no create UI). */
  onCreate?: (status: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  const cols = useMemo<BoardColumn[]>(() => {
    const known = new Set(columns.map((c) => c.status));
    const extra = [...new Set(records.map((r) => r.status).filter((s) => s && !known.has(s)))];
    return [...columns, ...extra.map((s) => ({ status: s, label: labelForStatus ? labelForStatus(s) : s }))];
  }, [columns, records, labelForStatus]);

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
            <div
              className="flex items-center justify-between px-3 py-2 border-b border-border"
              style={col.color ? { borderTopWidth: 3, borderTopStyle: "solid", borderTopColor: col.color } : undefined}
            >
              <span className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                {col.color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} aria-hidden="true" />}
                {col.label}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-muted-foreground">{cards.length}</span>
                {onCreate && (
                  <button
                    type="button"
                    onClick={() => onCreate(col.status)}
                    className="text-muted-foreground hover:text-primary"
                    title={`New ${noun} in ${col.label}`}
                    aria-label={`New ${noun} in ${col.label}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
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
                        <span key={i} className={[c.mono ? "font-mono" : "", !c.color && c.tone ? CHIP_TONE_CLASS[c.tone] : ""].filter(Boolean).join(" ") || undefined} style={c.color ? { color: c.color } : undefined}>{i > 0 ? "· " : ""}{c.text}</span>
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
              {cards.length === 0 && (
                onCreate ? (
                  <button
                    type="button"
                    onClick={() => onCreate(col.status)}
                    className="text-[11px] text-muted-foreground/60 border border-dashed border-border py-6 hover:border-primary hover:text-primary transition-colors uppercase tracking-widest"
                  >
                    + Add
                  </button>
                ) : (
                  <p className="text-[11px] text-muted-foreground px-1 py-2">—</p>
                )
              )}
            </div>
          </div>
        );
      })}
      {cols.length === 0 && <p className="text-sm text-muted-foreground p-4">No {noun}s to show.</p>}
    </div>
  );
}
