import { useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import {
  useGetProjectIssues,
  type Issue,
  type IssueUpdate,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useIssueFieldWrite } from "../../lib/use-issue-field-write";
import { useAvailability, fieldVisible, type Availability } from "../../lib/availability";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useSidePanel } from "../../lib/side-panel";
import { STATUS_ORDER, PRIORITY_ORDER, statusLabel, priorityLabel } from "../../lib/constants";
import { matchRow } from "../../lib/custom-report";
import { readDrillFilter, DRILL_FILTER_PARAMS } from "../../lib/drill-to";
import { DataState } from "../DataState";
import { SkeletonRows } from "../Skeletons";
import { SavedViewsBar } from "./SavedViewsBar";

/**
 * Editable data grid (the "grid" feature module) — a spreadsheet-style view of a project's work
 * items with click-to-edit cells, keyboard commit/cancel, multi-row select and bulk-apply. Columns
 * are keyed by CANONICAL field keys and gated by availability (superset ∩ backend − curation), so
 * the grid shows exactly the editable fields the backend supports and the admin/PMO haven't hidden.
 * Every write goes through the broker's issue-update path with the optimistic-concurrency token
 * (`expectedVersion`); a concurrent change comes back 409 and the grid refreshes instead of
 * clobbering. Gated behind `useFeatures("grid")` by the caller.
 *
 * DRILL-THROUGH (backlog #122): a `filter`/`filterLabel` query param — written by lib/drill-to.ts's
 * `resolveDrillTo` when a user clicks a red "N blocked" figure elsewhere in the app — pre-filters the
 * rows to exactly that predicate, using the SAME `matchRow` engine the custom report builder runs
 * saved filters through. Purely client-side URL state: nothing persisted, nothing broker-side.
 */

type ColType = "text" | "status" | "priority" | "date" | "number";

export interface GridColumn {
  field: keyof IssueUpdate & string;
  label: string;
  type: ColType;
}

/** The canonical, editable columns the grid CAN show (before availability gating). */
export const GRID_COLUMNS: readonly GridColumn[] = [
  { field: "title", label: "Title", type: "text" },
  { field: "status", label: "Status", type: "status" },
  { field: "priority", label: "Priority", type: "priority" },
  { field: "assignee", label: "Assignee", type: "text" },
  { field: "startDate", label: "Start", type: "date" },
  { field: "dueDate", label: "Due", type: "date" },
  { field: "storyPoints", label: "Points", type: "number" },
];

/** Columns visible given availability — only fields the backend surfaces and curation kept. */
export function visibleGridColumns(availability: Availability | undefined): GridColumn[] {
  return GRID_COLUMNS.filter((c) => fieldVisible(availability, c.field));
}

/** Coerce a raw cell string to the typed value for an issue update (empty → null/undefined). */
export function coerceCellValue(type: ColType, raw: string): string | number | null {
  const v = raw.trim();
  if (type === "number") return v === "" ? null : Number(v);
  if (type === "date") return v === "" ? null : v; // ISO yyyy-mm-dd
  return v;
}

/** Build the issue-update payload for a single field, binding the optimistic-concurrency token. */
export function buildIssueUpdate(field: string, value: unknown, version: number | null | undefined): IssueUpdate {
  return { [field]: value, ...(version != null ? { expectedVersion: version } : {}) } as IssueUpdate;
}

function cellText(issue: Issue, col: GridColumn): string {
  const v = (issue as unknown as Record<string, unknown>)[col.field];
  if (v == null) return "";
  if (col.type === "status") return statusLabel(String(v));
  if (col.type === "priority") return priorityLabel(String(v));
  if (col.type === "date") return String(v).slice(0, 10);
  return String(v);
}

