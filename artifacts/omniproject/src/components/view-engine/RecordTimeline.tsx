import { useMemo } from "react";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07" → "Jul 2026"; null if the value isn't a usable date. Bucketed in UTC so date-only
 *  values (UTC midnight) don't slip a month for viewers west of UTC. */
function monthBucket(v: string | null | undefined): { key: string; label: string } | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}` };
}

/**
 * Generic timeline view kind — buckets records by the month of a chosen date field and lays the
 * buckets out left-to-right as a simple time axis. Descriptor-driven (any `isDate` field), so tasks
 * and issues share it. Records with no/!parseable date collect in a trailing "No date" column.
 */
export function RecordTimeline<T>({
  records,
  field,
  noun,
  labelForPriority,
  onOpen,
}: {
  records: ViewRecord<T>[];
  field: EntityField<T> | undefined;
  noun: string;
  labelForPriority: (p: string | null | undefined) => string;
  onOpen: (record: ViewRecord<T>) => void;
}) {
  const columns = useMemo(() => {
    if (!field) return [];
    const buckets = new Map<string, { label: string; records: ViewRecord<T>[] }>();
    const undated: ViewRecord<T>[] = [];
    for (const r of records) {
      const b = monthBucket(field.get(r.raw));
      if (!b) { undated.push(r); continue; }
      (buckets.get(b.key) ?? buckets.set(b.key, { label: b.label, records: [] }).get(b.key)!).records.push(r);
    }
    const ordered = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    if (undated.length) ordered.push({ label: "No date", records: undated });
    return ordered;
  }, [records, field]);

  if (!field) return <p className="text-sm text-muted-foreground">Pick a date field to build a timeline.</p>;

  return (
    <div className="flex gap-4 h-full min-w-max pb-4" data-testid="record-timeline">
      {columns.map((col) => (
        <div key={col.label} className="w-64 flex flex-col bg-card border border-border">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-black uppercase tracking-wider">{col.label}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{col.records.length}</span>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-2" aria-label={col.label}>
            {col.records.map((r) => (
              <div key={r.id} className="border border-border bg-background px-2 py-2 space-y-1">
                <button type="button" onClick={() => onOpen(r)} className="text-sm text-left hover:underline block w-full">{r.title}</button>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="uppercase tracking-wider">{r.status}</span>
                  {r.priority && r.priority !== "none" && <span className="uppercase border border-border px-1">{labelForPriority(r.priority)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {columns.length === 0 && <p className="text-sm text-muted-foreground p-4">No {noun}s to place.</p>}
    </div>
  );
}
