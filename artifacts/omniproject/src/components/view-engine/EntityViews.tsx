import { useMemo, useState } from "react";
import type { EntityDescriptor, ViewKind, ViewRecord, ViewScope } from "../../lib/view-engine/types";
import { applyFiltersSort, groupRecords } from "../../lib/view-engine/apply";
import { useSavedViews } from "../../lib/saved-views";
import { RecordBoard } from "./RecordBoard";
import { RecordList } from "./RecordList";

/**
 * The view engine's entry point: given an entity descriptor, render its records through whichever
 * view the user selects — a list, any of the descriptor's board column-presets (GTD, kanban, …), or
 * a custom saved view authored in the view builder (filters + sort + grouping + list/board). Tasks
 * and issues use this identically; the engine never knows which entity it's showing.
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
  const { data: savedAll } = useSavedViews();
  const saved = useMemo(() => (savedAll ?? []).filter((v) => v.entity === descriptor.entity), [savedAll, descriptor.entity]);
  const [view, setView] = useState<ViewKind>("list");
  const [filter, setFilter] = useState<string>("all");

  const preset = descriptor.presets.find((p) => p.id === view);
  const savedView = view.startsWith("saved:") ? saved.find((v) => v.id === view.slice(6)) : undefined;

  // The records to render for the current view: built-in list uses the status filter tabs; a saved
  // view applies its own filters/sort; a board preset shows everything grouped into columns.
  const listShown = useMemo(
    () => (filter === "all" ? records : records.filter((r) => r.status === filter)),
    [records, filter],
  );
  const savedRecords = useMemo(
    () => (savedView ? applyFiltersSort(records, savedView, descriptor.fields) : records),
    [records, savedView, descriptor.fields],
  );
  const savedGroups = useMemo(
    () => (savedView ? groupRecords(savedRecords, savedView.groupBy, descriptor.fields) : []),
    [savedRecords, savedView, descriptor.fields],
  );

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs uppercase tracking-wider font-semibold border-r border-border last:border-r-0 ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`;

  const board = (records: ViewRecord<T>[]) => (
    <RecordBoard
      records={records}
      columns={(preset ?? descriptor.presets[0])?.columns ?? []}
      noun={descriptor.noun}
      labelForPriority={labelForPriority}
      onMove={move}
      onOpen={onOpen}
    />
  );
  const list = (records: ViewRecord<T>[], emptyMessage: string) => (
    <RecordList
      records={records}
      noun={descriptor.noun}
      labelForPriority={labelForPriority}
      closedStatuses={descriptor.closedStatuses}
      onToggleDone={(r) => move(r, descriptor.closedStatuses.includes(r.status) ? descriptor.reopenStatus : descriptor.doneStatus)}
      onOpen={onOpen}
      emptyMessage={emptyMessage}
    />
  );

  return (
    <div className="space-y-4">
      {/* View switcher — List, board presets, and any custom saved views for this entity. */}
      <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")} className={tabClass(view === "list")}>List</button>
        {descriptor.presets.map((p) => (
          <button key={p.id} role="tab" aria-selected={view === p.id} onClick={() => setView(p.id)} className={tabClass(view === p.id)}>{p.label}</button>
        ))}
        {saved.map((v) => {
          const id = `saved:${v.id}`;
          return <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className={tabClass(view === id)}>{v.name}</button>;
        })}
      </div>

      {savedView ? (
        // A custom saved view: board or list, with its filters/sort/grouping already applied.
        savedView.viewKind === "board" ? board(savedRecords) : (
          <div className="space-y-4">
            {savedGroups.map((g) => (
              <div key={g.key || "_"} className="space-y-2">
                {savedView.groupBy && <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{g.key}</h3>}
                {list(g.records, `No ${descriptor.noun}s in this view.`)}
              </div>
            ))}
          </div>
        )
      ) : preset ? (
        board(records)
      ) : (
        <>
          {/* Built-in list — status filter tabs. */}
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
            list(listShown, filter === "all" ? `No ${descriptor.noun}s yet.` : `No ${descriptor.noun}s with status “${filter}”.`)
          )}
        </>
      )}
    </div>
  );
}