export function IssueGrid({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);
  const { data: availability } = useAvailability();
  const { write } = useIssueFieldWrite();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const drillFilter = useMemo(() => readDrillFilter(searchParams), [searchParams]);

  const { data: features } = useFeatures();
  const savedViewsOn = featureEnabled(features, "savedViews");
  const sidePanelOn = featureEnabled(features, "sidePanel");
  const openIssue = useSidePanel((s) => s.openIssue);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  // A saved view can restrict/order columns and set a sort; null = backend default.
  const [viewColumns, setViewColumns] = useState<string[] | null>(null);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);

  // Available editable columns, optionally narrowed + ordered by the active saved view.
  const columns = useMemo(() => {
    const available = visibleGridColumns(availability);
    if (!viewColumns) return available;
    const byField = new Map(available.map((c) => [c.field, c]));
    return viewColumns.map((f) => byField.get(f as GridColumn["field"])).filter((c): c is GridColumn => !!c);
  }, [availability, viewColumns]);

  const [bulkField, setBulkField] = useState<string>("status");

  const allRows = useMemo(() => issues ?? [], [issues]);
  const filteredRows = useMemo(
    () => (drillFilter ? allRows.filter((i) => matchRow(drillFilter.predicate, i as unknown as Record<string, unknown>)) : allRows),
    [allRows, drillFilter],
  );

  const clearDrillFilter = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const p of DRILL_FILTER_PARAMS) next.delete(p);
      return next;
    });
  };

  const rows = useMemo(() => {
    const list = [...filteredRows];
    if (sort) {
      const { field, dir } = sort;
      list.sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[field];
        const bv = (b as unknown as Record<string, unknown>)[field];
        const an = av == null ? "" : String(av);
        const bn = bv == null ? "" : String(bv);
        return (an < bn ? -1 : an > bn ? 1 : 0) * (dir === "asc" ? 1 : -1);
      });
    }
    return list;
  }, [filteredRows, sort]);

  const toggleSort = (field: string) =>
    setSort((s) => (s?.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));

  /** Write one field on one issue via the shared writer (optimistic + expectedVersion + 409-safe).
   *  `undoable` (single inline edits) adds a one-click Undo toast; bulk edits pass it off. */
  function commit(issue: Issue, col: GridColumn, raw: string, undoable = false) {
    setEditing(null);
    const value = coerceCellValue(col.type, raw);
    if (value === ((issue as unknown as Record<string, unknown>)[col.field] ?? (col.type === "number" ? null : ""))) return;
    write(projectId, issue, col.field, value, undoable ? { undoable: true, label: `${col.label} updated` } : {});
  }

  /** Apply one field value to every selected row (each with its own expectedVersion). */
  function bulkApply() {
    const col = columns.find((c) => c.field === bulkField);
    if (!col || selected.size === 0) return;
    const affected = rows.filter((r) => selected.has(r.id));
    affected.forEach((issue) => commit(issue, col, bulkValue));
    toast({ title: "BULK UPDATE", description: `${col.label} → ${affected.length} item(s)` });
    setSelected(new Set());
  }

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch} skeleton={<SkeletonRows rows={6} className="p-2" />}>
    <div data-testid="issue-grid">
      {drillFilter && (
        <div
          className="mb-3 flex items-center justify-between gap-2 border-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-xs"
          data-testid="grid-drill-filter-banner"
        >
          <span className="font-bold uppercase tracking-widest">
            Filtered — {drillFilter.label}{" "}
            <span className="font-mono normal-case text-muted-foreground">({filteredRows.length} of {allRows.length})</span>
          </span>
          <button
            type="button"
            className="font-black uppercase tracking-widest underline hover:no-underline"
            onClick={clearDrillFilter}
            data-testid="grid-drill-filter-clear"
          >
            Clear filter
          </button>
        </div>
      )}
      {savedViewsOn && (
        <SavedViewsBar
          scope="grid"
          current={{ columns: columns.map((c) => c.field), sort }}
          onApply={(view) => {
            setViewColumns(view.columns ?? null);
            setSort(view.sort ?? null);
          }}
        />
      )}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 border-2 border-foreground p-2 text-sm" data-testid="bulk-bar">
          <span className="font-bold">{selected.size} selected</span>
          <select value={bulkField} onChange={(e) => setBulkField(e.target.value)} aria-label="Bulk field" className="border border-foreground bg-background px-1 py-0.5">
            {columns.map((c) => <option key={c.field} value={c.field}>{c.label}</option>)}
          </select>
          <CellInput type={columns.find((c) => c.field === bulkField)?.type ?? "text"} value={bulkValue} onChange={setBulkValue} ariaLabel="Bulk value" />
          <button onClick={bulkApply} className="border-2 border-foreground px-2 py-0.5 font-bold uppercase">Apply</button>
        </div>
      )}
      <table className="w-full text-left text-sm" data-testid="grid-table">
        <thead>
          <tr className="border-b-2 border-foreground text-xs uppercase tracking-wider">
            <th className="w-8 py-1" />
            {columns.map((c) => (
              <th key={c.field} className="py-1 pr-4">
                <button
                  type="button"
                  onClick={() => toggleSort(c.field)}
                  aria-sort={sort?.field === c.field ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className="font-bold uppercase tracking-wider hover:underline"
                >
                  {c.label}{sort?.field === c.field ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((issue) => (
            <tr key={issue.id} className="border-b border-border/50">
              <td className="py-1">
                <div className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selected.has(issue.id)}
                    onChange={() => toggleRow(issue.id)}
                    aria-label={`Select ${issue.title}`}
                  />
                  {sidePanelOn && (
                    <button
                      type="button"
                      onClick={() => openIssue(projectId, issue.id)}
                      aria-label={`Open details for ${issue.title}`}
                      className="text-muted-foreground hover:text-foreground"
                    >⤢</button>
                  )}
                </div>
              </td>
              {columns.map((col) => {
                const isEditing = editing?.id === issue.id && editing.field === col.field;
                return (
                  <td key={col.field} className="py-1 pr-4">
                    {isEditing ? (
                      <CellInput
                        type={col.type}
                        value={cellText(issue, col)}
                        autoFocus
                        ariaLabel={`${col.label} for ${issue.title}`}
                        onCommit={(raw) => commit(issue, col, raw, true)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="w-full text-left hover:underline"
                        onClick={() => setEditing({ id: issue.id, field: col.field })}
                        aria-label={`Edit ${col.label} for ${issue.title}`}
                      >
                        {cellText(issue, col) || <span className="text-muted-foreground">—</span>}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </DataState>
  );
}

/** A type-aware cell editor: select for status/priority, date/number/text inputs otherwise.
 *  Commits on blur/Enter, cancels on Escape; in bulk mode it's a controlled input (onChange). */
function CellInput({
  type, value, onChange, onCommit, onCancel, autoFocus, ariaLabel,
}: {
  type: ColType;
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const set = (v: string) => { setDraft(v); onChange?.(v); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onCommit?.(draft);
    else if (e.key === "Escape") onCancel?.();
  };
  const common = { autoFocus, "aria-label": ariaLabel, className: "border border-foreground bg-background px-1 py-0.5", onKeyDown: key };

  if (type === "status" || type === "priority") {
    const opts = type === "status" ? STATUS_ORDER : PRIORITY_ORDER;
    const label = type === "status" ? statusLabel : priorityLabel;
    return (
      <select {...common} value={draft} onChange={(e) => set(e.target.value)} onBlur={() => onCommit?.(draft)}>
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    );
  }
  return (
    <input
      {...common}
      type={type === "date" ? "date" : type === "number" ? "number" : "text"}
      value={draft}
      onChange={(e) => set(e.target.value)}
      onBlur={() => onCommit?.(draft)}
    />
  );
}
