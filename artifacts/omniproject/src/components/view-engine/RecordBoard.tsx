import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { CHIP_TONE_CLASS, type BoardColumn, type EntityField, type ViewRecord } from "../../lib/view-engine/types";
import { toSwimlanes } from "../../lib/view-engine/swimlane";

/**
 * Generic kanban-style board — the entity-agnostic engine behind both the issue Kanban and the task
 * GTD board. Columns are supplied by the caller (a column preset), so the SAME board renders a GTD
 * workflow, a scrum flow, or a plain status kanban with no code change. Drag a card between columns
 * to change its status, or use the per-card selector (keyboard-accessible). Any status not covered
 * by the preset still gets its own trailing column rather than being dropped.
 *
 * SWIMLANES: when `swimlaneBy` (a field key, the view's `groupBy`) is set, the same columns render once
 * per lane — records split into horizontal lanes by that field, ordered/labelled via the shared
 * `toSwimlanes` helper (the board counterpart to the list view's group-by). Unset → the flat layout.
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
  swimlaneBy,
  fields,
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
  /** OPTIONAL: group records into horizontal swimlanes by this field key (the view's `groupBy`). */
  swimlaneBy?: string;
  /** The entity's fields — needed to resolve the `swimlaneBy` value. Only consulted when swimlaning. */
  fields?: EntityField<T>[];
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

  // Resolve lane labels through the same vocabulary the columns/chips use (status/priority label maps).
  const laneLabel =
    swimlaneBy === "priority" ? (v: string) => labelForPriority(v)
    : swimlaneBy === "status" ? (v: string) => (labelForStatus ? labelForStatus(v) : v)
    : undefined;
  const lanes = useMemo(
    () => (swimlaneBy ? toSwimlanes(records, swimlaneBy, fields ?? [], laneLabel) : []),
    // laneLabel is derived from swimlaneBy + the label maps (stable per render); keying on swimlaneBy is enough.
    [records, swimlaneBy, fields], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** One horizontal row of columns over a given record subset (the whole board, or one swimlane). */
  const renderColumns = (scoped: ViewRecord<T>[], testId?: string) => (
    <div className="flex gap-4 h-full min-w-max pb-4" {...(testId ? { "data-testid": testId } : {})}>
      {cols.map((col) => {
        const cards = scoped.filter((r) => r.status === col.status);
        // WIP limit: a column over its limit flags the count red and rings the column (a standard kanban cue).
        const overWip = col.wip != null && cards.length > col.wip;
        return (
          <div
            key={col.status}
            className={`w-72 flex flex-col bg-card border border-border${overWip ? " ring-1 ring-inset ring-red-500/60" : ""}`}
            data-testid={overWip ? `board-col-over-wip-${col.status}` : undefined}
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
                <span
                  className={`text-[10px] tabular-nums ${overWip ? "text-red-600 font-black" : "text-muted-foreground"}`}
                  {...(col.wip != null
                    ? { title: `${cards.length} of ${col.wip} WIP limit`, "aria-label": `${col.label}: ${cards.length} of ${col.wip}${overWip ? ", over WIP limit" : ""}` }
                    : {})}
                >
                  {cards.length}{col.wip != null ? ` / ${col.wip}` : ""}
                </span>
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

  // Swimlanes on → the same columns rendered once per lane; off → the flat single-row board.
  if (lanes.length > 0) {
    return (
      <div className="space-y-6" data-testid="record-board">
        {lanes.map((lane) => (
          <div key={lane.key} data-testid={`swimlane-${lane.key}`} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
              <span>{lane.label}</span>
              <span className="tabular-nums opacity-70">{lane.records.length}</span>
            </div>
            {renderColumns(lane.records)}
          </div>
        ))}
      </div>
    );
  }
  return renderColumns(records, "record-board");
}
