import { CHIP_TONE_CLASS, type ViewRecord } from "../../lib/view-engine/types";

/**
 * Generic record list — the entity-agnostic list view. Renders any normalised records with a
 * complete/reopen checkbox (driven by the descriptor's closed-status set), the status, metadata
 * chips and an optional priority badge. Used by both tasks and issues through the view engine.
 */
export function RecordList<T>({
  records,
  noun,
  labelForPriority,
  closedStatuses,
  onToggleDone,
  onOpen,
  emptyMessage,
}: {
  records: ViewRecord<T>[];
  noun: string;
  labelForPriority: (p: string | null | undefined) => string;
  closedStatuses: string[];
  onToggleDone: (record: ViewRecord<T>) => void;
  onOpen: (record: ViewRecord<T>) => void;
  emptyMessage: string;
}) {
  const closed = new Set(closedStatuses);
  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid={`${noun}-list-empty`}>{emptyMessage}</p>;
  }
  return (
    <ul className="divide-y divide-border border border-border">
      {records.map((r) => {
        const isClosed = closed.has(r.status);
        return (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
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
