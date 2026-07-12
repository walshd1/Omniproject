import { useMemo, useState } from "react";
import type { EntityDescriptor, ViewKind, ViewRecord, ViewScope } from "../../lib/view-engine/types";
import { RecordBoard } from "./RecordBoard";
import { RecordList } from "./RecordList";

/**
 * The view engine's entry point: given an entity descriptor, render its records through whichever
 * view the user selects — a list, or any of the descriptor's board column-presets (GTD, kanban, …).
 * Tasks and issues use this identically; the engine never knows which entity it's showing. GTD is
 * just one selectable board preset here, not a special mode.
 */
export function EntityViews<T>({
  descriptor,
  scope = {},
  onOpen,
}: {
  descriptor: EntityDescriptor<T>;
  scope?: ViewScope;
  onOpen: (record: ViewRecord<T>) => void;
}) {
  const { records, isLoading, error } = descriptor.useRecords(scope);
  const move = descriptor.useMove();
  const labelForPriority = descriptor.usePriorityLabel();
  const [view, setView] = useState<ViewKind>("list");
  const [filter, setFilter] = useState<string>("all");

  const preset = descriptor.presets.find((p) => p.id === view);
  const shown = useMemo(
    () => (filter === "all" ? records : records.filter((r) => r.status === filter)),
    [records, filter],
  );

  const toggleDone = (r: ViewRecord<T>) =>
    move(r, descriptor.closedStatuses.includes(r.status) ? descriptor.reopenStatus : descriptor.doneStatus);

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs uppercase tracking-wider font-semibold border-r border-border last:border-r-0 ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="space-y-4">
      {/* View switcher — List plus one tab per board preset. */}
      <div className="inline-flex border border-border" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")} className={tabClass(view === "list")}>List</button>
        {descriptor.presets.map((p) => (
          <button key={p.id} role="tab" aria-selected={view === p.id} onClick={() => setView(p.id)} className={tabClass(view === p.id)}>{p.label}</button>
        ))}
      </div>

      {preset ? (
        <RecordBoard
          records={records}
          columns={preset.columns}
          noun={descriptor.noun}
          labelForPriority={labelForPriority}
          onMove={move}
          onOpen={onOpen}
        />
      ) : (
        <>
          {/* Status filter (list mode). */}
          <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label={`Filter ${descriptor.noun}s by status`}>
            {["all", ...descriptor.filterStatuses].map((s) => (
              <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)} className={tabClass(filter === s)}>{s}</button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-muted-foreground">Couldn't load {descriptor.noun}s.</p>
          ) : (
            <RecordList
              records={shown}
              noun={descriptor.noun}
              labelForPriority={labelForPriority}
              closedStatuses={descriptor.closedStatuses}
              onToggleDone={toggleDone}
              onOpen={onOpen}
              emptyMessage={filter === "all" ? `No ${descriptor.noun}s yet.` : `No ${descriptor.noun}s with status “${filter}”.`}
            />
          )}
        </>
      )}
    </div>
  );
}
