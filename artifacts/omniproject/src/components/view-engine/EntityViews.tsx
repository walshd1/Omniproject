import { useMemo, useState } from "react";
import type { EntityDescriptor, ViewRecord, ViewScope } from "../../lib/view-engine/types";
import { applyFiltersSort, groupRecords } from "../../lib/view-engine/apply";
import { builtinViewsFor, savedViewToDefinition, type ViewDefinition } from "../../lib/view-engine/view-defs";
import { builtinArtifactViewsFor } from "../../definitions/artifact-views";
import { useSavedViews } from "../../lib/saved-views";
import { RecordBoard } from "./RecordBoard";
import { RecordList } from "./RecordList";
import { RecordTable } from "./RecordTable";
import { RecordTimeline } from "./RecordTimeline";
import { EntityChart } from "./EntityChart";

/**
 * The view engine's entry point. A view is a JSON definition (list / table / board / timeline);
 * the built-in views are read-only definitions derived from the descriptor, and custom views come
 * from the saved-views store. The engine dispatches on `kind` and renders both the same way — tasks
 * and issues included. Any new view is a new definition, not new bespoke code.
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

  const views = useMemo<ViewDefinition[]>(() => [
    ...builtinViewsFor(descriptor),
    ...builtinArtifactViewsFor(descriptor.entity),
    ...(savedAll ?? []).filter((v) => v.entity === descriptor.entity).map(savedViewToDefinition),
  ], [descriptor, savedAll]);

  const [viewId, setViewId] = useState<string | null>(null);
  const current = views.find((v) => v.id === viewId) ?? views[0]!;
  const [filter, setFilter] = useState<string>("all");

  const dateFields = descriptor.fields.filter((f) => f.isDate);
  const shaped = useMemo(() => applyFiltersSort(records, current, descriptor.fields), [records, current, descriptor.fields]);
  const listShown = useMemo(
    () => (current.statusFilter && filter !== "all" ? shaped.filter((r) => r.status === filter) : shaped),
    [shaped, current.statusFilter, filter],
  );

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-xs uppercase tracking-wider font-semibold border-r border-border last:border-r-0 ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`;

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

  const body = () => {
    if (current.kind === "board") {
      return (
        <RecordBoard
          records={shaped}
          columns={current.boardColumns ?? descriptor.presets[0]?.columns ?? []}
          noun={descriptor.noun}
          labelForPriority={labelForPriority}
          onMove={move}
          onOpen={onOpen}
        />
      );
    }
    if (current.kind === "table") {
      return <RecordTable records={shaped} fields={descriptor.fields} {...(current.columns ? { columns: current.columns } : {})} noun={descriptor.noun} onOpen={onOpen} />;
    }
    if (current.kind === "timeline") {
      return (
        <RecordTimeline
          records={shaped}
          field={dateFields.find((f) => f.key === current.dateField) ?? dateFields[0]}
          noun={descriptor.noun}
          labelForPriority={labelForPriority}
          onOpen={onOpen}
        />
      );
    }
    if (current.kind === "chart") {
      return <EntityChart records={shaped} fields={descriptor.fields} spec={current.chart ?? { type: "bar" }} noun={descriptor.noun} {...(current.style ? { style: current.style } : {})} />;
    }
    // list
    if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
    if (error) return <p className="text-sm text-muted-foreground">Couldn't load {descriptor.noun}s.</p>;
    return (
      <>
        {current.statusFilter && (
          <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label={`Filter ${descriptor.noun}s by status`}>
            {["all", ...descriptor.filterStatuses].map((s) => (
              <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)} className={tabClass(filter === s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="space-y-4">
          {groupRecords(listShown, current.groupBy, descriptor.fields).map((g) => (
            <div key={g.key || "_"} className="space-y-2">
              {current.groupBy && <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">{g.key}</h3>}
              {list(g.records, current.statusFilter && filter !== "all" ? `No ${descriptor.noun}s with status “${filter}”.` : `No ${descriptor.noun}s yet.`)}
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* View switcher — built-in (read-only) views plus any custom saved views for this entity. */}
      <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label="View">
        {views.map((v) => (
          <button key={v.id} role="tab" aria-selected={current.id === v.id} onClick={() => { setViewId(v.id); setFilter("all"); }} className={tabClass(current.id === v.id)}>{v.name}</button>
        ))}
      </div>
      {body()}
    </div>
  );
}
