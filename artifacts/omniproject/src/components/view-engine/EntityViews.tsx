import { useMemo, useState } from "react";
import type { EntityDescriptor, ViewRecord, ViewScope } from "../../lib/view-engine/types";
import { applyFiltersSort, groupRecords } from "../../lib/view-engine/apply";
import { builtinViewsFor, savedViewToDefinition, type ViewDefinition } from "../../lib/view-engine/view-defs";
import { builtinArtifactViewsFor } from "../../definitions/artifact-views";
import { useMethodologyComposition } from "../../lib/methodology-composition-api";
import { isEnabled } from "../../lib/methodology-composition";
import { useSavedViews } from "../../lib/saved-views";
import { DataState } from "../DataState";
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
  onCreate,
  lockView,
}: {
  descriptor: EntityDescriptor<T>;
  scope?: ViewScope;
  onOpen: (record: ViewRecord<T>) => void;
  /** OPTIONAL: create a new record seeded with a status (from a board column). Enables the board's
   *  per-column "+" / empty "+ Add" affordance. Omitted → the board is read/move-only. */
  onCreate?: (seed: { status?: string }) => void;
  /** OPTIONAL: lock the engine to a single view id and hide the switcher chrome — how a methodology
   *  single-view renderer (kanban/list) reuses the generic engine without the multi-view switcher. */
  lockView?: string;
}) {
  const { records, isLoading, error, refetch } = descriptor.useRecords(scope);
  const move = descriptor.useMove();
  const labelForPriority = descriptor.usePriorityLabel();
  // Optional vocab seams — a given descriptor either always supplies these or never does (module
  // singleton), so the conditional call order is stable (Rules-of-Hooks safe).
  const vocabColumns = descriptor.useBoardColumns?.();
  const labelForStatus = descriptor.useStatusLabel?.();
  const { data: savedAll } = useSavedViews();
  const { data: composition } = useMethodologyComposition();

  const views = useMemo<ViewDefinition[]>(() => [
    ...builtinViewsFor(descriptor),
    // Shipped baseline view artifacts respect the composition (their id is "artifact:<id>").
    ...builtinArtifactViewsFor(descriptor.entity).filter((v) => isEnabled(composition ?? null, `artifact:${v.id}`)),
    ...(savedAll ?? []).filter((v) => v.entity === descriptor.entity).map(savedViewToDefinition),
  ], [descriptor, savedAll, composition]);

  const [viewId, setViewId] = useState<string | null>(null);
  // `lockView` (when set) forces a single view and hides the switcher — the rest of the engine is
  // unchanged, so a locked board still moves/creates/filters exactly like the full engine's board.
  const effectiveId = lockView ?? viewId;
  const current = views.find((v) => v.id === effectiveId) ?? views[0]!;
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
      // Built-in board views take their columns LIVE from the org's resolved vocabulary (order,
      // labels, colours) when the descriptor supplies them; a custom saved board view keeps its own
      // authored columns; otherwise fall back to the descriptor's static preset.
      const columns =
        current.builtin && vocabColumns
          ? vocabColumns
          : current.boardColumns ?? vocabColumns ?? descriptor.presets[0]?.columns ?? [];
      return (
        <RecordBoard
          records={shaped}
          columns={columns}
          noun={descriptor.noun}
          labelForPriority={labelForPriority}
          {...(labelForStatus ? { labelForStatus } : {})}
          {...(onCreate ? { onCreate: (status: string) => onCreate({ status }) } : {})}
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
      {/* View switcher — built-in (read-only) views plus any custom saved views for this entity.
          Hidden when the engine is locked to a single view (a methodology single-view renderer). */}
      {!lockView && (
        <div className="inline-flex flex-wrap border border-border" role="tablist" aria-label="View">
          {views.map((v) => (
            <button key={v.id} role="tab" aria-selected={current.id === v.id} onClick={() => { setViewId(v.id); setFilter("all"); }} className={tabClass(current.id === v.id)}>{v.name}</button>
          ))}
        </div>
      )}
      {/* One loading/error/retry surface for EVERY view kind (board included), so a failed fetch shows
          a recoverable alert instead of an empty board — the affordance the legacy board owned. */}
      <DataState isLoading={isLoading} isError={error != null} error={error} {...(refetch ? { onRetry: refetch } : {})} className="w-full">
        {body()}
      </DataState>
    </div>
  );
}
